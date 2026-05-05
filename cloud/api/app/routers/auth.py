import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import create_user_token
from app.database import get_db
from app.models.user import User
from app.schemas.auth import TokenResponse, WechatLoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)

WX_CODE2SESSION = "https://api.weixin.qq.com/sns/jscode2session"


@router.post("/wechat", response_model=TokenResponse)
async def wechat_login(req: WechatLoginRequest, db: AsyncSession = Depends(get_db)):
    """
    微信小程序登录：用 wx.login() 的 code 换取 openid，创建或获取用户。
    开发模式（DEBUG=true 且未配置 WX_APPID）时，直接用 code 作为 openid，
    方便在没有真实小程序时测试。
    """
    if settings.DEBUG and not settings.WX_APPID:
        openid = f"dev_{req.code}"
        logger.warning("dev mode: using code as openid: %s", openid)
    else:
        async with httpx.AsyncClient() as client:
            resp = await client.get(WX_CODE2SESSION, params={
                "appid":      settings.WX_APPID,
                "secret":     settings.WX_SECRET,
                "js_code":    req.code,
                "grant_type": "authorization_code",
            })
        data = resp.json()
        if "errcode" in data and data["errcode"] != 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"WeChat error: {data.get('errmsg', 'unknown')}",
            )
        openid = data.get("openid")
        if not openid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="Failed to get openid")

    # 查找或创建用户
    result = await db.execute(select(User).where(User.openid == openid))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(openid=openid)
        db.add(user)
        await db.commit()
        await db.refresh(user)
        logger.info("new user created: %d (%s)", user.id, openid)

    return TokenResponse(token=create_user_token(user.id), user_id=user.id)
