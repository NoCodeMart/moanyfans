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

log = structlog.get_logger(__name__)

INTERVAL_SECONDS = 30


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
        except Exception:  # noqa: BLE001
            log.exception("scheduler_error")
        await asyncio.sleep(INTERVAL_SECONDS)
