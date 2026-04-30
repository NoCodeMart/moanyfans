"""AI moderation via Claude.

Scores a moan 0.0-1.0 where 1.0 = very high legal risk (defamation,
crime allegations, slurs about real people).

If ANTHROPIC_API_KEY is unset (e.g. dev), returns score=0 and proceeds.
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog

from . import llm

log = structlog.get_logger(__name__)

_HOLD_THRESHOLD = 0.7

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
    data = await llm.complete_json(_SYSTEM_PROMPT, text, max_tokens=200)
    if not data:
        # Fail open — never block users on a flaky moderation call.
        return ModerationResult(score=0.0, reason="moderation unavailable", should_hold=False)
    try:
        score = float(data.get("score", 0))
        reason = str(data.get("reason", ""))[:200]
    except (TypeError, ValueError):
        log.warning("moderation_bad_payload", data=str(data)[:200])
        return ModerationResult(score=0.0, reason="moderation parse failed", should_hold=False)
    return ModerationResult(score=score, reason=reason, should_hold=score >= _HOLD_THRESHOLD)
