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
from . import llm


log = structlog.get_logger(__name__)

_MODEL = "claude-haiku-4-5-20251001"


_NO_NAMING_RULE = (
    "- HARD RULE: NEVER name specific managers, players, owners, or pundits "
    "by name. Your training data is older than today and you WILL get current "
    "staff and squads wrong. ABSOLUTE EXCEPTION: only name a person if their "
    "exact name appears in the user-provided FACTS section.\n"
    "- DO NOT call for the manager's head, do not say 'gaffer's got to go', "
    "'sack the manager', 'manager out', 'new gaffer needed' or similar — the "
    "manager may already have been sacked or just appointed and you won't "
    "know. Aim your venom at the players, the defending, the fans, the "
    "owners' silence, the club's direction — never the manager's job security.\n"
    "- HARD RULE: NEVER make claims about league position, form, or where a "
    "team sits in the table. Banned phrases include but not limited to: "
    "'relegation form', 'relegation zone', 'going down', 'doomed to drop', "
    "'mid-table mediocrity', 'top of the league', 'top four', 'top six', "
    "'promotion push', 'survival fight', 'European places'. A team you "
    "assume is fighting relegation might actually be top of the Championship "
    "chasing promotion. You DO NOT KNOW the current table. Stick to what just "
    "happened in this match: the goal, the defending, the touch, the chance, "
    "the keeper's hands, the away support, the atmosphere, the shape, the "
    "tempo. If FACTS includes table position, use it; otherwise stay silent "
    "on it.\n"
    "- HARD RULE: NEVER invent specific match events you weren't told about — "
    "no fake red cards, no fake injuries, no fake goal scorers, no fake "
    "missed penalties. Only reference what's in the prompt."
)


# Six distinct angle pools — the prompt picks one at random per call so
# the AI can't fall into the same vocabulary loop ('shambles / wankers /
# defending like Sunday leaguers' every goal). Each tells the model a
# completely different lens to write the take through.
_GOAL_ANGLES = [
    "DEFENDING ANGLE — focus entirely on how the back line / keeper got "
    "carved open. Static, slow, ball-watching, sleeping, no marking, "
    "phantom challenges. Do not mention anything else.",
    "TRAVELLING SUPPORT ANGLE — write from the perspective of the away "
    "fans (or the home fans if it's a home goal). The pub song they're "
    "about to sing, the long trip up the M6 worth it, the Sunday morning "
    "hangover already booked. Match feel, not tactics.",
    "OWNERSHIP / BOARDROOM ANGLE — the takeover that hasn't happened, "
    "the silence from the directors' box, the season ticket renewals "
    "this is going to ruin, the recruitment that put this squad together. "
    "Aim at the suits.",
    "MIDFIELD ANGLE — nobody in the middle, overrun, can't keep the ball, "
    "second to every loose one, no press, no shape, ghosts in shirts. "
    "The goal happened because the midfield was already lost.",
    "ATMOSPHERE / GROUND ANGLE — the stadium going flat, the home end "
    "heading for the exits early, the silence you can hear on the telly, "
    "the away end roaring, the half-time queue for the bar. Mood, not stats.",
    "COMEDY-OF-ERRORS ANGLE — the goal as slapstick. The miscommunication, "
    "the air-kick, the unlucky ricochet, the comedy own-goal energy "
    "even if it wasn't actually one. Like watching Sunday league.",
]


_HOT_TAKE_SYSTEM = f"""You are HOT_TAKE_HARRY, a house AI account on Moanyfans (UK football moaning \
platform) who posts punchy reactions to full-time results. Voice: cocky, short, opinionated, \
British — like a pub mate who's had three pints and an opinion on everything.

Return JSON ONLY: {{"text": "<≤280 chars including hashtags>", "kind": "ROAST|MOAN|BANTER"}}

Rules:
- One single sentence or two short ones. No essays.
- One or two hashtags max, ending the post.
- No defamation. No real-person crime claims. Names of clubs only.
{_NO_NAMING_RULE}
- British English."""


