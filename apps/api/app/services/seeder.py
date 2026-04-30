"""Cold-start content seeder.

Keeps the feed warm by drip-feeding house-account moans tied to recent
fixtures. Each persona has its own voice prompt; the scheduler calls
``maybe_seed`` every tick and probabilistically posts so the cadence
feels organic rather than spammy.

Volume budget: roughly one new seed moan every 6–10 minutes during the
day, less overnight. We cap "fresh" output to avoid an empty platform
ever feeling like an empty stadium.

All seed moans are produced by users with ``is_house_account = true``
so the frontend renders the HOUSE badge — never undisclosed AI.
"""
from __future__ import annotations

import json
import random
import re
from datetime import UTC, datetime
from typing import Any

import asyncpg
import httpx
import structlog

from ..config import get_settings

log = structlog.get_logger(__name__)

_MODEL = "claude-haiku-4-5-20251001"

# Each persona is one entry. The system prompt sets the voice; the schedule
# weight controls how often they're picked relative to others.
_PERSONAS: list[dict[str, Any]] = [
    {
        "handle": "TERRACE_TOM",
        "weight": 3,
        "system": (
            "You are TERRACE_TOM, a 60-year-old grumpy season-ticket holder "
            "who's seen it all and complains about everything: ticket prices, "
            "modern football, VAR, players on phones. Voice: weary, dry, "
            "British, mildly bitter. Single short sentence. No emoji. "
            "British English."
        ),
    },
    {
        "handle": "THE_GAFFER",
        "weight": 3,
        "system": (
            "You are THE_GAFFER, an armchair manager who thinks they could "
            "fix any club's problems with a 3-5-2 and a kick up the backside. "
            "Voice: confident, tactical jargon, slightly delusional. One "
            "short sentence. British English. No emoji."
        ),
    },
    {
        "handle": "PUNDIT_PETE",
        "weight": 3,
        "system": (
            "You are PUNDIT_PETE, a parody of a Sky Sports pundit who speaks "
            "in clichés and contradictions ('it's a results business but it's "
            "also a process'). Voice: smug, soundbite-heavy. One sentence. "
            "British English. No emoji."
        ),
    },
    {
        "handle": "HOT_TAKE_HARRY",
        "weight": 2,
        "system": (
            "You are HOT_TAKE_HARRY, a cocky pub mate who fires off divisive "
            "takes about clubs. Voice: short, opinionated, British. One "
            "sentence. One hashtag max at the end. No emoji."
        ),
    },
    {
        "handle": "RAGE_RANKER",
        "weight": 1,
        "system": (
            "You are RAGE_RANKER, who reduces every club's problems to a "
            "single brutal stat or league-position quip. Voice: dry data "
            "energy. One sentence. British English."
        ),
    },
]


def _pick_persona() -> dict[str, Any]:
    weights = [p["weight"] for p in _PERSONAS]
    return random.choices(_PERSONAS, weights=weights, k=1)[0]


async def _claude_json(system: str, user: str) -> dict[str, Any] | None:
    settings = get_settings()
    if not settings.anthropic_api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": settings.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": _MODEL,
                    "max_tokens": 250,
                    "system": system + (
                        '\n\nReturn JSON ONLY: '
                        '{"text": "<≤200 chars including hashtag>", '
                        '"kind": "ROAST|MOAN|BANTER"}'
                    ),
                    "messages": [{"role": "user", "content": user}],
                },
            )
            r.raise_for_status()
            data = r.json()
        content = data["content"][0]["text"] if data.get("content") else "{}"
        match = re.search(r"\{.*?\}", content, re.DOTALL)
        if not match:
            return None
        return json.loads(match.group(0))
    except Exception:
        log.exception("seeder_claude_call_failed")
        return None


