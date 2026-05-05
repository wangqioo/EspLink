from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OtaFirmware(Base):
    __tablename__ = "ota_firmware"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    board_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    file_url: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer)
    sha256: Mapped[str | None] = mapped_column(String(64))
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    force_update: Mapped[bool] = mapped_column(Boolean, default=False)
    release_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
