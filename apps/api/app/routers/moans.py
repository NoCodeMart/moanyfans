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

MoanKind = Literal["MOAN", "ROAST", "BANTER", "COPE", "RUMOUR", "POLL"]
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
    avatar_style: str | None = None
    team_id: str | None = None
    is_house_account: bool = False


class RumourTeam(BaseModel):
    slug: str
    name: str
    short_name: str
    primary_color: str | None = None


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
    media_path: str | None = None
    media_w: int | None = None
    media_h: int | None = None
    media_mime: str | None = None
    created_at: str  # ISO 8601
    # Transfer rumour fields — populated only when kind == 'RUMOUR'
    rumour_player: str | None = None
    rumour_from: RumourTeam | None = None
    rumour_to: RumourTeam | None = None
    rumour_fee: str | None = None
    rumour_source_url: str | None = None
    rumour_status: str | None = None  # CONFIRMED | BUSTED | null (pending)
    rumour_here_we_go: int = 0
    rumour_bollocks: int = 0
    rumour_get_a_grip: int = 0
    rumour_your_vote: str | None = None  # HERE_WE_GO | BOLLOCKS | GET_A_GRIP | null
    # Poll fields — populated only when kind == 'POLL'
    poll_options: list[dict] | None = None  # [{label, votes}]
    poll_total_votes: int = 0
    poll_closes_at: str | None = None
    poll_your_choice: int | None = None


class CreateMoan(BaseModel):
    kind: MoanKind
    text: str = Field(min_length=1, max_length=500)
    team_slug: str | None = None
    target_handle: str | None = None
    parent_moan_id: str | None = None
    rage_level: int = Field(default=5, ge=0, le=10)
    fixture_id: str | None = None
    side: Literal["HOME", "AWAY", "NEUTRAL"] | None = None
    media_path: str | None = Field(default=None, max_length=120, pattern=r"^[a-f0-9]{2}/[a-f0-9]{32}\.webp$")
    media_w: int | None = Field(default=None, ge=1, le=10_000)
    media_h: int | None = Field(default=None, ge=1, le=10_000)
    media_mime: str | None = Field(default=None, max_length=40)
    # Transfer rumour structured fields (only used when kind == 'RUMOUR')
    rumour_player: str | None = Field(default=None, max_length=80)
    rumour_from_slug: str | None = Field(default=None, max_length=40)
    rumour_to_slug: str | None = Field(default=None, max_length=40)
    rumour_fee: str | None = Field(default=None, max_length=60)
    rumour_source_url: str | None = Field(default=None, max_length=300)
    # Poll structured fields (only used when kind == 'POLL')
    poll_options: list[str] | None = Field(default=None, max_length=4)
    poll_duration_hours: int | None = Field(default=None, ge=1, le=168)  # 1h–1wk


class ReactionRequest(BaseModel):
    kind: ReactionKind | None  # null = remove reaction