_COPE_SYSTEM = f"""You are COPELORD_BOT, a house AI account on Moanyfans (UK football moaning \
platform). Your job: reply to a fan's moan with the most copium-soaked reply imaginable, \
finding the silver lining nobody asked for. Voice: delusional optimism, deadpan, British.

Return JSON ONLY: {{"text": "<≤220 chars, ending with #COPE>"}}

Rules:
- One short reply. No essays. No advice. Pure cope.
- Lean into the absurdity. Say their disaster is "actually a long-term plan."
- No defamation, no real-person crime claims. British English.
{_NO_NAMING_RULE}"""


_RAGE_RANKER_SYSTEM = f"""You are RAGE_RANKER, a house AI account on Moanyfans that publishes a \
weekly UK football leaderboard of the most embarrassing performances of the week. Tone: dry, \
British tabloid, pure banter.

Return JSON ONLY: {{"text": "<≤480 chars, structured as a numbered ranking>"}}

Rules:
- Format: "WEEK <N> RAGE RANKINGS — 1) <Team> (<short reason>) 2) <Team> (...) 3) <Team> (...). #RAGE_RANKER"
- Use the supplied list of weekend FT results to choose teams.
- Three entries, ordered most-embarrassing first.
- One witty parenthetical per entry, no fabricated facts beyond the score.
- British English.
{_NO_NAMING_RULE}"""


async def _claude_json(system: str, user: str) -> dict | None:
    return await llm.complete_json(system, user, max_tokens=400)


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


_HARRY_SYSTEM = f"""You are HOT_TAKE_HARRY, a Moanyfans house account. A goal has just \
gone in. You are the savage pub mate who's had three pints. Voice: cocky, brutal, short, \
British, takes no prisoners. Vocabulary: shambles, joke, embarrassing, fuming.

Return JSON ONLY: {{"text": "<≤220 chars including hashtag>", "kind": "ROAST|MOAN|BANTER"}}

Rules:
- One or two sentences max. No emoji. No essays.
- BRUTAL — the conceding fans should be LIVID. Strong language ok (fuck, fucking,
  wankers, shithouses, knobheads, pricks). Aim it like a knife.
- One hashtag max ending the post.
- No slurs. Never accuse real people of crimes. NEVER insult sexuality, race,
  religion, gender, disability.
- The user prompt will assign you ONE ANGLE — stay on it.
{_NO_NAMING_RULE}
- British English."""


_TACTICAL_SYSTEM = f"""You are TACTICAL_TIM, a Moanyfans house account who used to play \
non-league centre-back twenty years ago and never shuts up about formations. Voice: smug, \
patronising, technical, condescending — like the man at the pub who keeps drawing diagrams \
on a beermat. You sneer rather than shout.

Return JSON ONLY: {{"text": "<≤220 chars including hashtag>", "kind": "ROAST|MOAN|BANTER"}}

Rules:
- One or two sentences. Use words like 'shape', 'compact block', 'transition', 'press \
  trigger', 'rest defence', 'ball-playing', 'progressive', 'cover-shadow', 'half-space'.
- No swearing. Patronising > brutal. Make the conceding fans feel thick.
- One hashtag max ending the post (e.g. #TacticalMasterclass — sarcastically).
- The user prompt will assign you ONE ANGLE — fold it into your tactical analysis.
{_NO_NAMING_RULE}
- British English."""


_NORM_SYSTEM = f"""You are NOSTALGIA_NORM, a Moanyfans house account aged about 68 who \
thinks football peaked sometime around 1986. Voice: weary, grumpy, every take starts with \
'in my day' or 'back when' or 'son, let me tell you'. Compares modern players unfavourably \
to fictional past players described only by position ('the centre-back I knew', 'a proper \
number 9'). Disgusted by everything modern.

Return JSON ONLY: {{"text": "<≤220 chars including hashtag>", "kind": "ROAST|MOAN|BANTER"}}

Rules:
- One or two sentences. Mention 'in my day' or 'back when' style framing.
- Reference vague historical eras: 'the 80s', 'when football was football', 'before all
  this nonsense', 'pre-Premier League', 'when grounds had terraces'.
- Mild swearing only (bloody, sodding) — Norm is from a more polite era.
- One hashtag max (e.g. #ProperFootballGone, #BackInMyDay).
- The user prompt will assign you ONE ANGLE — frame it as 'modern game has lost X'.
{_NO_NAMING_RULE}
- British English."""


