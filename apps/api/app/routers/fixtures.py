from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..auth import CurrentUser, get_current_user

router = APIRouter(prefix="/fixtures", tags=["fixtures"])


class TeamRef(BaseModel):
    id: str
    slug: str
    name: str
    short_name: str
    primary_color: str
    secondary_color: str


class FixtureOut(BaseModel):
    id: str
    competition: str
    home_team: TeamRef
    away_team: TeamRef
    kickoff_at: str
    status: str
    home_score: int | None = None
    away_score: int | None = None
    minute_estimate: int | None = None  # derived for live fixtures


class LiveEventOut(BaseModel):
    id: str
    fixture_id: str
    minute: int
    text: str
    source: str
    created_at: str


class CreateLiveEvent(BaseModel):
    minute: int = Field(ge=0, le=130)
    text: str = Field(min_length=1, max_length=400)
    source: str = Field(default="EDITORIAL", max_length=40)


_FIXTURE_SQL = """
SELECT
  f.id::text                AS id,
  f.competition,
  f.kickoff_at, f.status,
  f.home_score, f.away_score,
  ht.id::text               AS home_id,
  ht.slug                   AS home_slug,
  ht.name                   AS home_name,
  ht.short_name             AS home_short,
  ht.primary_color          AS home_primary,
  ht.secondary_color        AS home_secondary,
  at.id::text               AS away_id,
  at.slug                   AS away_slug,
  at.name                   AS away_name,
  at.short_name             AS away_short,
  at.primary_color          AS away_primary,
  at.secondary_color        AS away_secondary
FROM fixtures f
JOIN teams ht ON ht.id = f.home_team_id
JOIN teams at ON at.id = f.away_team_id
"""


def _fixture_from_row(row) -> FixtureOut:  # noqa: ANN001
    kickoff = row["kickoff_at"]
    if kickoff.tzinfo is None:
        kickoff = kickoff.replace(tzinfo=UTC)
    minute_estimate: int | None = None
    if row["status"] == "LIVE":
        elapsed = (datetime.now(UTC) - kickoff).total_seconds() / 60
        if 0 <= elapsed <= 130:
            minute_estimate = int(elapsed)
    return FixtureOut(
        id=row["id"],
        competition=row["competition"],
        kickoff_at=kickoff.isoformat(),
        status=row["status"],
        home_score=row["home_score"],
        away_score=row["away_score"],
        minute_estimate=minute_estimate,
        home_team=TeamRef(
            id=row["home_id"], slug=row["home_slug"], name=row["home_name"],
            short_name=row["home_short"],
            primary_color=row["home_primary"], secondary_color=row["home_secondary"],
        ),
        away_team=TeamRef(
            id=row["away_id"], slug=row["away_slug"], name=row["away_name"],
            short_name=row["away_short"],
            primary_color=row["away_primary"], secondary_color=row["away_secondary"],
        ),
    )


@router.get("", response_model=list[FixtureOut])
async def list_fixtures(
    request: Request,
    status_filter: str | None = Query(default=None, alias="status",
        description="LIVE | SCHEDULED | FT"),
    team: str | None = Query(default=None, description="Filter by team slug (home or away)"),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[FixtureOut]:
    pool = request.app.state.pool
    sql = _FIXTURE_SQL
    args: list = []
    where: list[str] = []
    if status_filter:
        args.append(status_filter)
        where.append(f"f.status = ${len(args)}")
    if team:
        args.append(team)
        where.append(f"(ht.slug = ${len(args)} OR at.slug = ${len(args)})")
    if where:
        sql += " WHERE " + " AND ".join(where)
    args.append(limit)
    sql += " ORDER BY f.kickoff_at ASC LIMIT $" + str(len(args))
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    return [_fixture_from_row(r) for r in rows]


@router.get("/{fixture_id}", response_model=FixtureOut)
async def get_fixture(fixture_id: str, request: Request) -> FixtureOut:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(_FIXTURE_SQL + " WHERE f.id = $1", fixture_id)
    if not row:
        raise HTTPException(404, "Fixture not found")
    return _fixture_from_row(row)


@router.get("/{fixture_id}/events", response_model=list[LiveEventOut])
async def list_events(fixture_id: str, request: Request) -> list[LiveEventOut]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id::text, fixture_id::text, minute, text, source, created_at "
            "FROM live_thread_events WHERE fixture_id = $1 ORDER BY minute DESC, created_at DESC",
            fixture_id,
        )
    return [
        LiveEventOut(
            id=r["id"], fixture_id=r["fixture_id"], minute=r["minute"],
            text=r["text"], source=r["source"],
            created_at=(r["created_at"] if r["created_at"].tzinfo
                        else r["created_at"].replace(tzinfo=UTC)).isoformat(),
        )
        for r in rows
    ]


