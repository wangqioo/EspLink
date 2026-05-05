from datetime import datetime

from pydantic import BaseModel


class DeviceBindRequest(BaseModel):
    mac: str


class DeviceItem(BaseModel):
    id: int
    mac: str
    board_type: str
    firmware_version: str | None
    capabilities: dict | None
    alias: str | None
    is_online: bool
    last_seen_at: datetime | None

    model_config = {"from_attributes": True}


class DeviceListResponse(BaseModel):
    devices: list[DeviceItem]


class CommandRequest(BaseModel):
    payload: dict
