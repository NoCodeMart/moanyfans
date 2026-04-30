"""House persona engagement with real users — reactions and replies.

Guardrails (cost-bounded by design):

  * ``settings.seeder_engagement`` — global kill switch (env var).
  * ``engage_max_replies_per_persona_per_day`` — per-persona daily reply cap.
  * ``engage_min_reactions_to_engage`` — only engage with moans that already
    have N+ reactions (amplifies traction, ignores noise).
  * Per-persona-per-target-user 24h cooldown — no dogpiling one human.
  * Reactions are free (no LLM); only replies cost tokens.

Worst case at defaults: 5 personas × 5 replies/day = 25 LLM calls/day.
At Groq llama-3.3-70b ~$0.0007/call, ~1.7p/day, ~£6/year.
"""
from __future__ import annotations

import random
import re
from typing import Any

import asyncpg
import structlog

from ..config import get_settings
from . import llm
from .seeder import _PERSONAS  # reuse the same persona voices

log = structlog.get_logger(__name__)

# Reactions enum (cope intentionally excluded — phasing it out per spec).
_REACTION_KINDS = ("laughs", "agrees", "ratio")


def _pick_persona() -> dict[str, Any]:
    weights = [p["weight"] for p in _PERSONAS]
    return random.choices(_PERSONAS, weights=weights, k=1)[0]


# ── Reactions (no LLM) ─────────────────────────────────────────────────────

async def maybe_react(pool: asyncpg.Pool) -> bool:
    """Drop a single house-account reaction on a recent human moan with traction.

    Cheap as chips — pure DB work. Called more often than maybe_reply so the
    feed gets gentle ambient activity even when the LLM budget is exhausted.
    """
    settings = get_settings()
    if not settings.seeder_engagement:
        return False
    if random.random() > 0.10:  # ~6/min at 30s tick — plenty
        return False

    async with pool.acquire() as conn:
        target = await conn.fetchrow(
            """
            SELECT m.id, m.user_id
              FROM moans m
              JOIN users u ON u.id = m.user_id
             WHERE m.deleted_at IS NULL
               AND m.status = 'PUBLISHED'
               AND u.is_house_account = false
               AND u.deleted_at IS NULL
               AND m.created_at > now() - interval '48 hours'
               AND (m.laughs + m.agrees + m.ratio) >= $1
             ORDER BY random()
             LIMIT 1
            """,
            settings.engage_min_reactions_to_engage,
        )
        if not target:
            return False

        # Pick a persona that hasn't already reacted to this moan.
        free = await conn.fetch(
            """
            SELECT u.id, u.handle FROM users u
             WHERE u.is_house_account = true
               AND u.deleted_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM reactions r
                  WHERE r.moan_id = $1 AND r.user_id = u.id
               )
            """,
            target["id"],
        )
        if not free:
            return False
        persona_user = random.choice(free)
        kind = random.choice(_REACTION_KINDS)

        try:
            await conn.execute(
                "INSERT INTO reactions (user_id, moan_id, kind) VALUES ($1, $2, $3) "
                "ON CONFLICT (user_id, moan_id) DO NOTHING",
                persona_user["id"], target["id"], kind,
            )
        except asyncpg.PostgresError:
            log.exception("engage_react_insert_failed")
            return False

    log.info("engage_react", persona=persona_user["handle"],
             moan_id=str(target["id"]), kind=kind)
    return True


# ── Replies (LLM, hard-capped) ─────────────────────────────────────────────

