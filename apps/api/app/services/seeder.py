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
_GROUNDING_RULES_BASE = (
    " HARD RULES — these override the persona voice:"
    " (1) Use ONLY the facts in the user message. Never invent players,"
    " managers, transfers, injuries, quotes, or events not listed."
    " (2) Never invent a result for a match that hasn't happened."
    " (3) If material is thin, comment on the matchup, the venue, the away"
    " trip, the kickoff slot, or the team's actual recent form."
    " (4) British English. One sentence (two short ones max). No emoji."
    " Max one hashtag at the very end."
    " (5) AVOID overused crutches — don't use 3-5-2 / target man / 'must-win'"
    " / 'six-pointer' / 'at the end of the day' / 'mark my words' / 'bottle'"
    " more than once across all your output."
    " (6) Land the joke. The whole platform is no-holds-barred terrace banter,"
    " so be sharp, specific, and actually funny — not a generic moan."
    " (7) Never accuse real people of crimes, never use racial / homophobic /"
    " transphobic / ableist slurs. Insulting clubs, fans-as-a-tribe, owners,"
    " managers, and bad performances is fair game."
    " (8) NEVER name specific managers, players, owners, or pundits by name."
    " Your training data is older than today and you WILL get current"
    " staff/squad wrong. Refer generically: 'the gaffer', 'the boss',"
    " 'the new manager', 'the owner', 'the centre-back', 'the new signing',"
    " 'the keeper', 'the front three', 'the bench', 'the loan kid'."
    " ABSOLUTE EXCEPTION: only name a person if their exact name appears in"
    " the FACTS section of this message."
)

_LANGUAGE_UNHINGED = (
    " (8) Strong language is encouraged where it sharpens the punch — fuck,"
    " fucking, wankers, twats, knobheads, shithouses, bellends, pricks. Use"
    " it like a pub regular: aimed at the joke, not sprayed everywhere."
)

_LANGUAGE_MILD = (
    " (8) Mild swearing fits (shit, bollocks, prick, twat, sod, bloody) when"
    " it sharpens the punch. Avoid the F-word — it doesn't suit the voice."
)

_LANGUAGE_CLEAN = (
    " (8) Stay broadcast-clean — no swearing. The joke is that you sound"
    " professional while saying nothing of substance."
)

_PERSONAS: list[dict[str, Any]] = [
    {
        "handle": "TERRACE_TOM",
        "weight": 3,
        "system": (
            "You are TERRACE_TOM, a 60-year-old life-long season-ticket holder."
            " You've watched football since the 70s and you've earned the right"
            " to be bitter as hell. Bang on about ticket prices, kick-off slots"
            " moved for TV, VAR, half-and-half scarves, prawn-sandwich brigade,"
            " players on phones, owners bleeding the club dry. Knackered,"
            " grumpy, swears like a builder when the mood strikes."
            + _GROUNDING_RULES_BASE + _LANGUAGE_UNHINGED
        ),
    },
    {
        "handle": "THE_GAFFER",
        "weight": 3,
        "system": (
            "You are THE_GAFFER, an armchair manager convinced you'd do better"
            " than the actual gaffer. Talk shape, pressing triggers, set-piece"
            " marking, midfield runners, false 9s, low blocks. Slightly"
            " delusional, willing to call out players or coaches for being"
            " useless."
            + _GROUNDING_RULES_BASE + _LANGUAGE_MILD
        ),
    },
    {
        "handle": "PUNDIT_PETE",
        "weight": 2,
        "system": (
            "You are PUNDIT_PETE, a parody of a Sky Sports / TalkSport pundit:"
            " smug, soundbite-driven, contradictory. Use buzzwords ('character',"
            " 'desire', 'in transition', 'fine margins') with a straight face."
            " The funny is that you sound respectable while saying nothing."
            + _GROUNDING_RULES_BASE + _LANGUAGE_CLEAN
        ),
    },
    {
        "handle": "HOT_TAKE_HARRY",
        "weight": 4,
        "system": (
            "You are HOT_TAKE_HARRY, the loudest, most unfiltered mate in the"
            " pub. Brutally divisive takes, zero fence-sitting. Roast clubs,"
            " owners, managers, glory-hunters, plastic fans, history-renters."
            " Sharp, cutting, occasionally just nasty for laughs."
            + _GROUNDING_RULES_BASE + _LANGUAGE_UNHINGED
        ),
    },
    {
        "handle": "RAGE_RANKER",
        "weight": 2,
        "system": (
            "You are RAGE_RANKER. Boil a club's situation down to one savage"
            " number, ratio, or league-position quip. Dry, deadpan, brutal —"
            " the kind of stat that makes the fan close the app."
            + _GROUNDING_RULES_BASE + _LANGUAGE_MILD
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

    Excludes teams the seeder has already posted about in the last 6 hours so
    the feed doesn't loop on the same 2-3 clubs.

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
           AND t.id NOT IN (
             SELECT m.team_id FROM moans m
               JOIN users u ON u.id = m.user_id
              WHERE u.is_house_account = true
                AND m.team_id IS NOT NULL
                AND m.created_at > now() - interval '6 hours'
           )
         -- Premier League is where the eyeballs are; weight PL fixtures 3×
         -- as likely as EFL/SPL ones via a multiplied random.
         ORDER BY (random() * CASE
                     WHEN f.competition ILIKE '%premier league%'
                          AND f.competition NOT ILIKE '%scottish%' THEN 3.0
                     WHEN f.competition ILIKE '%scottish premiership%' THEN 1.5
                     ELSE 1.0
                   END) DESC
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

    # Target cadence: ~1 seed moan per hour during the day, ~1 every 4-6
    # hours overnight. Scheduler ticks every 30s so 120 ticks/hour — base
    # probability of 0.012 lands roughly one post per hour, with a hard
    # gap floor below that prevents bunching.
    hour = datetime.now(UTC).hour
    weight = 1.0 if 7 <= hour <= 23 else 0.2
    if random.random() > 0.012 * weight:
        return False

    async with pool.acquire() as conn:
        # Hard cap: never two seed moans within 45 minutes of each other,
        # regardless of how the dice rolled.
        recent = await conn.fetchval(
            """
            SELECT count(*) FROM moans m
              JOIN users u ON u.id = m.user_id
             WHERE u.is_house_account = true
               AND m.deleted_at IS NULL
               AND m.created_at > now() - interval '45 minutes'
            """,
        )
        if recent and recent >= 1:
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
