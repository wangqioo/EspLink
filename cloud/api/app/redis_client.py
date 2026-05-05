import redis.asyncio as aioredis

from app.config import settings

_redis: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


# 设备在线状态 TTL（秒）
# 设备每 30s 发一次 ping，这里给 90s 容忍网络抖动
DEVICE_ONLINE_TTL = 90

DEVICE_ONLINE_KEY = "device:online:{mac}"


async def set_device_online(mac: str) -> None:
    r = await get_redis()
    await r.set(DEVICE_ONLINE_KEY.format(mac=mac), 1, ex=DEVICE_ONLINE_TTL)


async def refresh_device_online(mac: str) -> None:
    r = await get_redis()
    await r.expire(DEVICE_ONLINE_KEY.format(mac=mac), DEVICE_ONLINE_TTL)


async def set_device_offline(mac: str) -> None:
    r = await get_redis()
    await r.delete(DEVICE_ONLINE_KEY.format(mac=mac))


async def is_device_online(mac: str) -> bool:
    r = await get_redis()
    return bool(await r.exists(DEVICE_ONLINE_KEY.format(mac=mac)))
