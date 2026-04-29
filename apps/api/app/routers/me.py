from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..auth import CurrentUser, get_current_user
from ..config import Settings, get_settings

router = APIRouter(tags=["me"])

TEAM_SWITCH_COOLDOWN_DAYS = 30


class MeResponse(BaseModel):
    id: str
    handle: str
    email: str
    team_id: str | None
    team_slug: str | None = None
    team_name: str | None = None
    is_admin: bool
    is_house_account: bool
    auth_enabled: bool
    can_switch_team_at: str | None = None


class SetTeamRequest(BaseModel):
    team_slug: str


async def _build_me(request: Request, user: CurrentUser, auth_enabled: bool) -> MeResponse:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT u.id::text, u.handle, u.email, u.team_id::text,
                   u.team_set_at, t.slug AS team_slug, t.name AS team_name,
                   u.is_admin, u.is_house_account
              FROM users u
         LEFT JOIN teams t ON t.id = u.team_id
             WHERE u.id = $1
            """,
            user.id,
        )
    can_switch_at: str | None = None
    if row and row["team_set_at"]:
        next_switch = row["team_set_at"] + timedelta(days=TEAM_SWITCH_COOLDOWN_DAYS)
        if next_switch > datetime.now(UTC):
            can_switch_at = next_switch.isoformat()
    return MeResponse(
        id=user.id,
        handle=user.handle,
        email=user.email,
        team_id=user.team_id,
        team_slug=row["team_slug"] if row else None,
        team_name=row["team_name"] if row else None,
        is_admin=user.is_admin,
        is_house_account=user.is_house_account,
        auth_enabled=auth_enabled,
        can_switch_team_at=can_switch_at,
    )


@router.get("/me", response_model=MeResponse)
async def me(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> MeResponse:
    return await _build_me(request, user, settings.auth_enabled)


@router.put("/me/team", response_model=MeResponse)
async def set_team(
    body: SetTeamRequest,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> MeResponse:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        team_id = await conn.fetchval(
            "SELECT id FROM teams WHERE slug = $1", body.team_slug
        )
        if not team_id:
            raise HTTPException(400, f"Team {body.team_slug!r} not found")

        # Check 30d cooldown — but only if a team is already set AND we're not the guest user
        # (the guest user can switch freely so Wayne can test).
        if user.team_id and user.handle != settings.guest_handle:
            last_set = await conn.fetchval(
                "SELECT team_set_at FROM users WHERE id = $1", user.id
            )
            if last_set and last_set + timedelta(days=TEAM_SWITCH_COOLDOWN_DAYS) > datetime.now(UTC):
                next_at = last_set + timedelta(days=TEAM_SWITCH_COOLDOWN_DAYS)
                raise HTTPException(
                    400,
                    f"Team switch on cooldown until {next_at.isoformat()}",
                )

        await conn.execute(
            "UPDATE users SET team_id = $1, team_set_at = now() WHERE id = $2",
            team_id, user.id,
        )

    # Reload current user
    refreshed = CurrentUser(
        id=user.id, handle=user.handle, external_id=user.external_id, email=user.email,
        team_id=str(team_id), is_admin=user.is_admin, is_house_account=user.is_house_account,
    )
    return await _build_me(request, refreshed, settings.auth_enabled)
