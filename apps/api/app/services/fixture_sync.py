"""Fixture sync — pulls real fixtures from TheSportsDB into our DB.

Three cadences, designed to respect the free-tier rate limit:

  - initial_backfill(): one-time. Walks every (league × round) and pulls all
    fixtures of the season into the DB. Runs only if the fixtures table is
    empty for that league. Polite (1.5s sleep between calls).

  - incremental_refresh(): every 4 hours. Only re-fetches rounds that have
    SCHEDULED fixtures kicking off within the next 14 days. Most rounds
    settle into FT and never need re-pulling. ~30 calls per cycle, well
    under any free-tier limit.

  - sync_live(): every 30s during match windows. For each fixture currently
    LIVE (or expected to be), use lookupevent (single fixture call) to get
    the latest score; on score change, post an auto-event into
    live_thread_events.
"""

from __future__ import annotations

import asyncio

import asyncpg
import httpx
import structlog

from . import sportsdb
from .sportsdb import Event

log = structlog.get_logger(__name__)


# ── Team resolver (unchanged) ───────────────────────────────────────────────

async def _resolve_team_id(
    conn: asyncpg.Connection, name: str, external_id: str | None,
) -> str | None:
    if external_id:
        row = await conn.fetchrow(
            "SELECT id::text FROM teams WHERE external_id = $1", external_id,
        )
        if row:
            return row["id"]
    row = await conn.fetchrow(
        "SELECT id::text FROM teams WHERE lower(name) = lower($1) LIMIT 1", name,
    )
    if row and external_id:
        await conn.execute(
            "UPDATE teams SET external_id = $1 WHERE id = $2",
            external_id, row["id"],
        )
    return row["id"] if row else None


# ── Upsert one event ────────────────────────────────────────────────────────

async def _upsert_event(conn: asyncpg.Connection, e: Event) -> str:
    """Returns one of: 'new', 'updated', 'skipped'."""
    home_id = await _resolve_team_id(conn, e.home_team_name, e.home_team_external_id)
    away_id = await _resolve_team_id(conn, e.away_team_name, e.away_team_external_id)
    if not home_id or not away_id:
        return "skipped"
    existing = await conn.fetchrow(
        "SELECT status FROM fixtures WHERE external_id = $1", e.external_id,
    )
    if not existing:
        await conn.execute(
            """
            INSERT INTO fixtures
              (external_id, competition, home_team_id, away_team_id,
               kickoff_at, status, home_score, away_score, round)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            """,
            e.external_id, e.competition, home_id, away_id,
            e.kickoff_at, e.status, e.home_score, e.away_score, e.round,
        )
        return "new"
    next_status = e.status
    if existing["status"] == "LIVE" and next_status == "SCHEDULED":
        next_status = "LIVE"  # never demote
    await conn.execute(
        """
        UPDATE fixtures
           SET kickoff_at = $1, status = $2,
               home_score = $3, away_score = $4,
               competition = $5, round = COALESCE($6, round)
         WHERE external_id = $7
        """,
        e.kickoff_at, next_status, e.home_score, e.away_score,
        e.competition, e.round, e.external_id,
    )
    return "updated"


# ── Initial backfill (one-time per league) ──────────────────────────────────

