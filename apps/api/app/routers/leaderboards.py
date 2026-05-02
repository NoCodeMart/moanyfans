"""Public leaderboards.

Two shapes:

  * **Top moans** — single highest-scoring moans, sorted by chosen reaction
    metric, optionally scoped to a time window.
  * **Top users** — top accounts by various received-reaction metrics or by
    output volume. Scoped same way.

All public — no auth required to read. Excludes house accounts so the
leaderboards aren't dominated by AI personas.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/leaderboards", tags=["leaderboards"])

Period = Literal["week", "month", "all"]
MoanMetric = Literal["overall", "laughs", "agrees", "ratio", "cope"]
UserMetric = Literal[
    "laughs_received", "agrees_received", "ratio_received", "cope_received",
    "total_reactions", "moan_count",
]

_PERIOD_INTERVAL = {
    "week": "interval '7 days'",
    "month": "interval '30 days'",
    "all": None,
}


class TopMoan(BaseModel):
    id: str
    text: str
    user_handle: str
    user_avatar_seed: str | None = None
    user_avatar_style: str | None = None
    team_short: str | None = None
    team_primary: str | None = None
    laughs: int
    agrees: int
    ratio: int
    cope: int
    total: int
    created_at: str


class TopUser(BaseModel):
    handle: str
    avatar_seed: str | None = None
    avatar_style: str | None = None
    team_short: str | None = None
    team_primary: str | None = None
    is_verified: bool = False
    score: int


class Prophet(BaseModel):
    handle: str
    avatar_seed: str | None = None
    avatar_style: str | None = None
    team_short: str | None = None
    team_primary: str | None = None
    correct: int
    busts_called: int    # of correct, how many were BUSTED (sceptic score)
    here_we_gos: int     # of correct, how many were CONFIRMED (believer score)
    total: int
    accuracy: int        # 0–100, integer percentage


def _period_clause(period: Period, alias: str = "m") -> str:
    iv = _PERIOD_INTERVAL[period]
    if iv is None:
        return ""
    return f" AND {alias}.created_at > now() - {iv}"


@router.get("/top-moans", response_model=list[TopMoan])
async def top_moans(request: Request,
                    period: Period = "week",
                    metric: MoanMetric = "overall",
                    limit: int = 10) -> list[TopMoan]:
    if limit < 1 or limit > 50:
        raise HTTPException(400, "limit must be between 1 and 50")
    sort_col = {
        "overall": "(m.laughs + m.agrees + m.ratio + m.cope)",
        "laughs": "m.laughs",
        "agrees": "m.agrees",
        "ratio": "m.ratio",
        "cope": "m.cope",
    }[metric]
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT m.id::text, m.text, m.created_at,
                   m.laughs, m.agrees, m.ratio, m.cope,
                   (m.laughs + m.agrees + m.ratio + m.cope)::int AS total,
                   u.handle AS user_handle,
                   u.avatar_seed, u.avatar_style,
                   t.short_name AS team_short,
                   t.primary_color AS team_primary
              FROM moans m
              JOIN users u ON u.id = m.user_id
              LEFT JOIN teams t ON t.id = m.team_id
             WHERE m.deleted_at IS NULL
               AND m.status = 'PUBLISHED'
               AND m.parent_moan_id IS NULL
               AND u.is_house_account = false
               AND u.deleted_at IS NULL
               {_period_clause(period)}
               AND {sort_col} > 0
             ORDER BY {sort_col} DESC, m.created_at DESC
             LIMIT $1
            """,
            limit,
        )
    return [
        TopMoan(
            id=r["id"], text=r["text"],
            user_handle=r["user_handle"],
            user_avatar_seed=r["avatar_seed"],
            user_avatar_style=r["avatar_style"],
            team_short=r["team_short"],
            team_primary=r["team_primary"],
            laughs=r["laughs"], agrees=r["agrees"],
            ratio=r["ratio"], cope=r["cope"], total=r["total"],
            created_at=r["created_at"].isoformat(),
        ) for r in rows
    ]


