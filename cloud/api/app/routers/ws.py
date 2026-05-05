import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, AsyncSessionLocal
from app.models.device import Device
from app.redis_client import refresh_device_online, set_device_offline, set_device_online
from app.services.ws_manager import manager

router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)


async def _get_device_by_key(device_key: str) -> Device | None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Device).where(Device.device_key == device_key)
        )
        return result.scalar_one_or_none()


async def _update_last_seen(mac: str) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Device).where(Device.mac == mac))
        device = result.scalar_one_or_none()
        if device:
            device.last_seen_at = datetime.now(timezone.utc)
            await db.commit()


@router.websocket("/ws/device")
async def device_websocket(websocket: WebSocket):
    """
    设备 WebSocket 端点。
    认证：HTTP 头 Authorization: Bearer <device_key>
    """
    # 从请求头取 device_key
    auth_header = websocket.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        await websocket.close(code=4001)
        return

    device_key = auth_header.removeprefix("Bearer ").strip()
    device = await _get_device_by_key(device_key)
    if device is None:
        await websocket.close(code=4003)
        return

    mac = device.mac
    await manager.connect(mac, websocket)
    await set_device_online(mac)
    await _update_last_seen(mac)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "hello":
                # 存储设备上报的 capabilities
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(Device).where(Device.mac == mac))
                    d = result.scalar_one_or_none()
                    if d and data.get("capabilities"):
                        d.capabilities = data["capabilities"]
                        await db.commit()
                await websocket.send_json({
                    "type": "hello_ack",
                    "is_bound": device.user_id is not None,
                })

            elif msg_type == "ping":
                await refresh_device_online(mac)
                await websocket.send_json({"type": "pong"})

            elif msg_type == "status":
                # 设备上报状态，刷新在线 TTL
                await refresh_device_online(mac)
                logger.debug("status from %s: %s", mac, data.get("payload"))

            elif msg_type == "event":
                # 设备触发性事件（按键、告警等）
                logger.info("event from %s: %s", mac, data.get("payload"))

            else:
                logger.warning("unknown msg type from %s: %s", mac, msg_type)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("ws error for %s: %s", mac, e)
    finally:
        manager.disconnect(mac)
        await set_device_offline(mac)