async def initial_backfill(pool: asyncpg.Pool, client: httpx.AsyncClient) -> dict[str, int]:
    """Pull only UPCOMING fixtures (SCHEDULED + LIVE) per league.

    Walks rounds from latest → earliest. Stops as soon as it finds a round
    where every event is FT — assumes earlier rounds are also fully done.
    Result: typically ~3-6 API calls per league instead of all 38-46 rounds.

    Idempotent: re-running just refreshes the same upcoming rounds.
    """
    new_total = 0
    updated_total = 0
    skipped_total = 0
    rounds_pulled = 0

    for league in sportsdb.LEAGUES:
        log.info("upcoming_sync_league", league=league["name"])
        consecutive_done_rounds = 0
        # Walk rounds from latest to earliest
        for round_n in range(league["rounds"], 0, -1):
            events = await sportsdb._fetch_round(  # type: ignore[attr-defined]
                client, league["id"], round_n, sportsdb.DEFAULT_SEASON,
            )
            rounds_pulled += 1
            await asyncio.sleep(1.5)  # polite to free API

            if not events:
                # Empty round (e.g. season hasn't reached this round yet)
                continue

            # Only persist SCHEDULED or LIVE events; ignore FT entirely
            upcoming_events = [e for e in events if e.status in ("SCHEDULED", "LIVE")]
            if not upcoming_events:
                consecutive_done_rounds += 1
                # Two consecutive all-FT rounds in a row → assume the rest of
                # the season is past, stop walking. (Two not one, in case a
                # late-rescheduled match makes a round look empty.)
                if consecutive_done_rounds >= 2:
                    log.info(
                        "upcoming_sync_league_done",
                        league=league["name"], stopped_at_round=round_n,
                    )
                    break
                continue

            consecutive_done_rounds = 0
            async with pool.acquire() as conn:
                for e in upcoming_events:
                    result = await _upsert_event(conn, e)
                    if result == "new":
                        new_total += 1
                    elif result == "updated":
                        updated_total += 1
                    elif result == "skipped":
                        skipped_total += 1

    return {
        "new": new_total, "updated": updated_total,
        "skipped_no_team": skipped_total, "rounds_pulled": rounds_pulled,
    }


# ── Incremental refresh (every 4 hours) ─────────────────────────────────────

async def incremental_refresh(
    pool: asyncpg.Pool, client: httpx.AsyncClient,
) -> dict[str, int]:
    """Re-fetch only rounds that have SCHEDULED games coming up in the next
    14 days. Saves ~95% of API calls vs a full season pull."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT competition, round
              FROM fixtures
             WHERE status = 'SCHEDULED'
               AND round IS NOT NULL
               AND kickoff_at <= now() + interval '14 days'
             ORDER BY competition, round
            """,
        )
    new_total = 0
    updated_total = 0
    pulled_rounds = 0
    for row in rows:
        league = next(
            (lg for lg in sportsdb.LEAGUES
             if next(
                 (raw for raw, mapped in sportsdb.LEAGUE_MAP.items()
                  if mapped == lg["name"]), None,
             ) == row["competition"]),
            None,
        )
        if not league:
            continue
        events = await sportsdb._fetch_round(  # type: ignore[attr-defined]
            client, league["id"], row["round"], sportsdb.DEFAULT_SEASON,
        )
        pulled_rounds += 1
        async with pool.acquire() as conn:
            for e in events:
                result = await _upsert_event(conn, e)
                if result == "new":
                    new_total += 1
                elif result == "updated":
                    updated_total += 1
        await asyncio.sleep(0.5)
    return {"rounds_pulled": pulled_rounds, "new": new_total, "updated": updated_total}


# ── Live polling (every 30s) ────────────────────────────────────────────────

async def sync_live(pool: asyncpg.Pool, client: httpx.AsyncClient) -> dict[str, int]:
    polled = 0
    events_posted_total = 0
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
            new_events = await _apply_live_update(conn, row, latest)
            events_posted_total += new_events
    return {"polled": polled, "events_posted": events_posted_total}


