"""Cross-entity search: moans (trigram) + users (handle prefix) + teams.

Single endpoint returns up to 10 of each, ordered for relevance.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from ..auth import CurrentUser, get_current_user
from ..services.ratelimit import limit_ip

router = APIRouter(prefix="/search", tags=["search"])


class SearchHit(BaseModel):
    type: str  # 'moan' | 'user' | 'team'
    id: str
    title: str
    subtitle: str | None = None
    accent: str | None = None
    payload: dict[str, Any] = {}


@router.get("", response_model=list[SearchHit])
async def search(
    request: Request,
    q: str = Query(min_length=2, max_length=80),
    limit_per_type: int = Query(default=8, ge=1, le=20),
    user: Annotated[CurrentUser, Depends(get_current_user)] = None,  # type: ignore[assignment]
) -> list[SearchHit]:
    # Anti-abuse: 60 searches / minute per IP
    limit_ip(request, action="search", limit=60, window_s=60)
    pool = request.app.state.pool
    needle = q.strip()
    like = f"%{needle.lower()}%"
    upper_handle_prefix = f"{needle.upper()}%"

    async with pool.acquire() as conn:
        teams = await conn.fetch(
            """
            SELECT slug, name, short_name, league, primary_color
              FROM teams
             WHERE lower(name) LIKE $1
                OR lower(short_name) LIKE $1
                OR lower(city) LIKE $1
                OR slug LIKE $1
             ORDER BY (lower(name) = $2) DESC, name
             LIMIT $3
            """,
            like, needle.lower(), limit_per_type,
        )
        users = await conn.fetch(
            """
            SELECT u.handle, u.bio, u.avatar_seed, u.avatar_style,
                   t.primary_color AS team_primary
              FROM users u LEFT JOIN teams t ON t.id = u.team_id
             WHERE u.deleted_at IS NULL
               AND (u.handle LIKE $1 OR similarity(u.handle, $2) > 0.3)
             ORDER BY (u.handle = $2) DESC, similarity(u.handle, $2) DESC
             LIMIT $3
            """,
            upper_handle_prefix, needle.upper(), limit_per_type,
        )
        moans = await conn.fetch(
            """
            SELECT m.id::text, m.text, m.kind::text, u.handle,
                   t.short_name AS team_short, t.primary_color AS team_primary
              FROM moans m
              JOIN users u ON u.id = m.user_id
              LEFT JOIN teams t ON t.id = m.team_id
             WHERE m.deleted_at IS NULL AND m.status = 'PUBLISHED'
               AND m.text % $1
             ORDER BY similarity(m.text, $1) DESC, m.created_at DESC
             LIMIT $2
            """,
            needle, limit_per_type,
        )

    hits: list[SearchHit] = []
    for r in teams:
        hits.append(SearchHit(
            type="team", id=r["slug"], title=r["name"],
            subtitle=r["league"], accent=r["primary_color"],
            payload={"short_name": r["short_name"]},
        ))
    for r in users:
        hits.append(SearchHit(
            type="user", id=r["handle"], title=f"@{r['handle']}",
            subtitle=(r["bio"] or "").strip()[:120] or None,
            accent=r["team_primary"],
            payload={"avatar_seed": r["avatar_seed"], "avatar_style": r["avatar_style"]},
        ))
    for r in moans:
        hits.append(SearchHit(
            type="moan", id=r["id"], title=r["text"][:140],
            subtitle=f"@{r['handle']}" + (f" · {r['team_short']}" if r["team_short"] else ""),
            accent=r["team_primary"],
            payload={"kind": r["kind"]},
        ))
    return hits
