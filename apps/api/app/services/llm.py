"""Single LLM gateway used by every AI service in the app.

Why: keeps provider/model choices in one place, lets the rest of the code
ignore which API actually answers, and means a key swap is a one-file edit.

Provider:
  - Text generation: Groq (llama-3.3-70b-versatile) only. If Groq fails or
    is rate-limited, the caller gets None and the take simply doesn't post.
  - Image classification: Groq (llama-4-scout vision) only. Returns
    UNAVAILABLE on failure so callers fail closed (never publish).

No paid third-party fallbacks — Groq is the only provider here.
"""
from __future__ import annotations

import json
import re
from typing import Any

import httpx
import structlog

from ..config import get_settings

log = structlog.get_logger(__name__)

_GROQ_TEXT_MODEL = "llama-3.3-70b-versatile"
_GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"


def _extract_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except Exception:
        return None


# ── TEXT ────────────────────────────────────────────────────────────────────

async def _groq_text(system: str, user: str, max_tokens: int,
                      temperature: float = 0.7) -> str | None:
    settings = get_settings()
    if not settings.groq_api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.groq_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": _GROQ_TEXT_MODEL,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
            )
        if r.status_code != 200:
            body = (r.text or "")[:300]
            log.warning("groq_text_non200",
                          status=r.status_code, body=body)
            return None
        return r.json()["choices"][0]["message"]["content"]
    except Exception:
        log.exception("groq_text_failed")
        return None


async def complete_json(system: str, user: str, *, max_tokens: int = 250,
                          temperature: float = 0.7) -> dict[str, Any] | None:
    """Returns the first JSON object found in Groq's reply, or None."""
    raw = await _groq_text(system, user, max_tokens, temperature)
    if raw:
        return _extract_json(raw)
    return None


async def complete_text(system: str, user: str, *, max_tokens: int = 250) -> str | None:
    """Plain text completion via Groq. Returns the raw model text or None."""
    return await _groq_text(system, user, max_tokens)


# ── VISION (image classification) ───────────────────────────────────────────

_VISION_PROMPT = (
    "You are an image safety classifier for a UK football banter platform. "
    "Reply with EXACTLY one word from this list:\n"
    "  SAFE   — fine for a public sports feed\n"
    "  NSFW   — explicit nudity, sexual content, gore, or extreme violence\n"
    "  ILLEGAL — minors in a sexualised context, terrorism imagery, real-world "
    "violence, or other illegal content\n"
    "When in doubt between SAFE and NSFW, pick NSFW. Reply with ONLY the "
    "single word — no punctuation, no explanation."
)


async def _groq_vision(b64_webp: str) -> str | None:
    settings = get_settings()
    if not settings.groq_api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.groq_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": _GROQ_VISION_MODEL,
                    "max_tokens": 10,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": _VISION_PROMPT},
                            {"type": "image_url", "image_url": {
                                "url": f"data:image/webp;base64,{b64_webp}",
                            }},
                        ],
                    }],
                },
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip().upper()
    except Exception:
        log.exception("groq_vision_failed")
        return None


async def classify_image(b64_webp: str) -> str:
    """Returns 'SAFE', 'NSFW', 'ILLEGAL', or 'UNAVAILABLE' if Groq didn't
    answer. Callers must fail closed on UNAVAILABLE — never publish."""
    verdict = await _groq_vision(b64_webp)
    if verdict in {"SAFE", "NSFW", "ILLEGAL"}:
        return verdict
    if verdict:
        log.warning("image_moderation_unknown_verdict", verdict=verdict[:40])
    return "UNAVAILABLE"
