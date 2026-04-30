"""Public user profiles + follow / unfollow."""
from __future__ import annotations

from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..auth import CurrentUser, get_current_user
from ..services.ratelimit import limit_user

router = APIRouter(prefix="/users", tags=["users"])


class PublicUser(BaseModel):
    id: str
    handle: str
    avatar_seed: str | None = None
    avatar_style: str | None = None
    bio: str | None = None
    team_id: str | None = None
    team_slug: str | None = None
    team_name: str | None = None
    team_primary: str | None = None
    is_house_account: bool = False
    follower_count: int = 0
    following_count: int = 0
    moan_count: int = 0
    you_follow: bool = False
    follows_you: bool = False
    you_blocked: bool = False
    blocked_you: bool = False
    you_muted: bool = False
    created_at: str | None = None


_USER_SQL = """
SELECT u.id::text, u.handle, u.avatar_seed, u.avatar_style, u.bio,
       u.team_id::text, t.slug AS team_slug, t.name AS team_name,
       t.primary_color AS team_primary,
       u.is_house_account, u.follower_count, u.following_count,
       u.created_at,
       (SELECT count(*) FROM moans WHERE user_id = u.id
          AND deleted_at IS NULL AND status = 'PUBLISHED')::int AS moan_count
  FROM users u
  LEFT JOIN teams t ON t.id = u.team_id
 WHERE lower(u.handle) = lower($1) AND u.deleted_at IS NULL
"""


async def _load_public(
    pool: asyncpg.Pool, handle: str, viewer_id: str | None,
) -> PublicUser:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(_USER_SQL, handle)
        if not row:
            raise HTTPException(404, "User not found")
        you_follow = False
        follows_you = False
        you_blocked = False
        blocked_you = False
        you_muted = False
        if viewer_id and viewer_id != row["id"]:
            you_follow = bool(await conn.fetchval(
                "SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2",
                viewer_id, row["id"],
            ))
            follows_you = bool(await conn.fetchval(
                "SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2",
                row["id"], viewer_id,
            ))
            you_blocked = bool(await conn.fetchval(
                "SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2",
                viewer_id, row["id"],
            ))
            blocked_you = bool(await conn.fetchval(
                "SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2",
                row["id"], viewer_id,
            ))
            you_muted = bool(await conn.fetchval(
                "SELECT 1 FROM user_mutes WHERE muter_id = $1 AND muted_id = $2",
                viewer_id, row["id"],
            ))
    return PublicUser(
        id=row["id"], handle=row["handle"],
        avatar_seed=row["avatar_seed"], avatar_style=row["avatar_style"],
        bio=row["bio"], team_id=row["team_id"],
        team_slug=row["team_slug"], team_name=row["team_name"],
        team_primary=row["team_primary"],
        is_house_account=row["is_house_account"],
        follower_count=row["follower_count"],
        following_count=row["following_count"],
        moan_count=row["moan_count"],
        you_follow=you_follow, follows_you=follows_you,
        you_blocked=you_blocked, blocked_you=blocked_you,
        you_muted=you_muted,
        created_at=row["created_at"].isoformat() if row["created_at"] else None,
    )


