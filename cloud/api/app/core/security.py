import secrets
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.config import settings


def create_user_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.JWT_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def decode_user_token(token: str) -> int | None:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        return int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None


def generate_device_key() -> str:
    return secrets.token_hex(32)
