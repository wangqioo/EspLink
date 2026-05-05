from pydantic import BaseModel


# 设备上电时发送的注册请求
class BootRegisterRequest(BaseModel):
    mac: str
    sn: str | None = None
    board_type: str
    firmware_version: str


class OtaInfo(BaseModel):
    version: str
    url: str
    force: bool = False


# 返回给设备的注册响应
class BootRegisterResponse(BaseModel):
    websocket_url: str
    token: str          # device_key，设备存入 NVS 用于后续 WS 认证
    is_bound: bool
    ota: OtaInfo | None = None
