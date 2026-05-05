from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    mac: Mapped[str] = mapped_column(String(17), unique=True, nullable=False)
    sn: Mapped[str | None] = mapped_column(String(64))
    board_type: Mapped[str] = mapped_column(String(64), nullable=False)
    firmware_version: Mapped[str | None] = mapped_column(String(32))
    capabilities: Mapped[dict | None] = mapped_column(JSON)

    # 设备认证 key，由服务端生成，写入 OTA check 响应，存入设备 NVS
    device_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)

    # 归属用户（NULL 表示未绑定）
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    alias: Mapped[str | None] = mapped_column(String(64))

    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    user: Mapped["User | None"] = relationship(back_populates="devices")
