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

    # Stack Auth — only used when auth_enabled=True
    auth_enabled: bool = Field(default=False)
    stack_project_id: str | None = None
    stack_secret_server_key: str | None = None
    stack_jwks_url: str | None = None  # https://api.stack-auth.com/api/v1/projects/{id}/.well-known/jwks.json

    # Dev/test user used when auth_enabled=False
    guest_handle: str = Field(default="GUEST_TESTER")

    anthropic_api_key: str | None = None
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
