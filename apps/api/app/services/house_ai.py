"""House AI accounts that post on a cron.

- HOT_TAKE_HARRY: posts a punchy take to the feed within minutes of every
  PL/SPL FT result. One per fixture (deduped via house_ai_log).
- RAGE_RANKER: posts a weekly leaderboard of the most embarrassing
  performances every Sunday night. One per ISO week.

COPELORD_BOT (auto-replies to fresh moans) is wired separately on moan
publish — TODO when we add reply hooks.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime

import asyncpg
import structlog
from anthropic import AsyncAnthropic

from ..config import get_settings

log = structlog.get_logger(__name__)

_MODEL = "claude-haiku-4-5-20251001"


_HOT_TAKE_SYSTEM = """You are HOT_TAKE_HARRY, a house AI account on Moanyfans (UK football moaning \
platform) who posts punchy reactions to full-time results. Voice: cocky, short, opinionated, \
British — like a pub mate who's had three pints and an opinion on everything.

Return JSON ONLY: {"text": "<≤280 chars including hashtags>", "kind": "ROAST|MOAN|BANTER"}

Rules:
- One single sentence or two short ones. No essays.
- One or two hashtags max, ending the post.
- No defamation. No real-person crime claims. Names of clubs only.
- British English."""


_COPE_SYSTEM = """You are COPELORD_BOT, a house AI account on Moanyfans (UK football moaning \
platform). Your job: reply to a fan's moan with the most copium-soaked reply imaginable, \
finding the silver lining nobody asked for. Voice: delusional optimism, deadpan, British.

Return JSON ONLY: {"text": "<≤220 chars, ending with #COPE>"}

Rules:
- One short reply. No essays. No advice. Pure cope.
- Lean into the absurdity. Say their disaster is "actually a long-term plan."
- No defamation, no real-person crime claims. British English."""


_RAGE_RANKER_SYSTEM = """You are RAGE_RANKER, a house AI account on Moanyfans that publishes a \
weekly UK football leaderboard of the most embarrassing performances of the week. Tone: dry, \
British tabloid, pure banter.

Return JSON ONLY: {"text": "<≤480 chars, structured as a numbered ranking>"}

Rules:
- Format: "WEEK <N> RAGE RANKINGS — 1) <Team> (<short reason>) 2) <Team> (...) 3) <Team> (...). #RAGE_RANKER"
- Use the supplied list of weekend FT results to choose teams.
- Three entries, ordered most-embarrassing first.
- One witty parenthetical per entry, no fabricated facts beyond the score.
- British English."""


async def _claude_json(system: str, user: str) -> dict | None:
    settings = get_settings()
    if not settings.anthropic_api_key:
        return None
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    try:
        msg = await client.messages.create(
            model=_MODEL, max_tokens=400, system=system,
            messages=[{"role": "user", "content": user}],
        )
        content = msg.content[0].text if msg.content else "{}"
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if not m:
            return None
        return json.loads(m.group(0))
    except Exception:
        log.exception("house_ai_call_failed")
        return None


async def _post_moan(
    conn: asyncpg.Connection, user_handle: str, team_id: str | None,
    text: str, kind: str,
    *,
    fixture_id: str | None = None,
    match_minute: int | None = None,
    side: str | None = None,
) -> str | None:
    user = await conn.fetchrow(
        "SELECT id::text AS id FROM users WHERE handle = $1", user_handle,
    )
    if not user:
        return None
    row = await conn.fetchrow(
        """
        INSERT INTO moans (user_id, team_id, kind, status, text, rage_level,
                           fixture_id, match_minute, side)
        VALUES ($1, $2, $3, 'PUBLISHED', $4, 5, $5, $6, $7)
        RETURNING id::text AS id
        """,
        user["id"], team_id, kind, text,
        fixture_id, match_minute, side,
    )
    moan_id = row["id"] if row else None
    if moan_id:
        # Tags: same regex extraction the API uses
        tags = {m.upper() for m in re.findall(r"#([A-Za-z0-9_]{2,32})", text)}
        for slug in tags:
            tag = await conn.fetchrow(
                """
                INSERT INTO tags (slug, display, use_count)
                VALUES ($1, $2, 1)
                ON CONFLICT (slug) DO UPDATE SET use_count = tags.use_count + 1, last_seen = now()
                RETURNING id::text AS id
                """,
                slug, "#" + slug,
            )
            if tag:
                await conn.execute(
                    "INSERT INTO moan_tags (moan_id, tag_id) VALUES ($1, $2) "
                    "ON CONFLICT DO NOTHING",
                    moan_id, tag["id"],
                )
    return moan_id


_GOAL_TAKE_SYSTEM = """You are HOT_TAKE_HARRY, a house AI account on Moanyfans (UK football \
moaning platform). A goal has just gone in. Drop a punchy in-match take from the perspective \
of a pub mate watching live. Voice: cocky, short, opinionated, British, mildly chaotic.

