from __future__ import annotations

import asyncio
import random
from typing import Annotated, Literal

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from ..auth import CurrentUser, get_current_user
from ..services import house_ai
from ..services.moderation import moderate_moan
from ..services.ratelimit import limit_user
from ..services.tags import attach_tags_to_moan, extract_tags, upsert_tags

log = structlog.get_logger(__name__)
_COPE_REPLY_PROBABILITY = 0.30

router = APIRouter(prefix="/moans", tags=["moans"])

MoanKind = Literal["MOAN", "ROAST", "COPE", "BANTER"]
ReactionKind = Literal["laughs", "agrees", "cope", "ratio"]
MoanStatus = Literal["PUBLISHED", "HELD", "REJECTED", "REMOVED"]


class TeamRef(BaseModel):
    id: str
    slug: str
    name: str
    primary_color: str
    secondary_color: str


class UserRef(BaseModel):
    id: str
    handle: str
    avatar_seed: str | None = None
    team_id: str | None = None


class MoanOut(BaseModel):
    id: str
    user: UserRef
    team: TeamRef | None = None
    target_user: UserRef | None = None
    parent_moan_id: str | None = None
    kind: MoanKind
    status: MoanStatus
    text: str
    rage_level: int
    laughs: int
    agrees: int
    cope: int
    ratio: int
    reply_count: int
    share_count: int
    tags: list[str] = Field(default_factory=list)
    your_reaction: ReactionKind | None = None
    created_at: str  # ISO 8601


class CreateMoan(BaseModel):
    kind: MoanKind
    text: str = Field(min_length=1, max_length=500)
    team_slug: str | None = None
    target_handle: str | None = None
    parent_moan_id: str | None = None
    rage_level: int = Field(default=5, ge=0, le=10)
    fixture_id: str | None = None
    side: Literal["HOME", "AWAY", "NEUTRAL"] | None = None


class ReactionRequest(BaseModel):
    kind: ReactionKind | None  # null = remove reaction


_FEED_SQL = """
SELECT
  m.id::text                          AS id,
  m.kind, m.status, m.text, m.rage_level,
  m.laughs, m.agrees, m.cope, m.ratio,
  m.reply_count, m.share_count,
  m.parent_moan_id::text              AS parent_moan_id,
  m.created_at,
  u.id::text                          AS user_id,
  u.handle                            AS user_handle,
  u.avatar_seed                       AS user_avatar_seed,
  u.team_id::text                     AS user_team_id,
  t.id::text                          AS team_id,
  t.slug                              AS team_slug,
  t.name                              AS team_name,
  t.primary_color                     AS team_primary,
  t.secondary_color                   AS team_secondary,
  tu.id::text                         AS target_id,
  tu.handle                           AS target_handle,
  tu.avatar_seed                      AS target_avatar_seed,
  tu.team_id::text                    AS target_team_id,
  COALESCE(
    (SELECT array_agg(tg.slug) FROM moan_tags mt
       JOIN tags tg ON tg.id = mt.tag_id
      WHERE mt.moan_id = m.id),
    ARRAY[]::text[]
  )                                   AS tag_slugs,
  (SELECT kind FROM reactions r
     WHERE r.moan_id = m.id AND r.user_id = $1
     LIMIT 1)                         AS your_reaction
FROM moans m
JOIN users u           ON u.id = m.user_id
LEFT JOIN teams t      ON t.id = m.team_id
LEFT JOIN users tu     ON tu.id = m.target_user_id
"""


def _row_to_moan(row: asyncpg.Record) -> MoanOut:
    team = None
    if row["team_id"]:
        team = TeamRef(
            id=row["team_id"],
            slug=row["team_slug"],
            name=row["team_name"],
            primary_color=row["team_primary"],
            secondary_color=row["team_secondary"],
        )
    target = None
    if row["target_id"]:
        target = UserRef(
            id=row["target_id"],
            handle=row["target_handle"],
            avatar_seed=row["target_avatar_seed"],
            team_id=row["target_team_id"],
        )
    return MoanOut(
        id=row["id"],
        user=UserRef(
            id=row["user_id"],
            handle=row["user_handle"],
            avatar_seed=row["user_avatar_seed"],
            team_id=row["user_team_id"],
        ),
        team=team,
        target_user=target,
        parent_moan_id=row["parent_moan_id"],
        kind=row["kind"],
        status=row["status"],
        text=row["text"],
        rage_level=row["rage_level"],
        laughs=row["laughs"],
        agrees=row["agrees"],
        cope=row["cope"],
        ratio=row["ratio"],
        reply_count=row["reply_count"],
        share_count=row["share_count"],
        tags=[f"#{s}" for s in row["tag_slugs"]],
        your_reaction=row["your_reaction"],
        created_at=row["created_at"].isoformat(),
    )


