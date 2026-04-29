"""Fixture sync — pulls real fixtures from TheSportsDB into our DB.

Two cadences:
  - sync_upcoming(): hourly. Pull all known upcoming + recently finished
    fixtures for our 5 leagues, upsert into the fixtures table.
  - sync_live(): every 30s during match windows. For each fixture currently
    LIVE (or expected to be), poll TheSportsDB for the latest score; if the
    score has advanced, post an auto-event into live_thread_events for that
    fixture.

Team matching is name-based: TheSportsDB returns the canonical full club name
(e.g. "Manchester United"), which already matches our `teams.name`. On first
match we save TheSportsDB's idTeam to `teams.external_id` so subsequent runs
go via the FK.

The actual minute-by-minute commentary comes from real fans posting moans in
the live thread — this service only seeds anchor events (kickoff, goals, FT)
so the thread isn't empty before the crowd arrives.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import asyncpg
import httpx
import structlog

from . import sportsdb
from .sportsdb import Event

log = structlog.get_logger(__name__)


# ── Team resolver ───────────────────────────────────────────────────────────

async def _resolve_team_id(
    conn: asyncpg.Connection, name: str, external_id: str | None,
) -> str | None:
    """Find our team id for a given TheSportsDB team name.

    Strategy:
      1. Match on existing external_id if we've seen this team before.
      2. Exact case-insensitive name match.
      3. Trimmed name match (handles "Spurs" vs "Tottenham Hotspur" — though
         TheSportsDB uses canonical names so this is rare).
    Saves the external_id back on first match so subsequent calls are O(1).
    """
    if external_id:
        row = await conn.fetchrow(
            "SELECT id::text FROM teams WHERE external_id = $1", external_id,
        )
        if row:
            return row["id"]
    # Fall back to name match
    row = await conn.fetchrow(
        "SELECT id::text FROM teams WHERE lower(name) = lower($1) LIMIT 1", name,
    )
    if row and external_id:
        await conn.execute(
            "UPDATE teams SET external_id = $1 WHERE id = $2",
            external_id, row["id"],
        )
    return row["id"] if row else None


# ── Upcoming sync (hourly) ──────────────────────────────────────────────────

async def sync_upcoming(pool: asyncpg.Pool, client: httpx.AsyncClient) -> dict[str, int]:
    """Pull next/past fixtures from TheSportsDB and upsert into fixtures."""
    events = await sportsdb.fetch_upcoming(client)
    new_count = 0
    updated_count = 0
    skipped_count = 0
    async with pool.acquire() as conn:
        for e in events:
            home_id = await _resolve_team_id(conn, e.home_team_name, e.home_team_external_id)
            away_id = await _resolve_team_id(conn, e.away_team_name, e.away_team_external_id)
            if not home_id or not away_id:
                skipped_count += 1
                continue
            # Idempotent upsert keyed by external_id
            existing = await conn.fetchrow(
                "SELECT id::text, status, home_score, away_score "
                "FROM fixtures WHERE external_id = $1",
                e.external_id,
            )
            if not existing:
                await conn.execute(
                    """
                    INSERT INTO fixtures
                      (external_id, competition, home_team_id, away_team_id,
                       kickoff_at, status, home_score, away_score)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                    """,
                    e.external_id, e.competition, home_id, away_id,
                    e.kickoff_at, e.status, e.home_score, e.away_score,
                )
                new_count += 1
            else:
                # Only update mutable fields; never demote LIVE→SCHEDULED
                next_status = e.status
                if existing["status"] == "LIVE" and next_status == "SCHEDULED":
                    next_status = "LIVE"
                await conn.execute(
                    """
                    UPDATE fixtures
                       SET kickoff_at = $1, status = $2,
                           home_score = $3, away_score = $4,
                           competition = $5
                     WHERE external_id = $6
                    """,
                    e.kickoff_at, next_status, e.home_score, e.away_score,
                    e.competition, e.external_id,
                )
                updated_count += 1
    return {"new": new_count, "updated": updated_count, "skipped_no_team": skipped_count}


# ── Live polling (every 30s) ────────────────────────────────────────────────

async def sync_live(pool: asyncpg.Pool, client: httpx.AsyncClient) -> dict[str, int]:
    """Poll LIVE fixtures + any kicking off in the next 5 minutes.

    Detects score changes between polls and writes a goal event into
    live_thread_events. Also seeds a kickoff event the first time a fixture
    flips SCHEDULED→LIVE.
    """
    polled = 0
    events_posted = 0
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id::text, external_id,
                   home_team_id::text AS home_id,
                   away_team_id::text AS away_id,
                   home_score, away_score, status, kickoff_at,
                   (SELECT short_name FROM teams WHERE id = home_team_id) AS home_short,
                   (SELECT short_name FROM teams WHERE id = away_team_id) AS away_short
              FROM fixtures
             WHERE external_id IS NOT NULL
               AND (status = 'LIVE'
                    OR (status = 'SCHEDULED'
                        AND kickoff_at <= now() + interval '5 minutes'
                        AND kickoff_at >= now() - interval '180 minutes'))
            """,
        )
    for row in rows:
        polled += 1
        latest = await sportsdb.lookup_event(client, row["external_id"])
        if not latest:
            continue
        async with pool.acquire() as conn, conn.transaction():
            await _apply_live_update(conn, row, latest)
            # Count newly-posted events
            after = await conn.fetchval(
                "SELECT count(*) FROM live_thread_events "
                "WHERE fixture_id = $1 AND created_at > now() - interval '40 seconds'",
                row["id"],
            )
            events_posted += int(after or 0)
    return {"polled": polled, "events_posted": events_posted}


