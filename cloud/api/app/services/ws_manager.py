import logging
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    维护设备 WebSocket 长连接。
    当前为单进程内存实现，满足 MVP 需求。
    多实例部署时需替换为 Redis Pub/Sub 方案。
    """

    def __init__(self) -> None:
        # mac -> WebSocket
        self._connections: dict[str, WebSocket] = {}

    async def connect(self, mac: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[mac] = ws
        logger.info("device connected: %s (total: %d)", mac, len(self._connections))

    def disconnect(self, mac: str) -> None:
        self._connections.pop(mac, None)
        logger.info("device disconnected: %s (total: %d)", mac, len(self._connections))

    def is_connected(self, mac: str) -> bool:
        return mac in self._connections

    async def send(self, mac: str, message: dict) -> bool:
        ws = self._connections.get(mac)
        if ws is None:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception:
            self.disconnect(mac)
            return False

    def online_macs(self) -> list[str]:
        return list(self._connections.keys())


# 全局单例
manager = ConnectionManager()
