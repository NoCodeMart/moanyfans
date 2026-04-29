import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
import structlog
from fastapi import FastAPI

from .config import get_settings
from .services import fixture_sync, scheduler

log = structlog.get_logger(__name__)


async def init_pool() -> asyncpg.Pool:
    settings = get_settings()
    return await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=2,
        max_size=20,
        command_timeout=30,
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    app.state.pool = await init_pool()
    app.state.auth_enforced = settings.auth_enabled

    background_tasks = [
        asyncio.create_task(scheduler.run(app.state.pool), name="scheduler"),
        asyncio.create_task(fixture_sync.loop_upcoming(app.state.pool), name="fixture_sync_upcoming"),
        asyncio.create_task(fixture_sync.loop_live(app.state.pool), name="fixture_sync_live"),
    ]
    try:
        yield
    finally:
        for t in background_tasks:
            t.cancel()
        for t in background_tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        await app.state.pool.close()
