"""AI match recaps — short tabloid-flavoured write-ups generated when a
Premier League or Scottish Premiership fixture goes FT.

One recap per fixture (UNIQUE in DB). Idempotent: re-runs are no-ops.
Cost: ~£0.001 per recap on Haiku 4.5. PL+SPL only at launch keeps
volume to ~30/week.
"""

from __future__ import annotations

import json
import re

import asyncpg
import structlog
from anthropic import AsyncAnthropic

from ..config import get_settings

log = structlog.get_logger(__name__)

_MODEL = "claude-haiku-4-5-20251001"

_RECAP_LEAGUES = {"Premier League", "Scottish Premiership"}

_SYSTEM_PROMPT = """You write 90-word tabloid match recaps for Moanyfans, a UK football \
moaning platform. Tone: British, sharp, banter — like the Daily Mirror back page if it ran on \
caffeine. Punchy, opinionated, no neutral PA-wire prose.

Return JSON ONLY:
{"headline": "<≤72 chars, ALL CAPS optional>", "body": "<3-4 short sentences, ≤500 chars>"}

Rules:
- No fabricated facts. Stick to score, teams, competition. If you don't know who scored, don't claim.
- No defamation. No real-person crime claims. Player surnames only if obvious from public record.
- British English. Use "draw" not "tie", "kit" not "uniform", "manager" not "coach".
- End the body with a one-line zinger fans of the losing side will hate."""


async def generate_recap_for_fixture(
    conn: asyncpg.Connection,
    fixture_id: str,
) -> bool:
    """Generate + insert a recap if eligible. Returns True on insert."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        return False

    row = await conn.fetchrow(
        """
        SELECT f.id::text AS id, f.competition, f.home_score, f.away_score,
               ht.name AS home, ht.short_name AS home_short,
               at.name AS away, at.short_name AS away_short
          FROM fixtures f
          JOIN teams ht ON ht.id = f.home_team_id
          JOIN teams at ON at.id = f.away_team_id
         WHERE f.id = $1 AND f.status = 'FT'
        """,
        fixture_id,
    )
    if not row:
        return False
    if row["competition"] not in _RECAP_LEAGUES:
        return False
    if await conn.fetchval("SELECT 1 FROM match_recaps WHERE fixture_id = $1", row["id"]):
        return False

    user_prompt = (
        f"Match: {row['home']} {row['home_score']}-{row['away_score']} {row['away']}\n"
        f"Competition: {row['competition']}\n"
        "Write the recap."
    )

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    try:
        msg = await client.messages.create(
            model=_MODEL,
            max_tokens=400,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        content = msg.content[0].text if msg.content else "{}"
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if not match:
            log.warning("recap_no_json", text=content[:200])
            return False
        data = json.loads(match.group(0))
        headline = str(data.get("headline", ""))[:120].strip()
        body = str(data.get("body", ""))[:600].strip()
    except Exception:
        log.exception("recap_generation_failed", fixture_id=fixture_id)
        return False
    if not headline or not body:
        return False

    await conn.execute(
        """
        INSERT INTO match_recaps (fixture_id, headline, body, model)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (fixture_id) DO NOTHING
        """,
        row["id"], headline, body, _MODEL,
    )
    log.info("recap_generated", fixture_id=fixture_id, headline=headline[:60])
    return True
