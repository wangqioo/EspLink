import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.device import Device
from app.models.user import User
from app.redis_client import is_device_online
from app.schemas.device import (
    CommandRequest,
    DeviceBindRequest,
    DeviceItem,
    DeviceListResponse,
)
from app.services.ws_manager import manager

router = APIRouter(prefix="/api/device", tags=["device"])
logger = logging.getLogger(__name__)


@router.get("/lookup")
async def lookup_device(
    mac_suffix: str = Query(..., min_length=6, max_length=6,
                            description="BLE 设备名后缀，如 Device-AABBCC 中的 AABBCC"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    配网成功后，小程序用 BLE 设备名后六位（MAC 末三字节）查找刚上线的设备。
    只返回 5 分钟内有上线记录的设备，避免误匹配历史设备。
    """
    s = mac_suffix.upper()
    mac_pattern = f"%:{s[0:2]}:{s[2:4]}:{s[4:6]}"
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)

    result = await db.execute(
        select(Device).where(
            Device.mac.like(mac_pattern),
            Device.last_seen_at >= cutoff,
        )
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Device not yet online. Please wait a moment.")

    return {
        "id":         device.id,
        "mac":        device.mac,
        "board_type": device.board_type,
        "is_bound":   device.user_id is not None,
        "is_online":  await is_device_online(device.mac),
    }


@router.post("/bind")
async def bind_device(
    req: DeviceBindRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    配网完成后小程序调用，用 BLE 连接期间获取的 MAC 绑定设备。
    小程序 BLE 配对即所有权证明，无需额外验证码。
    """
    result = await db.execute(select(Device).where(Device.mac == req.mac))
    device = result.scalar_one_or_none()

    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Device not found. Make sure it has connected to WiFi.")

    if device.user_id is not None and device.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Device is already bound to another user.")

    device.user_id = current_user.id
    await db.commit()
    logger.info("device %s bound to user %d", req.mac, current_user.id)
    return {"ok": True}


@router.get("/list", response_model=DeviceListResponse)
async def list_devices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回当前用户的所有设备，含实时在线状态。"""
    result = await db.execute(
        select(Device).where(Device.user_id == current_user.id)
    )
    devices = result.scalars().all()

    items = []
    for d in devices:
        items.append(DeviceItem(
            id=d.id,
            mac=d.mac,
            board_type=d.board_type,
            firmware_version=d.firmware_version,
            capabilities=d.capabilities,
            alias=d.alias,
            is_online=await is_device_online(d.mac),
            last_seen_at=d.last_seen_at,
        ))

    return DeviceListResponse(devices=items)


@router.post("/{device_id}/command")
async def send_command(
    device_id: int,
    req: CommandRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """向设备下发控制指令（小程序 → 云端 → 设备）。"""
    result = await db.execute(
        select(Device).where(Device.id == device_id,
                             Device.user_id == current_user.id)
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Device not found.")

    sent = await manager.send(device.mac, {"type": "command", "payload": req.payload})
    if not sent:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Device is offline.")
    return {"ok": True}
