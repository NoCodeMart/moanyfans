from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = Field(default="development")
    database_url: str = Field(...)
    redis_url: str = Field(default="redis://localhost:6379/0")
    cors_origins: list[str] = Field(
        default=[
            "https://moanyfans.77-68-52-69.sslip.io",
            "https://moanyfans.com",
            "https://www.moanyfans.com",
            "http://localhost:5173",
        ]
    )
    anthropic_api_key: str | None = None
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
