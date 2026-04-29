import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
import structlog
from fastapi import FastAPI

from .config import get_settings
from .services import scheduler

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
    sched_task = asyncio.create_task(scheduler.run(app.state.pool))
    try:
        yield
    finally:
        sched_task.cancel()
        try:
            await sched_task
        except (asyncio.CancelledError, Exception):
            pass
        await app.state.pool.close()