async def _apply_live_update(
    conn: asyncpg.Connection, fixture_row: asyncpg.Record, latest: Event,
) -> None:
    """Write any goal/kickoff/FT events implied by a state diff."""
    fid = fixture_row["id"]
    prev_status = fixture_row["status"]
    prev_home = fixture_row["home_score"] or 0
    prev_away = fixture_row["away_score"] or 0
    new_home = latest.home_score or 0
    new_away = latest.away_score or 0
    new_status = latest.status
    minute = _estimate_minute(latest.kickoff_at, new_status)

    # KICKOFF — first time we see LIVE
    if prev_status != "LIVE" and new_status == "LIVE":
        await _post_event(conn, fid, 0,
            f"KICK OFF — {fixture_row['home_short']} vs {fixture_row['away_short']}. "
            f"Game on. Moan loud, moan often.")
    # GOAL events
    home_goals = max(0, new_home - prev_home)
    away_goals = max(0, new_away - prev_away)
    for _ in range(home_goals):
        await _post_event(
            conn, fid, minute,
            f"GOAL — {fixture_row['home_short']} ({new_home}-{new_away}). "
            f"{fixture_row['home_short']} fans on their feet, "
            f"{fixture_row['away_short']} fans heading to the bar.",
        )
    for _ in range(away_goals):
        await _post_event(
            conn, fid, minute,
            f"GOAL — {fixture_row['away_short']} ({new_home}-{new_away}). "
            f"{fixture_row['away_short']} fans on their feet, "
            f"{fixture_row['home_short']} fans crying into their pies.",
        )
    # FULL TIME
    if prev_status == "LIVE" and new_status == "FT":
        verdict = "draw" if new_home == new_away else (
            f"{fixture_row['home_short']} edge it" if new_home > new_away
            else f"{fixture_row['away_short']} steal it"
        )
        await _post_event(
            conn, fid, 90,
            f"FULL TIME — {fixture_row['home_short']} {new_home}-{new_away} "
            f"{fixture_row['away_short']}. {verdict}. The post-mortem starts now.",
        )

    # Persist updated state on fixture
    await conn.execute(
        """
        UPDATE fixtures
           SET status = $1, home_score = $2, away_score = $3
         WHERE id = $4
        """,
        new_status, new_home, new_away, fid,
    )


async def _post_event(
    conn: asyncpg.Connection, fixture_id: str, minute: int, text: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO live_thread_events (fixture_id, minute, text, source)
        VALUES ($1, $2, $3, 'AUTO')
        """,
        fixture_id, minute, text,
    )


def _estimate_minute(kickoff: datetime, status: str) -> int:
    if status != "LIVE":
        return 0 if status == "SCHEDULED" else 90
    elapsed = (datetime.now(UTC) - kickoff).total_seconds() / 60
    return max(0, min(95, int(elapsed)))


# ── Loop runners ────────────────────────────────────────────────────────────

async def loop_upcoming(pool: asyncpg.Pool) -> None:
    """Hourly cadence — pull fixtures + scores from TheSportsDB."""
    async with httpx.AsyncClient(headers={"User-Agent": "Moanyfans/0.1"}) as client:
        # First run on startup, then hourly.
        while True:
            try:
                stats = await sync_upcoming(pool, client)
                if stats["new"] or stats["updated"]:
                    log.info("fixture_sync_upcoming", **stats)
            except Exception:
                log.exception("fixture_sync_upcoming_failed")
            await asyncio.sleep(3600)


async def loop_live(pool: asyncpg.Pool) -> None:
    """30-second cadence during match windows."""
    async with httpx.AsyncClient(headers={"User-Agent": "Moanyfans/0.1"}) as client:
        while True:
            try:
                stats = await sync_live(pool, client)
                if stats["polled"]:
                    log.info("fixture_sync_live", **stats)
            except Exception:
                log.exception("fixture_sync_live_failed")
            await asyncio.sleep(30)
