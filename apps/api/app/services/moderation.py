"""AI moderation via Claude.

Scores a moan 0.0-1.0 where 1.0 = very high legal risk (defamation,
crime allegations, slurs about real people).

If ANTHROPIC_API_KEY is unset (e.g. dev), returns score=0 and proceeds.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

import structlog
from anthropic import AsyncAnthropic

from ..config import get_settings

log = structlog.get_logger(__name__)

_HOLD_THRESHOLD = 0.7
_MODEL = "claude-haiku-4-5-20251001"

_SYSTEM_PROMPT = """You score user-generated sports banter posts for legal risk on Moanyfans, a UK \
football moaning platform.

Return JSON ONLY: {"score": <0.0 to 1.0>, "reason": "<short, ≤120 chars>"}.

Scale:
- 0.0-0.3: opinion/banter about teams or players, no real-person crime allegations, no slurs.
- 0.3-0.6: aggressive but legal — hyperbole, harsh ratings, fan-vs-fan tribalism.
- 0.6-0.85: borderline — naming a real person + serious negative claim that would need proof.
- 0.85-1.0: clear UK defamation/Online Safety Act risk — alleging crime/drugs/infidelity/abuse \
of a real person, slurs targeting protected characteristics, or doxxing.

Be tolerant of strong opinions ("X is the worst defender ever", "Y are insufferable fans") — these \
are protected opinion. Only escalate when claims of fact about real people would need a court \
defence."""


@dataclass
class ModerationResult:
    score: float
    reason: str
    should_hold: bool


async def moderate_moan(text: str) -> ModerationResult:
    settings = get_settings()
    if not settings.anthropic_api_key:
        return ModerationResult(score=0.0, reason="moderation disabled (no key)", should_hold=False)

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    try:
        msg = await client.messages.create(
            model=_MODEL,
            max_tokens=200,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": text}],
        )
        content = msg.content[0].text if msg.content else "{}"
        # Models occasionally wrap JSON in prose — pull the first JSON object.
        match = re.search(r"\{.*?\}", content, re.DOTALL)
        if not match:
            log.warning("moderation_no_json", text=content[:200])
            return ModerationResult(score=0.0, reason="parse failed (open)", should_hold=False)
        data = json.loads(match.group(0))
        score = float(data.get("score", 0))
        reason = str(data.get("reason", ""))[:200]
    except Exception:
        log.exception("moderation_call_failed")
        # Fail open — don't block users when our service flakes.
        return ModerationResult(score=0.0, reason="moderation call failed", should_hold=False)

    return ModerationResult(score=score, reason=reason, should_hold=score >= _HOLD_THRESHOLD)