async def _pick_target_team(conn: asyncpg.Connection) -> dict[str, Any] | None:
    """Prefer teams in fixtures within the last 36h or the next 36h.
    Falls back to any Premier League / Championship / Scottish Prem team."""
    hot = await conn.fetchrow(
        """
        SELECT t.id::text AS id, t.name, t.short_name, t.league, f.competition,
               f.home_score, f.away_score, f.status::text AS status,
               ot.name AS opponent
          FROM fixtures f
          JOIN teams t  ON t.id IN (f.home_team_id, f.away_team_id)
          JOIN teams ot ON ot.id IN (f.home_team_id, f.away_team_id)
                        AND ot.id != t.id
         WHERE f.kickoff_at BETWEEN now() - interval '36 hours'
                                AND now() + interval '36 hours'
         ORDER BY random()
         LIMIT 1
        """,
    )
    if hot:
        return dict(hot)
    cold = await conn.fetchrow(
        """
        SELECT t.id::text AS id, t.name, t.short_name, t.league,
               t.league AS competition,
               NULL::int AS home_score, NULL::int AS away_score,
               'IDLE' AS status, NULL::text AS opponent
          FROM teams t
         WHERE t.league IN ('Premier League', 'Championship', 'Scottish Premiership')
         ORDER BY random()
         LIMIT 1
        """,
    )
    return dict(cold) if cold else None


def _prompt_for(persona: dict[str, Any], team: dict[str, Any]) -> str:
    name = team["name"]
    status = team.get("status", "IDLE")
    opponent = team.get("opponent")
    hs, as_ = team.get("home_score"), team.get("away_score")
    if status == "FT" and hs is not None and as_ is not None and opponent:
        return (
            f"Write a {persona['handle']}-flavoured moan about {name} after "
            f"the result vs {opponent} ({hs}-{as_})."
        )
    if status == "LIVE" and opponent:
        return (
            f"Write a {persona['handle']}-flavoured moan about {name}'s match "
            f"in progress vs {opponent}."
        )
    if status == "SCHEDULED" and opponent:
        return (
            f"Write a {persona['handle']}-flavoured moan about {name}'s "
            f"upcoming match against {opponent}."
        )
    return f"Write a {persona['handle']}-flavoured moan about {name}."


async def maybe_seed(pool: asyncpg.Pool) -> bool:
    """Probabilistic single-moan seeder. Call every scheduler tick.

    Backs off when there's already plenty of fresh house content so we don't
    drown out real users once they arrive.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        return False

    # Hour-of-day cadence: less overnight, more during footy hours.
    hour = datetime.now(UTC).hour
    weight = 1.0 if 7 <= hour <= 23 else 0.25
    if random.random() > 0.18 * weight:
        return False

    async with pool.acquire() as conn:
        # Don't pile on if the last 30 minutes already have ≥3 house moans —
        # keeps cadence organic.
        recent = await conn.fetchval(
            """
            SELECT count(*) FROM moans m
              JOIN users u ON u.id = m.user_id
             WHERE u.is_house_account = true
               AND m.deleted_at IS NULL
               AND m.created_at > now() - interval '30 minutes'
            """,
        )
        if recent and recent >= 3:
            return False

        persona = _pick_persona()
        team = await _pick_target_team(conn)
        if not team:
            return False

        prompt = _prompt_for(persona, team)
        data = await _claude_json(persona["system"], prompt)
        if not data:
            return False
        text = str(data.get("text", "")).strip()[:480]
        kind = str(data.get("kind", "BANTER")).upper()
        if kind not in {"ROAST", "MOAN", "BANTER"}:
            kind = "BANTER"
        if not text:
            return False

        user = await conn.fetchrow(
            "SELECT id FROM users WHERE handle = $1 AND is_house_account = true",
            persona["handle"],
        )
        if not user:
            return False

        moan_id = await conn.fetchval(
            """
            INSERT INTO moans (user_id, team_id, kind, status, text, rage_level)
            VALUES ($1, $2, $3, 'PUBLISHED', $4, 5)
            RETURNING id::text
            """,
            user["id"], team["id"], kind, text,
        )
        # Tag pass — same regex the user-create path uses.
        slugs = {m.upper() for m in re.findall(r"#([A-Za-z0-9_]{2,32})", text)}
        for slug in slugs:
            tag = await conn.fetchrow(
                """
                INSERT INTO tags (slug, display, use_count)
                VALUES ($1, $2, 1)
                ON CONFLICT (slug) DO UPDATE
                  SET use_count = tags.use_count + 1, last_seen = now()
                RETURNING id
                """,
                slug, "#" + slug,
            )
            if tag:
                await conn.execute(
                    "INSERT INTO moan_tags (moan_id, tag_id) VALUES ($1, $2) "
                    "ON CONFLICT DO NOTHING",
                    moan_id, tag["id"],
                )

    log.info("seeder_posted", persona=persona["handle"], team=team["name"], moan_id=moan_id)
    return True
