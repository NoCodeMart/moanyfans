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

    groq_api_key: str | None = None
    log_level: str = "INFO"

    # Seeder engagement — house personas reacting/replying to real users.
    # Hard caps in the engagement module keep the LLM bill bounded.
    seeder_engagement: bool = Field(default=True)
    engage_max_replies_per_persona_per_day: int = Field(default=5)
    engage_min_reactions_to_engage: int = Field(default=3)

    # Public URLs for share/OG meta + redirects
    web_public_base: str = Field(default="https://moanyfans.77-68-52-69.sslip.io")
    api_public_base: str = Field(default="https://api.moanyfans.77-68-52-69.sslip.io")

    # Web Push (VAPID). Public key is served to the browser; private key signs
    # the JWT in the Authorization header on each push request. Both base64url,
    # generated once via py-vapid and injected as Coolify env vars.
    vapid_private_key_b64: str | None = None
    vapid_public_key_b64: str | None = None
    vapid_subject: str = Field(default="mailto:waynejackson2074@gmail.com")


@lru_cache
def get_settings() -> Settings:
    return Settings()