@router.get("", response_model=list[MoanOut])
async def list_feed(
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    team: str | None = Query(default=None, description="Filter by team slug"),
    kind: MoanKind | None = None,
    sport: str | None = None,
    league: str | None = None,
    user_handle: str | None = Query(default=None, alias="user",
                                     description="Filter by author handle"),
    mine: bool = Query(default=False, description="Only the signed-in user's moans"),
    following: bool = Query(default=False, description="Only moans from accounts you follow"),
    limit: int = Query(default=50, ge=1, le=100),
    before: str | None = Query(default=None, description="Cursor: ISO timestamp"),
) -> list[MoanOut]:
    """Public feed — top-level moans only (no replies), newest first."""
    pool = request.app.state.pool
    sql = _FEED_SQL + (
        " WHERE m.deleted_at IS NULL"
        " AND m.status = 'PUBLISHED'"
        " AND m.parent_moan_id IS NULL"
    )
    args: list = [user.id]
    if team:
        args.append(team)
        sql += f" AND t.slug = ${len(args)}"
    if kind:
        args.append(kind)
        sql += f" AND m.kind = ${len(args)}"
    if sport:
        args.append(sport)
        sql += f" AND t.sport = ${len(args)}"
    if league:
        args.append(league)
        sql += f" AND t.league = ${len(args)}"
    if mine:
        args.append(user.id)
        sql += f" AND m.user_id = ${len(args)}"
    elif user_handle:
        args.append(user_handle.upper())
        sql += f" AND u.handle = ${len(args)}"
    if following:
        args.append(user.id)
        sql += f" AND m.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ${len(args)})"
    if before:
        args.append(before)
        sql += f" AND m.created_at < ${len(args)}::timestamptz"
    args.append(limit)
    sql += f" ORDER BY m.created_at DESC LIMIT ${len(args)}"
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    return [_row_to_moan(r) for r in rows]


@router.get("/{moan_id}", response_model=MoanOut)
async def get_moan(
    moan_id: str,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> MoanOut:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _FEED_SQL + " WHERE m.id = $2 AND m.deleted_at IS NULL",
            user.id,
            moan_id,
        )
    if not row:
        raise HTTPException(404, "Moan not found")
    return _row_to_moan(row)


@router.get("/{moan_id}/replies", response_model=list[MoanOut])
async def list_replies(
    moan_id: str,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> list[MoanOut]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            _FEED_SQL + " WHERE m.parent_moan_id = $2 AND m.deleted_at IS NULL "
            " AND m.status = 'PUBLISHED' ORDER BY m.created_at ASC",
            user.id,
            moan_id,
        )
    return [_row_to_moan(r) for r in rows]


