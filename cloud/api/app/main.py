import logging

from fastapi import FastAPI

from app.config import settings
from app.routers import auth, device, ota, ws

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(
    title="EspLink Cloud API",
    version="1.0.0",
    docs_url="/docs" if settings.DEBUG else None,  # 生产环境关闭 swagger
)

app.include_router(ota.router)
app.include_router(auth.router)
app.include_router(device.router)
app.include_router(ws.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
