from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 数据库
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "esplink"
    DB_PASSWORD: str = "esplink123"
    DB_NAME: str = "esplink"

    # Redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0

    # JWT
    SECRET_KEY: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_DAYS: int = 30

    # 微信
    WX_APPID: str = ""
    WX_SECRET: str = ""

    # 返回给设备的 WebSocket 基础地址
    WS_BASE_URL: str = "ws://localhost:8000"

    DEBUG: bool = False

    @property
    def db_url(self) -> str:
        return (
            f"mysql+asyncmy://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    @property
    def redis_url(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    model_config = {"env_file": ".env"}


settings = Settings()