@router.post("", response_model=MoanOut, status_code=status.HTTP_201_CREATED)
async def create_moan(
    body: CreateMoan,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> MoanOut:
    # Anti-spam: 30 moans / minute per user
    limit_user(user, action="create_moan", limit=30, window_s=60)
    pool = request.app.state.pool

    async with pool.acquire() as conn:
        # Resolve team
        team_id: str | None = None
        if body.team_slug:
            team_id = await conn.fetchval("SELECT id FROM teams WHERE slug = $1", body.team_slug)
            if not team_id:
                raise HTTPException(400, f"Team {body.team_slug!r} not found")
        elif user.team_id:
            team_id = user.team_id

        # Resolve target user (for ROASTs)
        target_id: str | None = None
        if body.target_handle:
            target_id = await conn.fetchval(
                "SELECT id FROM users WHERE handle = $1", body.target_handle.upper()
            )
            if not target_id:
                raise HTTPException(400, f"User @{body.target_handle} not found")

        if body.parent_moan_id:
            parent_status = await conn.fetchval(
                "SELECT status FROM moans WHERE id = $1 AND deleted_at IS NULL",
                body.parent_moan_id,
            )
            if parent_status != "PUBLISHED":
                raise HTTPException(400, "Parent moan is not available for reply")

        # Live moan: validate fixture, derive match minute server-side
        match_minute: int | None = None
        if body.fixture_id:
            from datetime import UTC, datetime
            fx = await conn.fetchrow(
                "SELECT kickoff_at, status FROM fixtures WHERE id = $1",
                body.fixture_id,
            )
            if not fx:
                raise HTTPException(400, f"Fixture {body.fixture_id!r} not found")
            kickoff = fx["kickoff_at"]
            if kickoff.tzinfo is None:
                kickoff = kickoff.replace(tzinfo=UTC)
            elapsed = (datetime.now(UTC) - kickoff).total_seconds() / 60
            match_minute = max(0, min(130, int(elapsed))) if fx["status"] == "LIVE" else (
                0 if fx["status"] == "SCHEDULED" else 90
            )

    # Moderate before write — if held, we still record but with HELD status.
    mod = await moderate_moan(body.text)
    new_status = "HELD" if mod.should_hold else "PUBLISHED"

    async with pool.acquire() as conn, conn.transaction():
        new_id = await conn.fetchval(
            """
            INSERT INTO moans (user_id, team_id, target_user_id, parent_moan_id, kind, status,
              text, rage_level, moderation_score, moderation_reason,
              fixture_id, match_minute, side)
            VALUES ($1, $2, $3, $4, $5, $6::moan_status, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id::text
            """,
            user.id, team_id, target_id, body.parent_moan_id, body.kind, new_status,
            body.text, body.rage_level, mod.score, mod.reason,
            body.fixture_id, match_minute, body.side,
        )
        # Tags
        slugs = extract_tags(body.text)
        tag_records = await upsert_tags(conn, slugs)
        await attach_tags_to_moan(conn, new_id, tag_records)

    # Re-fetch enriched row
    async with pool.acquire() as conn:
        row = await conn.fetchrow(_FEED_SQL + " WHERE m.id = $2", user.id, new_id)
    assert row is not None

    # Drama engine: roughly 30% of fresh top-level MOAN/ROAST get a COPELORD reply.
    # Fire-and-forget — never blocks the response.
    if (
        new_status == "PUBLISHED"
        and not body.parent_moan_id
        and body.kind in ("MOAN", "ROAST")
        and random.random() < _COPE_REPLY_PROBABILITY
    ):
        async def _fire_cope() -> None:
            try:
                await house_ai.copelord_reply_to(pool, new_id)
            except Exception:
                log.exception("cope_reply_task_failed", moan_id=new_id)
        asyncio.create_task(_fire_cope())

    return _row_to_moan(row)


@router.post("/{moan_id}/react", response_model=MoanOut)
async def react_to_moan(
    moan_id: str,
    body: ReactionRequest,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> MoanOut:
    """Set/swap/remove your reaction. Triggers update denormalised counts."""
    pool = request.app.state.pool
    async with pool.acquire() as conn, conn.transaction():
        existing = await conn.fetchval(
            "SELECT kind FROM reactions WHERE user_id = $1 AND moan_id = $2",
            user.id, moan_id,
        )
        if body.kind is None:
            if existing:
                await conn.execute(
                    "DELETE FROM reactions WHERE user_id = $1 AND moan_id = $2",
                    user.id, moan_id,
                )
        elif existing == body.kind:
            pass  # idempotent
        elif existing:
            await conn.execute(
                "UPDATE reactions SET kind = $1 WHERE user_id = $2 AND moan_id = $3",
                body.kind, user.id, moan_id,
            )
        else:
            await conn.execute(
                "INSERT INTO reactions (user_id, moan_id, kind) VALUES ($1, $2, $3)",
                user.id, moan_id, body.kind,
            )
        row = await conn.fetchrow(_FEED_SQL + " WHERE m.id = $2", user.id, moan_id)
    if not row:
        raise HTTPException(404, "Moan not found")
    return _row_to_moan(row)


# ── Reports ─────────────────────────────────────────────────────────────────
class ReportRequest(BaseModel):
    reason: str = Field(min_length=2, max_length=500)


@router.post("/{moan_id}/report", status_code=status.HTTP_201_CREATED)
async def report_moan(
    moan_id: str,
    body: ReportRequest,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, str]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO reports (moan_id, reporter_id, reason) VALUES ($1, $2, $3)",
            moan_id, user.id, body.reason,
        )
        # Auto-hide after 3 reports
        count = await conn.fetchval(
            "SELECT count(*) FROM reports WHERE moan_id = $1 AND resolved = false",
            moan_id,
        )
        if count >= 3:
            await conn.execute(
                "UPDATE moans SET status = 'HELD' WHERE id = $1 AND status = 'PUBLISHED'",
                moan_id,
            )
    return {"status": "received"}