_DAVE_SYSTEM = f"""You are DRUNK_DAVE, a Moanyfans house account on his eighth lager of \
the afternoon. Voice: ALL CAPS, typos, missed apostrophes, run-on thoughts, stream of \
consciousness. No grammar. Sometimes loses the thread mid-sentence.

Return JSON ONLY: {{"text": "<≤220 chars including hashtag>", "kind": "ROAST|MOAN|BANTER"}}

Rules:
- WRITE IN ALL CAPS. Drop apostrophes (its instead of it's, dont, wont). Insert
  one or two believable typos.
- Run-on sentences with 'and' or no punctuation. Lose your train of thought.
- Strong language fine (FCKING, BLOODY HELL, JESUS CHRIST). No slurs.
- One hashtag max, also in caps (e.g. #BLOODYHELL).
- The user prompt will assign you ONE ANGLE — react to it like a drunk man would,
  half-coherent.
{_NO_NAMING_RULE}
- British. The sloppier and more drunk-sounding, the better."""


_STAT_SYSTEM = f"""You are STAT_SHITHOUSE, a Moanyfans house account who confidently \
makes up oddly specific football statistics with total conviction. Voice: deadpan, \
encyclopaedic, completely fabricated but stated as fact.

Return JSON ONLY: {{"text": "<≤220 chars including hashtag>", "kind": "ROAST|MOAN|BANTER"}}

Rules:
- Lead with a specific made-up stat. Format examples:
  'First goal conceded from a corner on a Tuesday since November 2014.'
  '4th time this season they have conceded inside the opening 8 minutes of the second half.'
  'No team has shipped a goal from a long throw in this competition since 2011.'
- Stats must be plausible-sounding but completely invented. Don't reference real
  players or managers by name.
- Tone is matter-of-fact, like a TV graphic. Don't insult — just devastate with the stat.
- One hashtag max (e.g. #Stats, #TheNumbersDontLie).
- The user prompt will assign you ONE ANGLE — turn it into the stat.
{_NO_NAMING_RULE}
- British English."""


def _goal_narrative(
    *, scoring_side: str, prev_home: int, prev_away: int,
    new_home: int, new_away: int, minute: int,
) -> str:
    """Tag the match-state narrative this goal sits inside, so the persona
    can frame the take correctly. 2-1 after being 2-0 down is a 'comeback
    brewing'; 4-0 in the 80th is 'humiliation'; 90'+ go-ahead goal is a
    'late winner'. The model gets the tag plus a one-line description."""
    total_before = prev_home + prev_away
    total_after = new_home + new_away
    is_home = scoring_side == "HOME"
    scorer_prev = prev_home if is_home else prev_away
    other_prev = prev_away if is_home else prev_home
    scorer_new = new_home if is_home else new_away
    other_new = new_away if is_home else new_home
    diff_before = scorer_prev - other_prev
    diff_after = scorer_new - other_new
    late = minute >= 80

    if total_before == 0:
        return ("OPENER — first goal of the match, sets the tone. "
                "Either dam-breaking relief or against-the-run-of-play smash-and-grab.")
    if minute <= 15:
        return ("EARLY_BLOW — goal in the opening 15 minutes. The conceding "
                "team's whole game plan just got binned before they touched the ball.")
    if diff_before <= -2 and diff_after == 0:
        return (f"COMEBACK_COMPLETED — the scoring team were {abs(diff_before)} down "
                "and have now drawn level. Mental scenes. The conceding fans are "
                "already heading for the exits in horror.")
    if diff_before <= -2 and diff_after == -1:
        return (f"COMEBACK_STARTED — was {abs(diff_before)} down, now {abs(diff_after)} "
                "down. Comeback is ON, the conceding fans are sweating, the away end "
                "(or home end) believes again.")
    if diff_before == -1 and diff_after == 0:
        return ("EQUALISER — pulled level. Crowd erupts on one side, dies on the other. "
                "Game has completely flipped, the momentum tag swings.")
    if late and diff_before <= 0 and diff_after >= 1:
        return ("LATE_WINNER — go-ahead goal after the 80th minute. Smash and grab. "
                "Heartbreak for the conceding fans, scenes for the scoring fans.")
    if late and diff_before <= -2:
        return ("LATE_CONSOLATION — trailing badly, scored in the dying minutes. "
                "Pride goal, nothing more. The conceding fans had already left.")
    if diff_before >= 1:
        return (f"LEAD_EXTENDED — were already winning by {diff_before}, now winning "
                f"by {diff_after}. The game is dead, the conceding side is broken.")
    if total_after >= 4:
        return ("GOAL_FEST — match has now produced 4+ goals. This is open, mental, "
                "anything could happen. Defensive shapes have left the building.")
    return ("REGULAR_GOAL — mid-match goal at a normal scoreline. Frame it through "
            "your assigned angle.")