_FEED_SQL = """
SELECT
  m.id::text                          AS id,
  m.kind, m.status, m.text, m.rage_level,
  m.laughs, m.agrees, m.cope, m.ratio,
  m.reply_count, m.share_count,
  m.parent_moan_id::text              AS parent_moan_id,
  m.media_path, m.media_w, m.media_h, m.media_mime,
  m.created_at,
  u.id::text                          AS user_id,
  u.handle                            AS user_handle,
  u.avatar_seed                       AS user_avatar_seed,
  u.avatar_style                      AS user_avatar_style,
  u.is_house_account                  AS user_is_house,
  u.team_id::text                     AS user_team_id,
  t.id::text                          AS team_id,
  t.slug                              AS team_slug,
  t.name                              AS team_name,
  t.primary_color                     AS team_primary,
  t.secondary_color                   AS team_secondary,
  tu.id::text                         AS target_id,
  tu.handle                           AS target_handle,
  tu.avatar_seed                      AS target_avatar_seed,
  tu.avatar_style                     AS target_avatar_style,
  tu.is_house_account                 AS target_is_house,
  tu.team_id::text                    AS target_team_id,
  COALESCE(
    (SELECT array_agg(tg.slug) FROM moan_tags mt
       JOIN tags tg ON tg.id = mt.tag_id
      WHERE mt.moan_id = m.id),
    ARRAY[]::text[]
  )                                   AS tag_slugs,
  (SELECT kind FROM reactions r
     WHERE r.moan_id = m.id AND r.user_id = $1
     LIMIT 1)                         AS your_reaction,
  m.rumour_player, m.rumour_fee, m.rumour_source_url, m.rumour_status,
  rft.slug          AS rumour_from_slug,
  rft.name          AS rumour_from_name,
  rft.short_name    AS rumour_from_short,
  rft.primary_color AS rumour_from_primary,
  rtt.slug          AS rumour_to_slug,
  rtt.name          AS rumour_to_name,
  rtt.short_name    AS rumour_to_short,
  rtt.primary_color AS rumour_to_primary,
  m.poll_options    AS poll_options_raw,
  m.poll_closes_at,
  COALESCE((SELECT array_agg(choice_idx ORDER BY choice_idx)
              FROM poll_votes WHERE moan_id = m.id),
           ARRAY[]::smallint[])           AS poll_vote_indices,
  (SELECT choice_idx FROM poll_votes WHERE moan_id = m.id AND user_id = $1
     LIMIT 1)                              AS poll_your_choice,
  (SELECT count(*) FROM rumour_votes
     WHERE moan_id = m.id AND vote = 'HERE_WE_GO')   AS rumour_here_we_go,
  (SELECT count(*) FROM rumour_votes
     WHERE moan_id = m.id AND vote = 'BOLLOCKS')     AS rumour_bollocks,
  (SELECT count(*) FROM rumour_votes
     WHERE moan_id = m.id AND vote = 'GET_A_GRIP')   AS rumour_get_a_grip,
  (SELECT vote FROM rumour_votes
     WHERE moan_id = m.id AND user_id = $1 LIMIT 1)  AS rumour_your_vote
FROM moans m
JOIN users u           ON u.id = m.user_id
LEFT JOIN teams t      ON t.id = m.team_id
LEFT JOIN users tu     ON tu.id = m.target_user_id
LEFT JOIN teams rft    ON rft.id = m.rumour_from_team
LEFT JOIN teams rtt    ON rtt.id = m.rumour_to_team
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
            avatar_style=row["target_avatar_style"],
            team_id=row["target_team_id"],
            is_house_account=row["target_is_house"] or False,
        )
    return MoanOut(
        id=row["id"],
        user=UserRef(
            id=row["user_id"],
            handle=row["user_handle"],
            avatar_seed=row["user_avatar_seed"],
            avatar_style=row["user_avatar_style"],
            team_id=row["user_team_id"],
            is_house_account=row["user_is_house"] or False,
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
        media_path=row["media_path"],
        media_w=row["media_w"],
        media_h=row["media_h"],
        media_mime=row["media_mime"],
        created_at=row["created_at"].isoformat(),
        rumour_player=row.get("rumour_player"),
        rumour_fee=row.get("rumour_fee"),
        rumour_source_url=row.get("rumour_source_url"),
        rumour_status=row.get("rumour_status"),
        rumour_from=(RumourTeam(
            slug=row["rumour_from_slug"], name=row["rumour_from_name"],
            short_name=row["rumour_from_short"],
            primary_color=row["rumour_from_primary"],
        ) if row.get("rumour_from_slug") else None),
        rumour_to=(RumourTeam(
            slug=row["rumour_to_slug"], name=row["rumour_to_name"],
            short_name=row["rumour_to_short"],
            primary_color=row["rumour_to_primary"],
        ) if row.get("rumour_to_slug") else None),
        poll_options=_build_poll_options(row),
        poll_total_votes=len(row.get("poll_vote_indices") or []),
        poll_closes_at=(row["poll_closes_at"].isoformat()
                          if row.get("poll_closes_at") else None),
        poll_your_choice=row.get("poll_your_choice"),
        rumour_here_we_go=row.get("rumour_here_we_go") or 0,
        rumour_bollocks=row.get("rumour_bollocks") or 0,
        rumour_get_a_grip=row.get("rumour_get_a_grip") or 0,
        rumour_your_vote=row.get("rumour_your_vote"),
    )


def _build_poll_options(row: asyncpg.Record) -> list[dict] | None:
    """Combine the labels stored in moans.poll_options with the live vote
    counts derived from poll_votes. Returns None for non-poll moans."""
    raw = row.get("poll_options_raw")
    if not raw:
        return None
    import json
    labels = json.loads(raw) if isinstance(raw, str) else raw
    indices = row.get("poll_vote_indices") or []
    counts = [0] * len(labels)
    for i in indices:
        if 0 <= i < len(labels):
            counts[i] += 1
    return [{"label": labels[i], "votes": counts[i]} for i in range(len(labels))]


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
    tag: str | None = Query(default=None, description="Filter by hashtag slug (no leading #)"),
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
        " AND m.user_id NOT IN ("
        "   SELECT blocker_id FROM user_blocks WHERE blocked_id = $1"
        "   UNION"
        "   SELECT blocked_id FROM user_blocks WHERE blocker_id = $1"
        "   UNION"
        "   SELECT muted_id FROM user_mutes WHERE muter_id = $1)"
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
    if tag:
        args.append(tag.upper().lstrip("#")[:32])
        sql += (f" AND m.id IN (SELECT mt.moan_id FROM moan_tags mt"
                f" JOIN tags tg ON tg.id = mt.tag_id WHERE tg.slug = ${len(args)})")
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
            _FEED_SQL + " WHERE m.id = $2 AND m.deleted_at IS NULL"
            " AND m.user_id NOT IN ("
            "   SELECT blocker_id FROM user_blocks WHERE blocked_id = $1"
            "   UNION"
            "   SELECT blocked_id FROM user_blocks WHERE blocker_id = $1"
            "   UNION"
            "   SELECT muted_id FROM user_mutes WHERE muter_id = $1)",
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
            " AND m.status = 'PUBLISHED'"
            " AND m.user_id NOT IN ("
            "   SELECT blocker_id FROM user_blocks WHERE blocked_id = $1"
            "   UNION"
            "   SELECT blocked_id FROM user_blocks WHERE blocker_id = $1"
            "   UNION"
            "   SELECT muted_id FROM user_mutes WHERE muter_id = $1)"
            " ORDER BY m.created_at ASC",
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

    # Resolve rumour team slugs → IDs (only if RUMOUR kind)
    rumour_from_id: str | None = None
    rumour_to_id: str | None = None
    if body.kind == "RUMOUR":
        async with pool.acquire() as conn:
            if body.rumour_from_slug:
                rumour_from_id = await conn.fetchval(
                    "SELECT id::text FROM teams WHERE slug = $1", body.rumour_from_slug,
                )
                if not rumour_from_id:
                    raise HTTPException(400, f"Unknown from-team slug: {body.rumour_from_slug}")
            if body.rumour_to_slug:
                rumour_to_id = await conn.fetchval(
                    "SELECT id::text FROM teams WHERE slug = $1", body.rumour_to_slug,
                )
                if not rumour_to_id:
                    raise HTTPException(400, f"Unknown to-team slug: {body.rumour_to_slug}")

    async with pool.acquire() as conn, conn.transaction():
        new_id = await conn.fetchval(
            """
            INSERT INTO moans (user_id, team_id, target_user_id, parent_moan_id, kind, status,
              text, rage_level, moderation_score, moderation_reason,
              fixture_id, match_minute, side,
              media_path, media_w, media_h, media_mime,
              rumour_player, rumour_from_team, rumour_to_team, rumour_fee, rumour_source_url,
              poll_options, poll_closes_at)
            VALUES ($1, $2, $3, $4, $5, $6::moan_status, $7, $8, $9, $10, $11, $12, $13,
              $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb,
              CASE WHEN $24::int IS NOT NULL
                   THEN now() + ($24 || ' hours')::interval
                   ELSE NULL END)
            RETURNING id::text
            """,
            user.id, team_id, target_id, body.parent_moan_id, body.kind, new_status,
            body.text, body.rage_level, mod.score, mod.reason,
            body.fixture_id, match_minute, body.side,
            body.media_path, body.media_w, body.media_h, body.media_mime,
            body.rumour_player, rumour_from_id, rumour_to_id,
            body.rumour_fee, body.rumour_source_url,
            (None if body.kind != "POLL" or not body.poll_options
                  else __import__("json").dumps([s.strip()[:60] for s in body.poll_options
                                                  if s.strip()][:4])),
            body.poll_duration_hours if body.kind == "POLL" else None,
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
    limit_user(user, action="react", limit=120, window_s=60)
    pool = request.app.state.pool
    async with pool.acquire() as conn, conn.transaction():
        # Block check: can't react on a moan if either side has blocked the other.
        if await conn.fetchval(
            "SELECT 1 FROM moans m JOIN user_blocks b "
            "  ON (b.blocker_id = m.user_id AND b.blocked_id = $1) "
            "  OR (b.blocker_id = $1 AND b.blocked_id = m.user_id) "
            "WHERE m.id = $2",
            user.id, moan_id,
        ):
            raise HTTPException(403, "Cannot react on this moan.")
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


@router.delete("/{moan_id}")
async def delete_moan(
    moan_id: str,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, str]:
    """Soft-delete a moan. Author only. Reply chain stays intact —
    the row is hidden everywhere by the deleted_at IS NULL filter."""
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        owner = await conn.fetchval(
            "SELECT user_id::text FROM moans WHERE id = $1 AND deleted_at IS NULL",
            moan_id,
        )
        if not owner:
            raise HTTPException(404, "Moan not found")
        if owner != user.id:
            raise HTTPException(403, "Not your moan to delete")
        await conn.execute(
            "UPDATE moans SET deleted_at = now() WHERE id = $1",
            moan_id,
        )
    return {"status": "deleted"}


class PollVoteBody(BaseModel):
    choice_idx: int = Field(ge=0, le=3)


@router.post("/{moan_id}/vote", response_model=MoanOut)
async def vote_on_poll(
    moan_id: str, body: PollVoteBody, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> MoanOut:
    limit_user(user, action="poll_vote", limit=60, window_s=60)
    pool = request.app.state.pool
    async with pool.acquire() as conn, conn.transaction():
        info = await conn.fetchrow(
            "SELECT kind::text AS kind, poll_options, poll_closes_at, deleted_at "
            "FROM moans WHERE id = $1", moan_id,
        )
        if not info or info["deleted_at"] is not None:
            raise HTTPException(404, "Poll not found.")
        if info["kind"] != "POLL" or not info["poll_options"]:
            raise HTTPException(400, "Not a poll.")
        if info["poll_closes_at"]:
            from datetime import UTC, datetime
            closes = info["poll_closes_at"]
            if closes.tzinfo is None:
                closes = closes.replace(tzinfo=UTC)
            if closes < datetime.now(UTC):
                raise HTTPException(400, "Poll closed.")
        import json
        labels = json.loads(info["poll_options"]) if isinstance(info["poll_options"], str) \
                   else info["poll_options"]
        if body.choice_idx >= len(labels):
            raise HTTPException(400, "Invalid choice.")
        # Vote is single-choice — flips on conflict so users can change mind.
        await conn.execute(
            """
            INSERT INTO poll_votes (moan_id, user_id, choice_idx)
            VALUES ($1, $2, $3)
            ON CONFLICT (moan_id, user_id) DO UPDATE SET choice_idx = EXCLUDED.choice_idx
            """,
            moan_id, user.id, body.choice_idx,
        )
        row = await conn.fetchrow(_FEED_SQL + " WHERE m.id = $2", user.id, moan_id)
    if not row:
        raise HTTPException(404, "Moan not found")
    return _row_to_moan(row)


class RumourVoteBody(BaseModel):
    vote: Literal["HERE_WE_GO", "BOLLOCKS", "GET_A_GRIP"] | None  # null = remove


@router.post("/{moan_id}/rumour-vote", response_model=MoanOut)
async def vote_on_rumour(
    moan_id: str, body: RumourVoteBody, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> MoanOut:
    limit_user(user, action="rumour_vote", limit=60, window_s=60)
    pool = request.app.state.pool
    async with pool.acquire() as conn, conn.transaction():
        info = await conn.fetchrow(
            "SELECT kind::text AS kind, deleted_at FROM moans WHERE id = $1", moan_id,
        )
        if not info or info["deleted_at"] is not None:
            raise HTTPException(404, "Rumour not found.")
        if info["kind"] != "RUMOUR":
            raise HTTPException(400, "Not a rumour.")
        if body.vote is None:
            await conn.execute(
                "DELETE FROM rumour_votes WHERE moan_id = $1 AND user_id = $2",
                moan_id, user.id,
            )
        else:
            await conn.execute(
                """
                INSERT INTO rumour_votes (moan_id, user_id, vote)
                VALUES ($1, $2, $3)
                ON CONFLICT (moan_id, user_id) DO UPDATE SET vote = EXCLUDED.vote
                """,
                moan_id, user.id, body.vote,
            )
        row = await conn.fetchrow(_FEED_SQL + " WHERE m.id = $2", user.id, moan_id)
    if not row:
        raise HTTPException(404, "Moan not found")
    return _row_to_moan(row)


class RumourStatusBody(BaseModel):
    status: Literal["CONFIRMED", "BUSTED"] | None  # null = un-resolve


@router.post("/{moan_id}/rumour-status", response_model=MoanOut)
async def set_rumour_status(
    moan_id: str, body: RumourStatusBody, request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> MoanOut:
    if not user.is_admin:
        raise HTTPException(403, "Admin only.")
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        info = await conn.fetchrow(
            "SELECT kind::text AS kind, deleted_at FROM moans WHERE id = $1", moan_id,
        )
        if not info or info["deleted_at"] is not None:
            raise HTTPException(404, "Rumour not found.")
        if info["kind"] != "RUMOUR":
            raise HTTPException(400, "Not a rumour.")
        await conn.execute(
            "UPDATE moans SET rumour_status = $1::text, "
            "rumour_resolved_at = CASE WHEN $1::text IS NULL THEN NULL ELSE now() END "
            "WHERE id = $2",
            body.status, moan_id,
        )
        row = await conn.fetchrow(_FEED_SQL + " WHERE m.id = $2", user.id, moan_id)
    if not row:
        raise HTTPException(404, "Moan not found")
    return _row_to_moan(row)


@router.post("/{moan_id}/report", status_code=status.HTTP_201_CREATED)
async def report_moan(
    moan_id: str,
    body: ReportRequest,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, str]:
    limit_user(user, action="report", limit=10, window_s=600)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        # Dedupe — one report per (reporter, moan). Stops one user tripping
        # the auto-hide threshold solo.
        existing = await conn.fetchval(
            "SELECT 1 FROM reports WHERE moan_id = $1 AND reporter_id = $2",
            moan_id, user.id,
        )
        if existing:
            return {"status": "already_reported"}
        await conn.execute(
            "INSERT INTO reports (moan_id, reporter_id, reason) VALUES ($1, $2, $3)",
            moan_id, user.id, body.reason,
        )
        # Auto-hide after 3 distinct reporters.
        count = await conn.fetchval(
            "SELECT count(DISTINCT reporter_id) FROM reports "
            "WHERE moan_id = $1 AND resolved = false",
            moan_id,
        )
        if count >= 3:
            await conn.execute(
                "UPDATE moans SET status = 'HELD' WHERE id = $1 AND status = 'PUBLISHED'",
                moan_id,
            )
    return {"status": "received"}