@router.post("/{fixture_id}/events", response_model=LiveEventOut,
             status_code=status.HTTP_201_CREATED)
async def add_event(
    fixture_id: str,
    body: CreateLiveEvent,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> LiveEventOut:
    """Admins or house accounts post live events.

    With auth disabled (dev), the guest user can post too — useful for
    manual scripting / testing.
    """
    if request.app.state.auth_enforced and not (user.is_admin or user.is_house_account):
        raise HTTPException(403, "Only admins or house accounts can post live events")
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO live_thread_events (fixture_id, minute, text, source) "
            "VALUES ($1, $2, $3, $4) "
            "RETURNING id::text, fixture_id::text, minute, text, source, created_at",
            fixture_id, body.minute, body.text, body.source,
        )
    return LiveEventOut(
        id=row["id"], fixture_id=row["fixture_id"], minute=row["minute"],
        text=row["text"], source=row["source"],
        created_at=(row["created_at"] if row["created_at"].tzinfo
                    else row["created_at"].replace(tzinfo=UTC)).isoformat(),
    )


@router.get("/{fixture_id}/stream")
async def stream_events(fixture_id: str, request: Request) -> StreamingResponse:
    """Server-Sent Events stream of new events for this fixture.

    Polls the DB every 3s for events newer than the cursor. Sends an event
    payload on each find. Heartbeats every 15s to keep the connection alive
    through proxies.
    """
    pool = request.app.state.pool

    async def gen() -> AsyncIterator[bytes]:
        # Send a comment first to flush response headers through any
        # buffering proxy (Traefik/nginx) before any data work happens.
        yield b": connected\n\n"
        # Initial backfill: ALL events for this fixture so the client sees
        # the full match story on first connect, not just the last few minutes.
        async with pool.acquire() as conn:
            init = await conn.fetch(
                "SELECT id::text, fixture_id::text, minute, text, source, created_at "
                "FROM live_thread_events WHERE fixture_id = $1 "
                "ORDER BY created_at ASC",
                fixture_id,
            )
        last_cursor = init[-1]["created_at"] if init else datetime.now(UTC) - timedelta(minutes=5)
        for r in init:
            payload = {
                "id": r["id"], "fixture_id": r["fixture_id"],
                "minute": r["minute"], "text": r["text"], "source": r["source"],
                "created_at": (r["created_at"].astimezone(UTC) if r["created_at"].tzinfo
                               else r["created_at"].replace(tzinfo=UTC)).isoformat(),
            }
            yield f"event: live_event\ndata: {json.dumps(payload)}\n\n".encode()
            last_cursor = r["created_at"]

        heartbeat = 0
        while True:
            await asyncio.sleep(3)
            if await request.is_disconnected():
                return
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT id::text, fixture_id::text, minute, text, source, created_at "
                    "FROM live_thread_events "
                    "WHERE fixture_id = $1 AND created_at > $2 "
                    "ORDER BY created_at ASC",
                    fixture_id, last_cursor,
                )
            for r in rows:
                payload = {
                    "id": r["id"], "fixture_id": r["fixture_id"],
                    "minute": r["minute"], "text": r["text"], "source": r["source"],
                    "created_at": (r["created_at"].astimezone(UTC) if r["created_at"].tzinfo
                                   else r["created_at"].replace(tzinfo=UTC)).isoformat(),
                }
                yield f"event: live_event\ndata: {json.dumps(payload)}\n\n".encode()
                last_cursor = r["created_at"]
            heartbeat += 1
            if heartbeat % 5 == 0:  # ~ every 15s
                yield b": heartbeat\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # nginx: don't buffer SSE
            "Connection": "keep-alive",
        },
    )
