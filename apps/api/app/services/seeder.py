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
import structlog

from . import llm

log = structlog.get_logger(__name__)

# Each persona is one entry. The system prompt sets the voice; the schedule
# weight controls how often they're picked relative to others.
_GROUNDING_RULES = (
    " HARD RULES — these override the persona voice:"
    " (1) Use ONLY the facts supplied in the user message."
    " (2) Never invent player names, manager names, transfers, injuries,"
    " quotes, or events not in the facts."
    " (3) Do not invent scorelines or claim a result for a match that hasn't"
    " happened."
    " (4) If you don't have enough real material, comment on the matchup,"
    " the venue, the competition, or the team's actual recent form — never"
    " fabricate."
    " (5) British English. One sentence. No emoji. Max one hashtag at the end."
)

_PERSONAS: list[dict[str, Any]] = [
    {
        "handle": "TERRACE_TOM",
        "weight": 3,
        "system": (
            "You are TERRACE_TOM, a 60-year-old grumpy season-ticket holder "
            "weary of modern football: ticket prices, VAR, kick-off times. "
            "Voice: dry, world-weary, mildly bitter."
            + _GROUNDING_RULES
        ),
    },
    {
        "handle": "THE_GAFFER",
        "weight": 3,
        "system": (
            "You are THE_GAFFER, an armchair manager who thinks any club's "
            "problems can be fixed with a 3-5-2 and a target man. Voice: "
            "confident, tactical jargon, slightly delusional."
            + _GROUNDING_RULES
        ),
    },
    {
        "handle": "PUNDIT_PETE",
        "weight": 3,
        "system": (
            "You are PUNDIT_PETE, a parody of a Sky Sports pundit who deals "
            "in clichés and contradictions. Voice: smug, soundbite-heavy."
            + _GROUNDING_RULES
        ),
    },
    {
        "handle": "HOT_TAKE_HARRY",
        "weight": 2,
        "system": (
            "You are HOT_TAKE_HARRY, a cocky pub mate firing off divisive "
            "takes. Voice: short, opinionated, sharp." + _GROUNDING_RULES
        ),
    },
    {
        "handle": "RAGE_RANKER",
        "weight": 1,
        "system": (
            "You are RAGE_RANKER, who reduces a club's problems to one brutal "
            "stat or league-position quip. Voice: dry data energy."
            + _GROUNDING_RULES
        ),
    },
]


def _pick_persona() -> dict[str, Any]:
    weights = [p["weight"] for p in _PERSONAS]
    return random.choices(_PERSONAS, weights=weights, k=1)[0]


async def _seed_call(system: str, user: str) -> dict[str, Any] | None:
    return await llm.complete_json(
        system + (
            '\n\nReturn JSON ONLY: '
            '{"text": "<≤200 chars including hashtag>", '
            '"kind": "ROAST|MOAN|BANTER"}'
        ),
        user,
        max_tokens=250,
    )


async def _pick_target_team(conn: asyncpg.Connection) -> dict[str, Any] | None:
    """Pick a real upcoming or recently-finished fixture from the last 5 days
    or the next 5 days. Returns None if there's no fixture in window — better
    to skip a tick than fabricate.

    Includes the team's last 5 real FT results so the LLM can ground its take
    in actual form rather than make things up.
    """
    fix = await conn.fetchrow(
        """
        SELECT t.id::text AS id, t.name, t.short_name, t.league, f.competition,
               f.home_score, f.away_score, f.status::text AS status,
               f.kickoff_at,
               (t.id = f.home_team_id) AS is_home,
               ot.name AS opponent, ot.short_name AS opponent_short
          FROM fixtures f
          JOIN teams t  ON t.id IN (f.home_team_id, f.away_team_id)
          JOIN teams ot ON ot.id IN (f.home_team_id, f.away_team_id)
                        AND ot.id != t.id
         WHERE f.kickoff_at BETWEEN now() - interval '5 days'
                                AND now() + interval '5 days'
         ORDER BY random()
         LIMIT 1
        """,
    )
    if not fix:
        return None
    # Recent form — last 5 FT fixtures the team played, oldest→newest in
    # the prompt so "WWLDW" reads naturally.
    form_rows = await conn.fetch(
        """
        SELECT f.kickoff_at, f.home_score, f.away_score,
               (f.home_team_id = $1) AS was_home,
               oh.short_name AS opp
          FROM fixtures f
          JOIN teams oh ON oh.id = CASE WHEN f.home_team_id = $1
                                        THEN f.away_team_id
                                        ELSE f.home_team_id END
         WHERE f.status = 'FT'
           AND $1 IN (f.home_team_id, f.away_team_id)
           AND f.kickoff_at < now()
         ORDER BY f.kickoff_at DESC LIMIT 5
        """,
        fix["id"],
    )
    out = dict(fix)
    out["form"] = list(reversed([dict(r) for r in form_rows]))
    return out


def _prompt_for(persona: dict[str, Any], team: dict[str, Any]) -> str:
    """Hand the LLM only verified facts from our DB. The system prompt has
    a strict no-invention rule so it can't add fake injuries, fake quotes,
    or fake players."""
    name = team["name"]
    opponent = team["opponent"]
    status = team["status"]
    is_home = team["is_home"]
    kickoff = team["kickoff_at"]
    competition = team["competition"]
    venue = "home" if is_home else "away"

    # Compose form line from the real last-5
    form_lines = []
    for r in team.get("form", []):
        team_score = r["home_score"] if r["was_home"] else r["away_score"]
        opp_score = r["away_score"] if r["was_home"] else r["home_score"]
        if team_score is None or opp_score is None:
            continue
        result = "W" if team_score > opp_score else ("L" if team_score < opp_score else "D")
        form_lines.append(f"  {result} vs {r['opp']} ({team_score}-{opp_score})")
    form_block = "\n".join(form_lines) if form_lines else "  (no recent results)"

    if status == "FT":
        hs, as_ = team["home_score"], team["away_score"]
        team_score = hs if is_home else as_
        opp_score = as_ if is_home else hs
        outcome = "won" if team_score > opp_score else ("lost" if team_score < opp_score else "drew")
        context = (
            f"FACTS (do not contradict, do not invent additional events):\n"
            f"- Competition: {competition}\n"
            f"- {name} just {outcome} {venue} vs {opponent} ({team_score}-{opp_score})\n"
            f"- {name}'s last 5 results (oldest first):\n{form_block}\n"
            f"- Kickoff was {kickoff:%a %d %b}"
        )
    elif status == "LIVE":
        hs, as_ = team["home_score"] or 0, team["away_score"] or 0
        team_score = hs if is_home else as_
        opp_score = as_ if is_home else hs
        context = (
            f"FACTS (do not contradict, do not invent additional events):\n"
            f"- Competition: {competition}\n"
            f"- {name} are LIVE {venue} vs {opponent}, current score {team_score}-{opp_score}\n"
            f"- {name}'s last 5 results:\n{form_block}"
        )
    else:  # SCHEDULED
        context = (
            f"FACTS (do not contradict, do not invent):\n"
            f"- Competition: {competition}\n"
            f"- {name} play {opponent} {venue} on {kickoff:%a %d %b}\n"
            f"- {name}'s last 5 results:\n{form_block}\n"
            f"- The match has not yet kicked off — do not reference a result"
        )

    return (
        f"{context}\n\n"
        f"Write a {persona['handle']}-flavoured moan in the persona's voice. "
        f"Stick strictly to the facts above. Do not invent injuries, quotes, "
        f"player names, transfer rumours, or events that aren't listed."
    )


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