Return JSON ONLY: {"text": "<≤220 chars including hashtags>", "kind": "ROAST|MOAN|BANTER"}

Rules:
- Single sentence. No essays. No emoji.
- Side with whichever fan base is suffering more — if it's a smash-and-grab equaliser, roast \
the team that conceded; if it's a thrashing, pile on.
- One hashtag max, ending the post.
- No slurs, no targeting individuals beyond surnames in the public record.
- British English."""


async def goal_take_for_fixture(
    conn: asyncpg.Connection,
    fixture_id: str,
    scoring_team_id: str,
    conceding_team_id: str,
    minute: int,
    home_score: int,
    away_score: int,
    scoring_side: str,  # 'HOME' | 'AWAY'
) -> bool:
    """Post HOT_TAKE_HARRY's reaction to a single goal. Idempotent per goal event."""
    ref = f"{fixture_id}:{minute}:{home_score}-{away_score}"
    if await conn.fetchval(
        "SELECT 1 FROM house_ai_log WHERE kind='goal_take' AND ref=$1", ref,
    ):
        return False

    row = await conn.fetchrow(
        """
        SELECT f.competition,
               ht.short_name AS home_short, at.short_name AS away_short,
               st.name AS scorer_name, st.short_name AS scorer_short,
               ct.name AS conceder_name, ct.short_name AS conceder_short
          FROM fixtures f
          JOIN teams ht ON ht.id = f.home_team_id
          JOIN teams at ON at.id = f.away_team_id
          JOIN teams st ON st.id = $2
          JOIN teams ct ON ct.id = $3
         WHERE f.id = $1
        """,
        fixture_id, scoring_team_id, conceding_team_id,
    )
    if not row:
        return False

    prompt = (
        f"{row['scorer_name']} just scored against {row['conceder_name']} on {minute}'. "
        f"Score: {row['home_short']} {home_score}-{away_score} {row['away_short']} "
        f"({row['competition']}). Drop the take."
    )
    data = await _claude_json(_GOAL_TAKE_SYSTEM, prompt)
    if not data:
        return False
    text = str(data.get("text", "")).strip()[:480]
    kind = str(data.get("kind", "BANTER")).upper()
    if kind not in {"ROAST", "MOAN", "BANTER"}:
        kind = "BANTER"
    if not text:
        return False

    moan_id = await _post_moan(
        conn, "HOT_TAKE_HARRY", conceding_team_id, text, kind,
        fixture_id=fixture_id, match_minute=minute, side=scoring_side,
    )
    if not moan_id:
        return False
    await conn.execute(
        "INSERT INTO house_ai_log (kind, ref) VALUES ('goal_take', $1) "
        "ON CONFLICT DO NOTHING",
        ref,
    )
    log.info("goal_take_posted", fixture_id=fixture_id, minute=minute, moan_id=moan_id)
    return True