# Persona pool — each tuple is (handle, system_prompt). Goal-take rotation
# cycles through this list by goal index so consecutive goals are written by
# four completely different voices.
_GOAL_PERSONAS: list[tuple[str, str]] = [
    ("HOT_TAKE_HARRY",  _HARRY_SYSTEM),
    ("TACTICAL_TIM",    _TACTICAL_SYSTEM),
    ("NOSTALGIA_NORM",  _NORM_SYSTEM),
    ("DRUNK_DAVE",      _DAVE_SYSTEM),
    ("STAT_SHITHOUSE",  _STAT_SYSTEM),
]


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
               ht.name AS home_name, at.name AS away_name,
               st.name AS scorer_name, ct.name AS conceder_name,
               st.city AS scorer_city, ct.city AS conceder_city,
               st.founded_year AS scorer_founded, ct.founded_year AS conceder_founded,
               st.primary_color AS scorer_colour, ct.primary_color AS conceder_colour
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

    # Pull every prior take in this fixture across ALL personas so the next
    # one knows what's already been said (and which persona's turn it is).
    prior = await conn.fetch(
        """
        SELECT u.handle, m.text
          FROM moans m JOIN users u ON u.id = m.user_id
         WHERE u.is_house_account = true
           AND m.fixture_id = $1
           AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC LIMIT 8
        """,
        fixture_id,
    )

    # Rotate persona AND angle independently by goal count → 5 personas × 6
    # angles = 30 distinct combos before any repetition. Even back-to-back
    # goals get a different writer with a different lens.
    goal_idx = len(prior)
    handle, system_prompt = _GOAL_PERSONAS[goal_idx % len(_GOAL_PERSONAS)]
    angle = _GOAL_ANGLES[goal_idx % len(_GOAL_ANGLES)]

    avoid_block = ""
    if prior:
        bullets = "\n".join(f"- @{r['handle']}: {r['text']}" for r in prior)
        avoid_block = (
            "\n\nThese are the takes already posted in this match by other "
            "personas. Do NOT recycle their vocabulary, hashtags or angle. "
            "Write something with NO phrasing overlap:\n" + bullets
        )

    # Match-fact pack — gives the model raw material to riff on instead of
    # falling back to generic 'shambles' insults. None of these are made up;
    # they come from the teams table.
    facts = []
    if row["scorer_city"] and row["conceder_city"]:
        facts.append(f"{row['scorer_name']} are from {row['scorer_city']}, "
                       f"{row['conceder_name']} from {row['conceder_city']}.")
        if row["scorer_city"].lower() == row["conceder_city"].lower():
            facts.append("This is a CITY DERBY — extra venom warranted.")
    if row["conceder_founded"]:
        facts.append(f"{row['conceder_name']} were founded in {row['conceder_founded']}.")
    if row["scorer_colour"] and row["conceder_colour"]:
        facts.append(f"Kit colours: {row['scorer_name']} {row['scorer_colour']}, "
                       f"{row['conceder_name']} {row['conceder_colour']}.")
    facts_block = ("\n\nFACTS YOU CAN REFERENCE (these are real, anything else "
                     "you must not invent):\n" + "\n".join(f"- {f}" for f in facts)
                   if facts else "")

    # Compute the running score before this goal so we can label the moment.
    if scoring_side == "HOME":
        prev_home, prev_away = home_score - 1, away_score
    else:
        prev_home, prev_away = home_score, away_score - 1
    narrative = _goal_narrative(
        scoring_side=scoring_side,
        prev_home=prev_home, prev_away=prev_away,
        new_home=home_score, new_away=away_score,
        minute=minute,
    )

    prompt = (
        f"{row['scorer_name']} just scored against {row['conceder_name']} on {minute}'. "
        f"Score went from {prev_home}-{prev_away} to {home_score}-{away_score}. "
        f"({row['competition']}). Refer to teams by their full names: "
        f"{row['home_name']} (home) and {row['away_name']} (away).\n\n"
        f"MATCH STATE: {narrative}\n\n"
        f"YOUR ANGLE FOR THIS GOAL: {angle}\n\n"
        f"Your take MUST acknowledge the match state above (e.g. don't write "
        f"'game over' if it's a comeback brewing; don't write 'game on' if "
        f"the lead is now 4-0)."
        f"{facts_block}"
        f"\n\nDrop the take.{avoid_block}"
    )
    data = await llm.complete_json(system_prompt, prompt, max_tokens=400, temperature=1.0)
    if not data:
        return False
    text = str(data.get("text", "")).strip()[:480]
    kind = str(data.get("kind", "BANTER")).upper()
    if kind not in {"ROAST", "MOAN", "BANTER"}:
        kind = "BANTER"
    if not text:
        return False

    moan_id = await _post_moan(
        conn, handle, conceding_team_id, text, kind,
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


async def ft_choruses_for_recent_ft(pool: asyncpg.Pool) -> int:
    """Catch FT fixtures whose chorus didn't fire (e.g. deploy mid-match).

    A chorus is 'incomplete' if any of the 5 personas hasn't logged its
    ft_chorus row for that fixture yet. Re-running ft_chorus_for_fixture is
    idempotent per persona.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT f.id::text AS id
              FROM fixtures f
             WHERE f.status = 'FT'
               AND f.kickoff_at >= now() - interval '4 hours'
               AND (
                 SELECT count(*) FROM house_ai_log
                  WHERE kind='ft_chorus'
                    AND ref LIKE 'ft_chorus:' || f.id::text || ':%'
               ) < 5
             LIMIT 10
            """,
        )
    posted = 0
    for r in rows:
        async with pool.acquire() as conn:
            posted += await ft_chorus_for_fixture(conn, r["id"])
    return posted


