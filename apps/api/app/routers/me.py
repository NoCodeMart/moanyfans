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
    bio: str | None = None
    avatar_seed: str | None = None
    avatar_style: str | None = None
    created_at: str | None = None


class SetTeamRequest(BaseModel):
    team_slug: str


class UpdateMeRequest(BaseModel):
    bio: str | None = None
    avatar_seed: str | None = None
    avatar_style: str | None = None


class ProfileStats(BaseModel):
    moans: int
    laughs_received: int
    agrees_received: int
    cope_received: int
    ratio_received: int
    streak_days: int


async def _build_me(request: Request, user: CurrentUser, auth_enabled: bool) -> MeResponse:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT u.id::text, u.handle, u.email, u.team_id::text,
                   u.team_set_at, u.bio, u.avatar_seed, u.avatar_style, u.created_at,
                   t.slug AS team_slug, t.name AS team_name,
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
        bio=row["bio"] if row else None,
        avatar_seed=row["avatar_seed"] if row else None,
        avatar_style=row["avatar_style"] if row else None,
        created_at=row["created_at"].isoformat() if row and row["created_at"] else None,
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


_ALLOWED_AVATAR_STYLES = {
    'avataaars', 'bottts', 'lorelei', 'fun-emoji', 'identicon',
    'thumbs', 'shapes', 'pixel-art', 'big-smile', 'micah',
}


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: UpdateMeRequest,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> MeResponse:
    """Edit bio + avatar customisation. Other fields are immutable here."""
    pool = request.app.state.pool
    sets: list[str] = []
    args: list = []

    if body.bio is not None:
        bio = body.bio.strip()
        if len(bio) > 200:
            raise HTTPException(400, "Bio max 200 chars")
        args.append(bio or None)
        sets.append(f"bio = ${len(args)}")
    if body.avatar_seed is not None:
        seed = body.avatar_seed.strip()[:64]
        args.append(seed or None)
        sets.append(f"avatar_seed = ${len(args)}")
    if body.avatar_style is not None:
        style = body.avatar_style.strip().lower()
        if style and style not in _ALLOWED_AVATAR_STYLES:
            raise HTTPException(400, f"Unknown avatar style {style!r}")
        args.append(style or None)
        sets.append(f"avatar_style = ${len(args)}")

    if sets:
        args.append(user.id)
        async with pool.acquire() as conn:
            await conn.execute(
                f"UPDATE users SET {', '.join(sets)} WHERE id = ${len(args)}",
                *args,
            )

    return await _build_me(request, user, settings.auth_enabled)


@router.get("/me/stats", response_model=ProfileStats)
async def my_stats(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
) -> ProfileStats:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
              count(*)                            AS moans,
              COALESCE(sum(laughs), 0)::int       AS laughs_received,
              COALESCE(sum(agrees), 0)::int       AS agrees_received,
              COALESCE(sum(cope), 0)::int         AS cope_received,
              COALESCE(sum(ratio), 0)::int        AS ratio_received
              FROM moans
             WHERE user_id = $1 AND deleted_at IS NULL
            """,
            user.id,
        )
        streak = await conn.fetchval(
            "SELECT streak_days FROM users WHERE id = $1", user.id,
        )
    return ProfileStats(
        moans=row["moans"] if row else 0,
        laughs_received=row["laughs_received"] if row else 0,
        agrees_received=row["agrees_received"] if row else 0,
        cope_received=row["cope_received"] if row else 0,
        ratio_received=row["ratio_received"] if row else 0,
        streak_days=int(streak or 0),
    )
