"""Authentication — feature-flagged.

When `AUTH_ENABLED=false` (default in dev), every request is treated as the
seeded GUEST_TESTER user so the site is fully usable without signing in.

When `AUTH_ENABLED=true`, requests must carry a Stack Auth bearer token in the
`Authorization` header. The token is validated against Stack Auth's JWKS and the
external user id is mapped to / upserts a row in our `users` table.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from .config import Settings, get_settings


@dataclass
class CurrentUser:
    id: str
    handle: str
    external_id: str
    email: str
    team_id: str | None
    is_admin: bool
    is_house_account: bool


# Lazily initialised — only used when auth is enabled.
_jwks_client: PyJWKClient | None = None


def _get_jwks_client(settings: Settings) -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        if not settings.stack_jwks_url:
            raise RuntimeError("STACK_JWKS_URL must be set when AUTH_ENABLED=true")
        _jwks_client = PyJWKClient(settings.stack_jwks_url, cache_keys=True)
    return _jwks_client


_bearer_scheme = HTTPBearer(auto_error=False)


async def _load_user_by_external_id(request: Request, external_id: str) -> CurrentUser | None:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id::text, handle, external_id, email, team_id::text, is_admin, "
            "is_house_account FROM users WHERE external_id = $1 AND deleted_at IS NULL",
            external_id,
        )
    return CurrentUser(**dict(row)) if row else None


async def _load_guest_user(request: Request, settings: Settings) -> CurrentUser:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id::text, handle, external_id, email, team_id::text, is_admin, "
            "is_house_account FROM users WHERE handle = $1 AND deleted_at IS NULL",
            settings.guest_handle,
        )
    if not row:
        raise HTTPException(500, f"Guest user {settings.guest_handle!r} not seeded")
    return CurrentUser(**dict(row))


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if not settings.auth_enabled:
        return await _load_guest_user(request, settings)

    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    try:
        signing_key = _get_jwks_client(settings).get_signing_key_from_jwt(credentials.credentials)
        payload = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience=settings.stack_project_id,
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}") from e

    external_id = payload["sub"]
    user = await _load_user_by_external_id(request, external_id)
    if user is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "User authenticated but no profile yet — complete onboarding",
        )
    return user


async def get_current_user_optional(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> CurrentUser | None:
    """Same as get_current_user but returns None instead of raising."""
    try:
        return await get_current_user(request, credentials, settings)
    except HTTPException:
        return None