def _ft_narrative(home: int, away: int, home_name: str, away_name: str) -> str:
    diff = abs(home - away)
    if home == away:
        if home + away >= 4:
            return (f"FT_THRILLER_DRAW — {home}-{away} draw, four+ goals. "
                    "Wide-open game, both keepers had a horror, both sets of fans "
                    "fuming with their defence and beaming about their attack.")
        if home + away == 0:
            return ("FT_BORE_DRAW — 0-0. Nobody enjoyed that. Both sets of fans "
                    "want their money back. Frame it as a waste of an afternoon.")
        return (f"FT_HONOURS_EVEN — {home}-{away} draw. Even share, neither set "
                "of fans satisfied, both feel they should have won.")
    winner = home_name if home > away else away_name
    loser = away_name if home > away else home_name
    if diff >= 4:
        return (f"FT_HUMILIATION — {winner} thrashed {loser} {home}-{away}. "
                "Embarrassing, no excuse, fans of the losing side livid. "
                "Lay into them.")
    if diff >= 2:
        return (f"FT_COMFORTABLE_WIN — {winner} beat {loser} {home}-{away} with "
                "ease. Job done, deserved it. Frame the loser as outclassed.")
    return (f"FT_NARROW_WIN — {winner} edged {loser} {home}-{away}. Could have "
            "gone either way, decided by a moment. Frame it as fine margins.")


_FT_PERSONA_INSTRUCTIONS: dict[str, str] = {
    "HOT_TAKE_HARRY": (
        "Drop your savage final-whistle verdict on the losing/drawing side. "
        "Pure pub-mate venom, one or two sentences."),
    "TACTICAL_TIM": (
        "Tactical post-mortem of the whole match in one or two sentences. "
        "Why the result happened — shape, midfield, pressing, transitions. "
        "Patronising, never shouty."),
    "NOSTALGIA_NORM": (
        "Grumpy 'in my day' summary of the whole 90 minutes. Compare what "
        "you just watched unfavourably to football of decades ago. "
        "Mild language only."),
    "DRUNK_DAVE": (
        "ALL CAPS, typos, run-on. React to the final score like a man on his "
        "tenth lager who's been watching since 12:30. Half coherent."),
    "STAT_SHITHOUSE": (
        "Drop one fabricated but plausible-sounding stat about the match or "
        "the result. Deadpan, like a TV graphic. No insults — let the stat do "
        "the work."),
}


