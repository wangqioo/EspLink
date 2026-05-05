import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import generate_device_key
from app.database import get_db
from app.models.device import Device
from app.models.ota import OtaFirmware
from app.schemas.ota import BootRegisterRequest, BootRegisterResponse, OtaInfo

router = APIRouter(prefix="/api/ota", tags=["ota"])
logger = logging.getLogger(__name__)


def _version_newer(remote: str, current: str) -> bool:
    def parse(v: str) -> tuple:
        try:
            return tuple(int(x) for x in v.split("."))
        except ValueError:
            return (0,)
    return parse(remote) > parse(current)


@router.post("/check", response_model=BootRegisterResponse)
async def boot_register(req: BootRegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    设备上电后调用。完成三件事：
    1. 自动注册未知设备（生成 device_key）
    2. 检查是否有 OTA 固件更新
    3. 返回 WebSocket 地址 + 认证 token
    """
    # 1. 查找或创建设备
    result = await db.execute(select(Device).where(Device.mac == req.mac))
    device = result.scalar_one_or_none()

    if device is None:
        device = Device(
            mac=req.mac,
            sn=req.sn,
            board_type=req.board_type,
            firmware_version=req.firmware_version,
            device_key=generate_device_key(),
        )
        db.add(device)
        logger.info("new device registered: %s (%s)", req.mac, req.board_type)
    else:
        # 更新固件版本和最后上线时间
        device.firmware_version = req.firmware_version
        if req.sn:
            device.sn = req.sn

    device.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(device)

    # 2. 检查 OTA（取该 board_type 最新启用版本）
    ota_result = await db.execute(
        select(OtaFirmware)
        .where(OtaFirmware.board_type == req.board_type, OtaFirmware.is_enabled == True)
        .order_by(OtaFirmware.created_at.desc())
        .limit(1)
    )
    ota_firmware = ota_result.scalar_one_or_none()

    ota_info: OtaInfo | None = None
    if ota_firmware and _version_newer(ota_firmware.version, req.firmware_version):
        ota_info = OtaInfo(
            version=ota_firmware.version,
            url=ota_firmware.file_url,
            force=ota_firmware.force_update,
        )
        logger.info("OTA available for %s: %s -> %s",
                    req.mac, req.firmware_version, ota_firmware.version)

    return BootRegisterResponse(
        websocket_url=f"{settings.WS_BASE_URL}/ws/device",
        token=device.device_key,
        is_bound=device.user_id is not None,
        ota=ota_info,
    )