async def hot_take_for_fixture(conn: asyncpg.Connection, fixture_id: str) -> bool:
    """Post a HOT_TAKE_HARRY moan for a freshly-FT fixture. Idempotent."""
    if await conn.fetchval(
        "SELECT 1 FROM house_ai_log WHERE kind='hot_take' AND ref=$1", fixture_id,
    ):
        return False

    row = await conn.fetchrow(
        """
        SELECT f.competition, f.home_score, f.away_score,
               ht.id::text AS home_id, ht.name AS home, ht.short_name AS home_short,
               at.id::text AS away_id, at.name AS away, at.short_name AS away_short
          FROM fixtures f
          JOIN teams ht ON ht.id = f.home_team_id
          JOIN teams at ON at.id = f.away_team_id
         WHERE f.id = $1 AND f.status = 'FT'
        """,
        fixture_id,
    )
    if not row:
        return False
    if row["competition"] not in {"Premier League", "Scottish Premiership"}:
        return False

    prompt = (
        f"Result: {row['home']} {row['home_score']}-{row['away_score']} {row['away']} "
        f"({row['competition']}). Write Harry's hot take."
    )
    data = await _claude_json(_HOT_TAKE_SYSTEM, prompt)
    if not data:
        return False
    text = str(data.get("text", "")).strip()[:480]
    kind = str(data.get("kind", "BANTER")).upper()
    if kind not in {"ROAST", "MOAN", "BANTER"}:
        kind = "BANTER"
    if not text:
        return False

    # Pick the loser's team_id so the moan attaches to that team's feed
    if row["home_score"] is not None and row["away_score"] is not None:
        team_id = row["away_id"] if row["home_score"] > row["away_score"] else row["home_id"]
    else:
        team_id = row["home_id"]

    moan_id = await _post_moan(conn, "HOT_TAKE_HARRY", team_id, text, kind)
    if not moan_id:
        return False
    await conn.execute(
        "INSERT INTO house_ai_log (kind, ref) VALUES ('hot_take', $1) "
        "ON CONFLICT DO NOTHING",
        fixture_id,
    )
    log.info("hot_take_posted", fixture_id=fixture_id, moan_id=moan_id)
    return True


async def rage_ranker_weekly(pool: asyncpg.Pool) -> bool:
    """Post a RAGE_RANKER weekly leaderboard if we haven't already this ISO week."""
    now = datetime.now(UTC)
    iso_year, iso_week, _ = now.isocalendar()
    week_ref = f"{iso_year}-W{iso_week:02d}"

    async with pool.acquire() as conn:
        if await conn.fetchval(
            "SELECT 1 FROM house_ai_log WHERE kind='rage_ranker_weekly' AND ref=$1", week_ref,
        ):
            return False
        rows = await conn.fetch(
            """
            SELECT f.competition, f.home_score, f.away_score,
                   ht.short_name AS home, at.short_name AS away
              FROM fixtures f
              JOIN teams ht ON ht.id = f.home_team_id
              JOIN teams at ON at.id = f.away_team_id
             WHERE f.status = 'FT'
               AND f.kickoff_at >= now() - interval '7 days'
               AND f.competition IN ('Premier League', 'Championship', 'Scottish Premiership')
             ORDER BY f.kickoff_at DESC
             LIMIT 40
            """,
        )
    if len(rows) < 3:
        return False

    results = "\n".join(
        f"- {r['home']} {r['home_score']}-{r['away_score']} {r['away']} ({r['competition']})"
        for r in rows
    )
    prompt = (
        f"This week's FT results (week {week_ref}):\n{results}\n\n"
        "Write Rage Ranker's weekly top 3 most-embarrassing performances."
    )
    data = await _claude_json(_RAGE_RANKER_SYSTEM, prompt)
    if not data:
        return False
    text = str(data.get("text", "")).strip()[:600]
    if not text:
        return False

    async with pool.acquire() as conn:
        moan_id = await _post_moan(conn, "RAGE_RANKER", None, text, "BANTER")
        if not moan_id:
            return False
        await conn.execute(
            "INSERT INTO house_ai_log (kind, ref) VALUES ('rage_ranker_weekly', $1) "
            "ON CONFLICT DO NOTHING",
            week_ref,
        )
    log.info("rage_ranker_posted", week=week_ref, moan_id=moan_id)
    return True


