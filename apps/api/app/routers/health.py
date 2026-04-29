from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    db: str


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    pool = request.app.state.pool
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        db = "ok"
    except Exception:
        db = "down"
    return HealthResponse(status="ok" if db == "ok" else "degraded", db=db)
