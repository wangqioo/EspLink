"""init

Revision ID: 001
Revises:
Create Date: 2026-05-05
"""
from alembic import op
import sqlalchemy as sa

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("openid", sa.String(64), nullable=False, unique=True),
        sa.Column("nickname", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        "devices",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("mac", sa.String(17), nullable=False, unique=True),
        sa.Column("sn", sa.String(64), nullable=True),
        sa.Column("board_type", sa.String(64), nullable=False),
        sa.Column("firmware_version", sa.String(32), nullable=True),
        sa.Column("capabilities", sa.JSON(), nullable=True),
        sa.Column("device_key", sa.String(64), nullable=False, unique=True),
        sa.Column("user_id", sa.BigInteger(),
                  sa.ForeignKey("users.id"), nullable=True),
        sa.Column("alias", sa.String(64), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        "ota_firmware",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("board_type", sa.String(64), nullable=False, index=True),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("file_url", sa.String(512), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("sha256", sa.String(64), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), default=True),
        sa.Column("force_update", sa.Boolean(), default=False),
        sa.Column("release_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("ota_firmware")
    op.drop_table("devices")
    op.drop_table("users")