async def _apply_live_update(
    conn: asyncpg.Connection, fixture_row: asyncpg.Record, latest: Event,
) -> int:
    """Returns count of new live_thread_events written."""
    from datetime import UTC, datetime
    fid = fixture_row["id"]
    prev_status = fixture_row["status"]
    prev_home = fixture_row["home_score"] or 0
    prev_away = fixture_row["away_score"] or 0
    new_home = latest.home_score or 0
    new_away = latest.away_score or 0
    new_status = latest.status
    elapsed = (datetime.now(UTC) - latest.kickoff_at).total_seconds() / 60
    minute = max(0, min(95, int(elapsed))) if new_status == "LIVE" else (0 if new_status == "SCHEDULED" else 90)
    posted = 0

    if prev_status != "LIVE" and new_status == "LIVE":
        await _post_event(conn, fid, 0,
            f"KICK OFF — {fixture_row['home_short']} vs {fixture_row['away_short']}. "
            f"Game on. Moan loud, moan often.")
        posted += 1
    from . import house_ai
    home_id = fixture_row["home_id"]
    away_id = fixture_row["away_id"]
    running_home, running_away = prev_home, prev_away
    for _ in range(max(0, new_home - prev_home)):
        running_home += 1
        await _post_event(conn, fid, minute,
            f"GOAL — {fixture_row['home_short']} ({running_home}-{running_away}). "
            f"{fixture_row['home_short']} fans on their feet, "
            f"{fixture_row['away_short']} fans heading to the bar.")
        posted += 1
        try:
            await house_ai.goal_take_for_fixture(
                conn, fid, str(home_id), str(away_id), minute,
                running_home, running_away, "HOME",
            )
        except Exception:
            log.exception("goal_take_failed", fixture_id=fid, minute=minute)
    for _ in range(max(0, new_away - prev_away)):
        running_away += 1
        await _post_event(conn, fid, minute,
            f"GOAL — {fixture_row['away_short']} ({running_home}-{running_away}). "
            f"{fixture_row['away_short']} fans on their feet, "
            f"{fixture_row['home_short']} fans crying into their pies.")
        posted += 1
        try:
            await house_ai.goal_take_for_fixture(
                conn, fid, str(away_id), str(home_id), minute,
                running_home, running_away, "AWAY",
            )
        except Exception:
            log.exception("goal_take_failed", fixture_id=fid, minute=minute)
    became_ft = prev_status == "LIVE" and new_status == "FT"
    if became_ft:
        verdict = "draw" if new_home == new_away else (
            f"{fixture_row['home_short']} edge it" if new_home > new_away
            else f"{fixture_row['away_short']} steal it"
        )
        await _post_event(conn, fid, 90,
            f"FULL TIME — {fixture_row['home_short']} {new_home}-{new_away} "
            f"{fixture_row['away_short']}. {verdict}. The post-mortem starts now.")
        posted += 1

    await conn.execute(
        "UPDATE fixtures SET status = $1, home_score = $2, away_score = $3 WHERE id = $4",
        new_status, new_home, new_away, fid,
    )

    if became_ft:
        # Generate recap + hot take. Best-effort, don't fail the live tick.
        from . import house_ai, recap_gen
        try:
            await recap_gen.generate_recap_for_fixture(conn, fid)
        except Exception:
            log.exception("recap_hook_failed", fixture_id=fid)
        try:
            await house_ai.hot_take_for_fixture(conn, fid)
        except Exception:
            log.exception("hot_take_hook_failed", fixture_id=fid)
    return posted


async def _post_event(
    conn: asyncpg.Connection, fixture_id: str, minute: int, text: str,
) -> None:
    await conn.execute(
        "INSERT INTO live_thread_events (fixture_id, minute, text, source) "
        "VALUES ($1, $2, $3, 'AUTO')",
        fixture_id, minute, text,
    )


# ── Loop runners ────────────────────────────────────────────────────────────

async def loop_upcoming(pool: asyncpg.Pool) -> None:
    """One-time initial backfill, then incremental refresh every 4 hours."""
    async with httpx.AsyncClient(headers={"User-Agent": "Moanyfans/0.1"}) as client:
        # Wait briefly so all background tasks settle and we don't compete
        # with live polling on first start
        await asyncio.sleep(15)
        try:
            stats = await initial_backfill(pool, client)
            log.info("backfill_complete", **stats)
        except Exception:
            log.exception("backfill_failed")
        while True:
            await asyncio.sleep(4 * 3600)
            try:
                stats = await incremental_refresh(pool, client)
                if stats.get("rounds_pulled"):
                    log.info("incremental_refresh", **stats)
            except Exception:
                log.exception("incremental_refresh_failed")


async def loop_live(pool: asyncpg.Pool) -> None:
    async with httpx.AsyncClient(headers={"User-Agent": "Moanyfans/0.1"}) as client:
        while True:
            try:
                stats = await sync_live(pool, client)
                if stats["polled"]:
                    log.info("fixture_sync_live", **stats)
            except Exception:
                log.exception("fixture_sync_live_failed")
            await asyncio.sleep(30)