async def copelord_reply_to(pool: asyncpg.Pool, moan_id: str) -> bool:
    """Post a COPELORD_BOT reply to a user moan. Idempotent per moan."""
    async with pool.acquire() as conn:
        if await conn.fetchval(
            "SELECT 1 FROM house_ai_log WHERE kind='cope_reply' AND ref=$1", moan_id,
        ):
            return False
        row = await conn.fetchrow(
            """
            SELECT m.text, m.kind, m.team_id::text AS team_id, u.is_house_account
              FROM moans m JOIN users u ON u.id = m.user_id
             WHERE m.id = $1 AND m.status = 'PUBLISHED' AND m.deleted_at IS NULL
            """,
            moan_id,
        )
    if not row or row["is_house_account"]:
        return False
    if row["kind"] not in {"MOAN", "ROAST"}:
        return False

    prompt = f"User moaned: \"{row['text']}\"\nWrite Copelord's reply."
    data = await _claude_json(_COPE_SYSTEM, prompt)
    if not data:
        return False
    text = str(data.get("text", "")).strip()[:300]
    if not text:
        return False

    async with pool.acquire() as conn, conn.transaction():
        # Insert as a reply (parent_moan_id = moan_id)
        user = await conn.fetchrow(
            "SELECT id::text FROM users WHERE handle = 'COPELORD_BOT'",
        )
        if not user:
            return False
        new_id = await conn.fetchval(
            """
            INSERT INTO moans (user_id, team_id, parent_moan_id, kind, status, text, rage_level)
            VALUES ($1, $2, $3, 'MOAN', 'PUBLISHED', $4, 3)
            RETURNING id::text
            """,
            user["id"], row["team_id"], moan_id, text,
        )
        # Tags
        tags = {m.upper() for m in re.findall(r"#([A-Za-z0-9_]{2,32})", text)}
        for slug in tags:
            tag = await conn.fetchrow(
                """
                INSERT INTO tags (slug, display, use_count) VALUES ($1, $2, 1)
                ON CONFLICT (slug) DO UPDATE SET use_count = tags.use_count + 1, last_seen = now()
                RETURNING id::text AS id
                """,
                slug, "#" + slug,
            )
            if tag:
                await conn.execute(
                    "INSERT INTO moan_tags (moan_id, tag_id) VALUES ($1, $2) "
                    "ON CONFLICT DO NOTHING",
                    new_id, tag["id"],
                )
        await conn.execute(
            "INSERT INTO house_ai_log (kind, ref) VALUES ('cope_reply', $1) "
            "ON CONFLICT DO NOTHING",
            moan_id,
        )
    log.info("cope_reply_posted", moan_id=moan_id, reply_id=new_id)
    return True


# ── Loop runners ────────────────────────────────────────────────────────────

async def hot_takes_for_recent_ft(pool: asyncpg.Pool) -> int:
    """Find FT fixtures from the last 2 hours that haven't had a hot take yet."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT f.id::text AS id
              FROM fixtures f
         LEFT JOIN house_ai_log h ON h.kind='hot_take' AND h.ref = f.id::text
             WHERE f.status = 'FT'
               AND f.kickoff_at >= now() - interval '4 hours'
               AND f.competition IN ('Premier League', 'Scottish Premiership')
               AND h.ref IS NULL
             LIMIT 10
            """,
        )
    posted = 0
    for r in rows:
        async with pool.acquire() as conn:
            if await hot_take_for_fixture(conn, r["id"]):
                posted += 1
    return posted
