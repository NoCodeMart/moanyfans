"""Lightweight in-process scheduler.

Runs alongside FastAPI as a background task. Handles:
  - Auto-close roast battles past `expires_at` (declares winner)
  - Advance fixtures: SCHEDULED → LIVE → FT based on kickoff time
  - Heartbeat ping for liveness logging

This is fine for v1 single-instance deploys. Once we scale to multiple
API replicas, we'll move this into a dedicated worker so duplicates
don't fire — for now Coolify runs one container and it's all sequential.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import asyncpg
import structlog

from . import house_ai, push

log = structlog.get_logger(__name__)

INTERVAL_SECONDS = 30
HOUSE_AI_EVERY_TICKS = 10  # ~5 minutes between house AI sweeps
RAGE_RANKER_DAY = 6  # Sunday (Mon=0)
RAGE_RANKER_HOUR = 19  # 19:00 UTC


async def _close_expired_battles(conn: asyncpg.Connection) -> int:
    rows = await conn.fetch(
        """
        UPDATE battles
           SET status = 'CLOSED',
               winner_id = CASE
                 WHEN challenger_votes > opponent_votes THEN challenger_id
                 WHEN opponent_votes   > challenger_votes THEN opponent_id
                 ELSE NULL
               END
         WHERE status = 'ACTIVE' AND expires_at <= now()
         RETURNING id
        """,
    )
    return len(rows)


async def _advance_fixtures(conn: asyncpg.Connection) -> tuple[int, int]:
    started = await conn.fetch(
        "UPDATE fixtures SET status = 'LIVE' "
        "WHERE status = 'SCHEDULED' AND kickoff_at <= now() RETURNING id",
    )
    finished = await conn.fetch(
        "UPDATE fixtures SET status = 'FT' "
        "WHERE status = 'LIVE' AND kickoff_at <= now() - interval '120 minutes' RETURNING id",
    )
    return len(started), len(finished)


async def run(pool: asyncpg.Pool) -> None:
    log.info("scheduler_starting")
    tick = 0
    last_rage_ranker_day: tuple[int, int] | None = None  # (iso_year, iso_week)
    while True:
        try:
            async with pool.acquire() as conn:
                closed = await _close_expired_battles(conn)
                started, finished = await _advance_fixtures(conn)
            if closed or started or finished:
                log.info(
                    "scheduler_tick",
                    battles_closed=closed,
                    fixtures_started=started,
                    fixtures_finished=finished,
                )

            # Web push dispatch — flush any unpushed notifications.
            try:
                await push.dispatch_pending(pool)
            except Exception:
                log.exception("push_dispatch_failed")

            # House AI sweep — every ~5 minutes catch any FT fixtures whose
            # hot take didn't fire during live polling (e.g. polling missed FT).
            if tick % HOUSE_AI_EVERY_TICKS == 0:
                try:
                    posted = await house_ai.hot_takes_for_recent_ft(pool)
                    if posted:
                        log.info("hot_takes_swept", posted=posted)
                except Exception:
                    log.exception("hot_takes_sweep_failed")

            # Weekly RAGE_RANKER — Sunday evening, once per ISO week.
            now = datetime.now(UTC)
            iso_year, iso_week, weekday = now.isocalendar()
            wk = (iso_year, iso_week)
            if (
                weekday - 1 == RAGE_RANKER_DAY
                and now.hour >= RAGE_RANKER_HOUR
                and last_rage_ranker_day != wk
            ):
                try:
                    if await house_ai.rage_ranker_weekly(pool):
                        last_rage_ranker_day = wk
                except Exception:
                    log.exception("rage_ranker_failed")
        except Exception:  # noqa: BLE001
            log.exception("scheduler_error")
        tick += 1
        await asyncio.sleep(INTERVAL_SECONDS)