@router.get("/{handle}", response_model=PublicUser)
async def get_user(
    handle: str, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> PublicUser:
    return await _load_public(request.app.state.pool, handle, user.id)


@router.post("/{handle}/follow", response_model=PublicUser,
             status_code=status.HTTP_201_CREATED)
async def follow(
    handle: str, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> PublicUser:
    # Anti-abuse: max 60 follow toggles / minute per user
    limit_user(user, action="follow", limit=60, window_s=60)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        target_id = await conn.fetchval(
            "SELECT id FROM users WHERE lower(handle) = lower($1) AND deleted_at IS NULL",
            handle,
        )
        if not target_id:
            raise HTTPException(404, "User not found")
        if str(target_id) == user.id:
            raise HTTPException(400, "You cannot follow yourself")
        # Either side blocking severs follow attempts.
        if await conn.fetchval(
            "SELECT 1 FROM user_blocks "
            "WHERE (blocker_id = $1 AND blocked_id = $2) "
            "   OR (blocker_id = $2 AND blocked_id = $1)",
            user.id, target_id,
        ):
            raise HTTPException(403, "Cannot follow this user.")
        await conn.execute(
            "INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2) "
            "ON CONFLICT DO NOTHING",
            user.id, target_id,
        )
    return await _load_public(pool, handle, user.id)


@router.delete("/{handle}/follow", response_model=PublicUser)
async def unfollow(
    handle: str, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> PublicUser:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        target_id = await conn.fetchval(
            "SELECT id FROM users WHERE lower(handle) = lower($1) AND deleted_at IS NULL",
            handle,
        )
        if not target_id:
            raise HTTPException(404, "User not found")
        await conn.execute(
            "DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2",
            user.id, target_id,
        )
    return await _load_public(pool, handle, user.id)


class FollowListItem(BaseModel):
    handle: str
    avatar_seed: str | None = None
    avatar_style: str | None = None
    team_primary: str | None = None
    bio: str | None = None
    you_follow: bool = False


@router.post("/{handle}/mute", response_model=PublicUser, status_code=status.HTTP_201_CREATED)
async def mute(
    handle: str, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> PublicUser:
    limit_user(user, action="mute", limit=60, window_s=60)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        target_id = await conn.fetchval(
            "SELECT id FROM users WHERE lower(handle) = lower($1) AND deleted_at IS NULL",
            handle,
        )
        if not target_id:
            raise HTTPException(404, "User not found")
        if str(target_id) == user.id:
            raise HTTPException(400, "You cannot mute yourself")
        await conn.execute(
            "INSERT INTO user_mutes (muter_id, muted_id) VALUES ($1, $2) "
            "ON CONFLICT DO NOTHING",
            user.id, target_id,
        )
    return await _load_public(pool, handle, user.id)


@router.delete("/{handle}/mute", response_model=PublicUser)
async def unmute(
    handle: str, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> PublicUser:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        target_id = await conn.fetchval(
            "SELECT id FROM users WHERE lower(handle) = lower($1) AND deleted_at IS NULL",
            handle,
        )
        if not target_id:
            raise HTTPException(404, "User not found")
        await conn.execute(
            "DELETE FROM user_mutes WHERE muter_id = $1 AND muted_id = $2",
            user.id, target_id,
        )
    return await _load_public(pool, handle, user.id)


@router.post("/{handle}/block", response_model=PublicUser, status_code=status.HTTP_201_CREATED)
async def block(
    handle: str, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> PublicUser:
    limit_user(user, action="block", limit=30, window_s=60)
    pool = request.app.state.pool
    async with pool.acquire() as conn, conn.transaction():
        target_id = await conn.fetchval(
            "SELECT id FROM users WHERE lower(handle) = lower($1) AND deleted_at IS NULL",
            handle,
        )
        if not target_id:
            raise HTTPException(404, "User not found")
        if str(target_id) == user.id:
            raise HTTPException(400, "You cannot block yourself")
        await conn.execute(
            "INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) "
            "ON CONFLICT DO NOTHING",
            user.id, target_id,
        )
        # Blocking severs follows in both directions — prevents stale follow
        # state from leaking into notifications/feeds for either party.
        await conn.execute(
            "DELETE FROM follows WHERE (follower_id = $1 AND followed_id = $2) "
            "OR (follower_id = $2 AND followed_id = $1)",
            user.id, target_id,
        )
    return await _load_public(pool, handle, user.id)


@router.delete("/{handle}/block", response_model=PublicUser)
async def unblock(
    handle: str, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> PublicUser:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        target_id = await conn.fetchval(
            "SELECT id FROM users WHERE lower(handle) = lower($1) AND deleted_at IS NULL",
            handle,
        )
        if not target_id:
            raise HTTPException(404, "User not found")
        await conn.execute(
            "DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2",
            user.id, target_id,
        )
    return await _load_public(pool, handle, user.id)


@router.get("/{handle}/followers", response_model=list[FollowListItem])
async def followers(
    handle: str, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    limit: int = 100,
) -> list[FollowListItem]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT u.handle, u.avatar_seed, u.avatar_style, u.bio,
                   t.primary_color AS team_primary,
                   EXISTS(SELECT 1 FROM follows fy
                            WHERE fy.follower_id = $1 AND fy.followed_id = u.id) AS you_follow
              FROM follows f
              JOIN users u ON u.id = f.follower_id
              LEFT JOIN teams t ON t.id = u.team_id
             WHERE f.followed_id = (SELECT id FROM users WHERE lower(handle) = lower($2))
             ORDER BY f.created_at DESC LIMIT $3
            """,
            user.id, handle, limit,
        )
    return [FollowListItem(**dict(r)) for r in rows]


@router.get("/{handle}/following", response_model=list[FollowListItem])
async def following(
    handle: str, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    limit: int = 100,
) -> list[FollowListItem]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT u.handle, u.avatar_seed, u.avatar_style, u.bio,
                   t.primary_color AS team_primary,
                   EXISTS(SELECT 1 FROM follows fy
                            WHERE fy.follower_id = $1 AND fy.followed_id = u.id) AS you_follow
              FROM follows f
              JOIN users u ON u.id = f.followed_id
              LEFT JOIN teams t ON t.id = u.team_id
             WHERE f.follower_id = (SELECT id FROM users WHERE lower(handle) = lower($2))
             ORDER BY f.created_at DESC LIMIT $3
            """,
            user.id, handle, limit,
        )
    return [FollowListItem(**dict(r)) for r in rows]
