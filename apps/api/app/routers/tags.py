from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

router = APIRouter(prefix="/tags", tags=["tags"])


class TrendingTag(BaseModel):
    tag: str
    moans: int
    sport: str | None = None


@router.get("/trending", response_model=list[TrendingTag])
async def trending_tags(
    request: Request,
    window: Literal["24h", "7d", "30d", "all"] = Query(default="24h"),
    limit: int = Query(default=20, ge=1, le=50),
) -> list[TrendingTag]:
    pool = request.app.state.pool
    now = datetime.now(UTC)
    since = {
        "24h": now - timedelta(hours=24),
        "7d": now - timedelta(days=7),
        "30d": now - timedelta(days=30),
        "all": datetime(1970, 1, 1, tzinfo=UTC),
    }[window]
    sql = """
        SELECT t.slug, count(*) AS moans,
               (SELECT mode() WITHIN GROUP (ORDER BY tm.sport)
                  FROM (SELECT te.sport FROM moans m
                          JOIN moan_tags mt2 ON mt2.moan_id = m.id
                          JOIN teams te ON te.id = m.team_id
                         WHERE mt2.tag_id = t.id) tm) AS sport
          FROM tags t
          JOIN moan_tags mt ON mt.tag_id = t.id
          JOIN moans m ON m.id = mt.moan_id
         WHERE m.created_at >= $1
           AND m.deleted_at IS NULL
           AND m.status = 'PUBLISHED'
      GROUP BY t.id, t.slug
      ORDER BY moans DESC, t.slug ASC
         LIMIT $2
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, since, limit)
    return [
        TrendingTag(tag=f"#{r['slug']}", moans=r["moans"], sport=r["sport"])
        for r in rows
    ]
