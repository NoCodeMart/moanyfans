from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI

from .config import get_settings


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
    app.state.pool = await init_pool()
    try:
        yield
    finally:
        await app.state.pool.close()


async def get_pool(app: FastAPI) -> asyncpg.Pool:
    return app.state.pool