async def maybe_reply(pool: asyncpg.Pool) -> bool:
    """Drop a persona-flavoured reply on a recent human moan with traction.

    Heavy gating — see module docstring. Returns True iff a reply was posted.
    """
    settings = get_settings()
    if not settings.seeder_engagement:
        return False
    # Lower frequency than reactions — replies cost tokens.
    if random.random() > 0.025:
        return False

    async with pool.acquire() as conn:
        # Pick a persona whose daily reply budget isn't blown.
        budget_rows = await conn.fetch(
            """
            SELECT u.id, u.handle,
                   COALESCE((
                     SELECT count(*) FROM moans m
                      WHERE m.user_id = u.id
                        AND m.parent_moan_id IS NOT NULL
                        AND m.created_at > date_trunc('day', now())
                   ), 0)::int AS replies_today
              FROM users u
             WHERE u.is_house_account = true
               AND u.deleted_at IS NULL
            """,
        )
        eligible = [
            r for r in budget_rows
            if r["replies_today"] < settings.engage_max_replies_per_persona_per_day
        ]
        if not eligible:
            return False
        # Match the persona-voice list against eligible accounts.
        persona_handles = {p["handle"]: p for p in _PERSONAS}
        candidates = [(r, persona_handles[r["handle"]])
                      for r in eligible if r["handle"] in persona_handles]
        if not candidates:
            return False
        weights = [p["weight"] for _, p in candidates]
        persona_user, persona = random.choices(candidates, weights=weights, k=1)[0]

        # Find a target moan: human author, recent, has traction, no reply
        # from this persona, and this persona hasn't engaged this user in 24h.
        target = await conn.fetchrow(
            """
            SELECT m.id, m.text, m.user_id, mu.handle AS author_handle,
                   t.name AS team_name, t.short_name AS team_short
              FROM moans m
              JOIN users mu ON mu.id = m.user_id
              LEFT JOIN teams t ON t.id = m.team_id
             WHERE m.deleted_at IS NULL
               AND m.status = 'PUBLISHED'
               AND m.parent_moan_id IS NULL
               AND mu.is_house_account = false
               AND mu.deleted_at IS NULL
               AND mu.id <> $1
               AND m.created_at > now() - interval '24 hours'
               AND (m.laughs + m.agrees + m.ratio) >= $2
               AND NOT EXISTS (
                 SELECT 1 FROM moans rep
                  WHERE rep.parent_moan_id = m.id AND rep.user_id = $1
               )
               AND NOT EXISTS (
                 SELECT 1 FROM moans prev
                  WHERE prev.user_id = $1
                    AND prev.parent_moan_id IN (
                      SELECT id FROM moans WHERE user_id = m.user_id
                    )
                    AND prev.created_at > now() - interval '24 hours'
               )
             ORDER BY random()
             LIMIT 1
            """,
            persona_user["id"], settings.engage_min_reactions_to_engage,
        )
        if not target:
            return False

        # Ground the LLM in the actual moan we're replying to. No invention.
        team_line = (f"- About {target['team_name']}" if target["team_name"]
                     else "- No specific team tagged")
        user_prompt = (
            f"You are replying to a moan posted by a real fan @{target['author_handle']}.\n"
            f"FACTS — do not invent anything beyond this:\n"
            f"- Their moan: \"{target['text']}\"\n"
            f"{team_line}\n\n"
            f"Write a {persona['handle']} reply in your persona voice. One short"
            f" sentence (two max). React to what they actually said — agree, roast,"
            f" or escalate. No new facts, no fake stats, no invented players."
        )
        system = persona["system"] + (
            '\n\nReturn JSON ONLY: {"text": "<≤220 chars, no hashtag needed>"}'
        )
        try:
            data = await llm.complete_json(system, user_prompt, max_tokens=180)
        except Exception:
            log.exception("engage_llm_failed")
            return False
        if not data:
            return False
        text = str(data.get("text", "")).strip()[:480]
        if not text:
            return False

        reply_id = await conn.fetchval(
            """
            INSERT INTO moans (user_id, parent_moan_id, kind, status, text, rage_level)
            VALUES ($1, $2, 'BANTER', 'PUBLISHED', $3, 5)
            RETURNING id::text
            """,
            persona_user["id"], target["id"], text,
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
                    reply_id, tag["id"],
                )

    log.info("engage_reply", persona=persona_user["handle"],
             target=str(target["id"]), reply_id=reply_id)
    return True