@router.get("/top-users", response_model=list[TopUser])
async def top_users(request: Request,
                    period: Period = "week",
                    metric: UserMetric = "laughs_received",
                    limit: int = 10) -> list[TopUser]:
    if limit < 1 or limit > 50:
        raise HTTPException(400, "limit must be between 1 and 50")

    period_filter = _period_clause(period)
    pool = request.app.state.pool

    if metric == "moan_count":
        sql = f"""
            SELECT u.handle, u.avatar_seed, u.avatar_style,
                   t.short_name AS team_short, t.primary_color AS team_primary,
                   count(m.*)::int AS score
              FROM users u
              LEFT JOIN moans m ON m.user_id = u.id
                                AND m.deleted_at IS NULL
                                AND m.status = 'PUBLISHED'
                                {period_filter}
              LEFT JOIN teams t ON t.id = u.team_id
             WHERE u.is_house_account = false
               AND u.deleted_at IS NULL
             GROUP BY u.id, t.id
            HAVING count(m.*) > 0
             ORDER BY count(m.*) DESC
             LIMIT $1
        """
    else:
        col_map = {
            "laughs_received": "m.laughs",
            "agrees_received": "m.agrees",
            "ratio_received": "m.ratio",
            "cope_received": "m.cope",
            "total_reactions": "(m.laughs + m.agrees + m.ratio + m.cope)",
        }
        col = col_map[metric]
        sql = f"""
            SELECT u.handle, u.avatar_seed, u.avatar_style,
                   t.short_name AS team_short, t.primary_color AS team_primary,
                   COALESCE(sum({col}), 0)::int AS score
              FROM users u
              LEFT JOIN moans m ON m.user_id = u.id
                                AND m.deleted_at IS NULL
                                AND m.status = 'PUBLISHED'
                                {period_filter}
              LEFT JOIN teams t ON t.id = u.team_id
             WHERE u.is_house_account = false
               AND u.deleted_at IS NULL
             GROUP BY u.id, t.id
            HAVING COALESCE(sum({col}), 0) > 0
             ORDER BY COALESCE(sum({col}), 0) DESC
             LIMIT $1
        """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, limit)
    return [
        TopUser(
            handle=r["handle"],
            avatar_seed=r["avatar_seed"],
            avatar_style=r["avatar_style"],
            team_short=r["team_short"],
            team_primary=r["team_primary"],
            is_verified=False,  # column doesn't exist yet — Pro/verified work
            score=r["score"],
        ) for r in rows
    ]


@router.get("/prophets", response_model=list[Prophet])
async def prophets(request: Request,
                   period: Period = "all",
                   limit: int = 20) -> list[Prophet]:
    """Users who called the most rumours right.

    A vote counts as 'right' if:
      HERE_WE_GO + admin marked CONFIRMED, or
      BOLLOCKS   + admin marked BUSTED.
    GET_A_GRIP is meme-only, never scored.
    Vote must be cast BEFORE the rumour was resolved (no
    post-hoc cheating). Min 3 calls to qualify (avoids one-shot
    100%-ers dominating).
    """
    if limit < 1 or limit > 50:
        raise HTTPException(400, "limit must be between 1 and 50")
    period_filter = _period_clause(period)
    pool = request.app.state.pool
    sql = f"""
        WITH calls AS (
          SELECT rv.user_id,
                 rv.vote,
                 m.rumour_status,
                 m.rumour_resolved_at
            FROM rumour_votes rv
            JOIN moans m ON m.id = rv.moan_id
           WHERE m.kind = 'RUMOUR'
             AND m.deleted_at IS NULL
             AND m.rumour_status IN ('CONFIRMED', 'BUSTED')
             AND m.rumour_resolved_at IS NOT NULL
             AND rv.created_at <= m.rumour_resolved_at
             AND rv.vote IN ('HERE_WE_GO', 'BOLLOCKS')
             {period_filter.replace('m.created_at', 'm.rumour_resolved_at') if period_filter else ''}
        )
        SELECT u.handle, u.avatar_seed, u.avatar_style,
               t.short_name AS team_short, t.primary_color AS team_primary,
               COUNT(*) FILTER (
                 WHERE (c.vote = 'HERE_WE_GO' AND c.rumour_status = 'CONFIRMED')
                    OR (c.vote = 'BOLLOCKS'   AND c.rumour_status = 'BUSTED')
               )::int AS correct,
               COUNT(*) FILTER (
                 WHERE c.vote = 'BOLLOCKS' AND c.rumour_status = 'BUSTED'
               )::int AS busts_called,
               COUNT(*) FILTER (
                 WHERE c.vote = 'HERE_WE_GO' AND c.rumour_status = 'CONFIRMED'
               )::int AS here_we_gos,
               COUNT(*)::int AS total
          FROM calls c
          JOIN users u ON u.id = c.user_id
          LEFT JOIN teams t ON t.id = u.team_id
         WHERE u.is_house_account = false
           AND u.deleted_at IS NULL
         GROUP BY u.id, t.id
        HAVING COUNT(*) >= 3
         ORDER BY correct DESC, total ASC, u.handle ASC
         LIMIT $1
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, limit)
    out: list[Prophet] = []
    for r in rows:
        total = r["total"]
        accuracy = round((r["correct"] * 100) / total) if total else 0
        out.append(Prophet(
            handle=r["handle"],
            avatar_seed=r["avatar_seed"],
            avatar_style=r["avatar_style"],
            team_short=r["team_short"],
            team_primary=r["team_primary"],
            correct=r["correct"],
            busts_called=r["busts_called"],
            here_we_gos=r["here_we_gos"],
            total=total,
            accuracy=accuracy,
        ))
    return out
