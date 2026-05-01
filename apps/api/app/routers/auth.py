"""Auth-adjacent endpoints — handle availability + first-time onboarding.

Stack Auth handles the actual login flow (email/password, OAuth). After a
successful login the frontend has a JWT but no profile yet — `complete_onboarding`
is what creates the user row in our DB and links it to the Stack Auth subject.
"""
from __future__ import annotations

from typing import Annotated

import jwt
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field

from ..auth import _get_jwks_client
from ..config import Settings, get_settings
from ..services import handles
from ..services.ratelimit import limit_ip

log = structlog.get_logger(__name__)
router = APIRouter(tags=["auth"])
_bearer_scheme = HTTPBearer(auto_error=False)


# ── Handle availability (public) ───────────────────────────────────────────

class HandleCheckResponse(BaseModel):
    handle: str
    available: bool
    reason: str | None = None


@router.get("/auth/check-handle", response_model=HandleCheckResponse)
async def check_handle(handle: str, request: Request) -> HandleCheckResponse:
    """Live validation for the signup form. Public, IP rate-limited."""
    limit_ip(request, action="check_handle", limit=60, window_s=60)
    h = handles.normalise(handle)
    fmt_err = handles.format_error(h)
    if fmt_err:
        return HandleCheckResponse(handle=h, available=False, reason=fmt_err)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        avail_err = await handles.availability_error(conn, h)
    if avail_err:
        return HandleCheckResponse(handle=h, available=False, reason=avail_err)
    return HandleCheckResponse(handle=h, available=True)


# ── Onboarding — create profile from a Stack Auth token ────────────────────

class OnboardBody(BaseModel):
    handle: str = Field(min_length=handles.HANDLE_MIN, max_length=handles.HANDLE_MAX)
    email: EmailStr
    team_id: str | None = None


class OnboardResponse(BaseModel):
    id: str
    handle: str


def _decode_stack_token(creds: HTTPAuthorizationCredentials | None,
                        settings: Settings) -> dict:
    if not settings.auth_enabled:
        raise HTTPException(503, "Auth not yet enabled on this deployment.")
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token.")
    try:
        signing_key = _get_jwks_client(settings).get_signing_key_from_jwt(creds.credentials)
        return jwt.decode(
            creds.credentials, signing_key.key,
            algorithms=["ES256", "RS256"],
            audience=settings.stack_project_id,
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}") from e


@router.post("/auth/onboard", response_model=OnboardResponse,
             status_code=status.HTTP_201_CREATED)
async def complete_onboarding(
    body: OnboardBody,
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> OnboardResponse:
    """Create the user row tied to a Stack Auth subject. One-shot — if the
    user already exists, return their existing row instead of failing."""
    limit_ip(request, action="onboard", limit=10, window_s=600)
    payload = _decode_stack_token(credentials, settings)
    external_id = payload["sub"]
    handle = handles.normalise(body.handle)

    fmt_err = handles.format_error(handle)
    if fmt_err:
        raise HTTPException(400, fmt_err)

    pool = request.app.state.pool
    async with pool.acquire() as conn, conn.transaction():
        existing = await conn.fetchrow(
            "SELECT id::text, handle FROM users WHERE external_id = $1",
            external_id,
        )
        if existing:
            return OnboardResponse(id=existing["id"], handle=existing["handle"])

        avail_err = await handles.availability_error(conn, handle)
        if avail_err:
            raise HTTPException(409, avail_err)

        if body.team_id:
            team = await conn.fetchval(
                "SELECT 1 FROM teams WHERE id = $1", body.team_id,
            )
            if not team:
                raise HTTPException(400, "Unknown team_id.")

        row = await conn.fetchrow(
            """
            INSERT INTO users (handle, external_id, email, team_id, is_admin, is_house_account)
            VALUES ($1, $2, $3, $4, false, false)
            RETURNING id::text, handle
            """,
            handle, external_id, str(body.email), body.team_id,
        )
    log.info("user_onboarded", handle=handle, external_id=external_id)
    return OnboardResponse(id=row["id"], handle=row["handle"])