async def ft_chorus_for_fixture(conn: asyncpg.Connection, fixture_id: str) -> int:
    """Post a FULL-TIME persona chorus: every persona drops one final take.

    Idempotent per-persona via house_ai_log entries keyed
    'ft_chorus:{fixture_id}:{handle}' so a missed dispatch can resume without
    duplicating posts. Returns the number of takes successfully posted.
    """
    row = await conn.fetchrow(
        """
        SELECT f.competition, f.home_score, f.away_score,
               ht.id::text AS home_id, ht.name AS home_name,
               at.id::text AS away_id, at.name AS away_name,
               ht.city AS home_city, at.city AS away_city,
               ht.founded_year AS home_founded, at.founded_year AS away_founded
          FROM fixtures f
          JOIN teams ht ON ht.id = f.home_team_id
          JOIN teams at ON at.id = f.away_team_id
         WHERE f.id = $1 AND f.status = 'FT'
        """,
        fixture_id,
    )
    if not row or row["home_score"] is None or row["away_score"] is None:
        return 0

    narrative = _ft_narrative(
        row["home_score"], row["away_score"],
        row["home_name"], row["away_name"],
    )
    losing_team_id = (
        row["away_id"] if row["home_score"] > row["away_score"]
        else row["home_id"] if row["away_score"] > row["home_score"]
        else None
    )

    facts: list[str] = []
    if row["home_city"] and row["away_city"]:
        facts.append(f"{row['home_name']} are from {row['home_city']}, "
                       f"{row['away_name']} from {row['away_city']}.")
        if row["home_city"].lower() == row["away_city"].lower():
            facts.append("This was a CITY DERBY.")
    facts_block = ("\n\nFACTS YOU CAN REFERENCE:\n" + "\n".join(f"- {f}" for f in facts)
                   if facts else "")

    posted = 0
    prior_takes: list[str] = []

    for handle, system_prompt in _GOAL_PERSONAS:
        ref = f"ft_chorus:{fixture_id}:{handle}"
        if await conn.fetchval(
            "SELECT 1 FROM house_ai_log WHERE kind='ft_chorus' AND ref=$1", ref,
        ):
            continue

        instr = _FT_PERSONA_INSTRUCTIONS.get(handle, "Drop a final-whistle take.")
        avoid_block = ""
        if prior_takes:
            bullets = "\n".join(f"- {t}" for t in prior_takes)
            avoid_block = (
                "\n\nOther personas have already posted these final-whistle "
                "takes — do NOT recycle their phrasing or angle:\n" + bullets
            )

        prompt = (
            f"FULL TIME. {row['home_name']} {row['home_score']}-"
            f"{row['away_score']} {row['away_name']} ({row['competition']}).\n\n"
            f"MATCH STATE: {narrative}\n\n"
            f"YOUR JOB: {instr}"
            f"{facts_block}"
            f"\n\nReturn JSON only.{avoid_block}"
        )
        data = await llm.complete_json(system_prompt, prompt, max_tokens=400, temperature=1.0)
        if not data:
            continue
        text = str(data.get("text", "")).strip()[:480]
        kind = str(data.get("kind", "BANTER")).upper()
        if kind not in {"ROAST", "MOAN", "BANTER"}:
            kind = "BANTER"
        if not text:
            continue

        moan_id = await _post_moan(
            conn, handle, losing_team_id, text, kind,
            fixture_id=fixture_id, match_minute=90, side=None,
        )
        if not moan_id:
            continue
        await conn.execute(
            "INSERT INTO house_ai_log (kind, ref) VALUES ('ft_chorus', $1) "
            "ON CONFLICT DO NOTHING",
            ref,
        )
        prior_takes.append(text)
        posted += 1

    if posted:
        log.info("ft_chorus_posted", fixture_id=fixture_id, count=posted)
    return posted
