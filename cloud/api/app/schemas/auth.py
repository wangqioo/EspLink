from pydantic import BaseModel


class WechatLoginRequest(BaseModel):
    code: str


class TokenResponse(BaseModel):
    token: str
    user_id: int
