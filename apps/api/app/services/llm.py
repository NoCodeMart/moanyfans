"""Single LLM gateway used by every AI service in the app.

Why: keeps provider/model choices in one place, lets the rest of the code
ignore which API actually answers, and means a key swap is a one-file edit.

Provider preference:
  - Text generation: Groq (llama-3.3-70b-versatile) — fast, cheap, good
    enough for personas + moderation classification. Falls back to
    Anthropic Haiku if a Groq error or no Groq key.
  - Image classification: Groq (llama-4-scout vision). Falls back to
    Anthropic Haiku vision if Groq fails. If neither key is configured,
    returns 'SAFE' (fail-open — the report flow is the safety net).
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
_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"


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

async def _groq_text(system: str, user: str, max_tokens: int) -> str | None:
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
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
    except Exception:
        log.exception("groq_text_failed")
        return None


async def _anthropic_text(system: str, user: str, max_tokens: int) -> str | None:
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
                    "model": _ANTHROPIC_MODEL,
                    "max_tokens": max_tokens,
                    "system": system,
                    "messages": [{"role": "user", "content": user}],
                },
            )
            r.raise_for_status()
            data = r.json()
        return data["content"][0]["text"] if data.get("content") else None
    except Exception:
        log.exception("anthropic_text_failed")
        return None


async def complete_json(system: str, user: str, *, max_tokens: int = 250) -> dict[str, Any] | None:
    """Returns the first JSON object found in the model's reply.
    Tries Groq first, falls back to Anthropic. None if both fail."""
    raw = await _groq_text(system, user, max_tokens)
    if raw:
        parsed = _extract_json(raw)
        if parsed is not None:
            return parsed
    raw = await _anthropic_text(system, user, max_tokens)
    if raw:
        return _extract_json(raw)
    return None


async def complete_text(system: str, user: str, *, max_tokens: int = 250) -> str | None:
    """Plain text completion. Returns the raw model text or None."""
    raw = await _groq_text(system, user, max_tokens)
    if raw:
        return raw
    return await _anthropic_text(system, user, max_tokens)


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


async def _anthropic_vision(b64_webp: str) -> str | None:
    settings = get_settings()
    if not settings.anthropic_api_key:
        return None
    try:
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        msg = await client.messages.create(
            model=_ANTHROPIC_MODEL,
            max_tokens=10,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {
                        "type": "base64", "media_type": "image/webp", "data": b64_webp,
                    }},
                    {"type": "text", "text": _VISION_PROMPT},
                ],
            }],
        )
        return (msg.content[0].text if msg.content else "").strip().upper()
    except Exception:
        log.exception("anthropic_vision_failed")
        return None


async def classify_image(b64_webp: str) -> str:
    """Returns 'SAFE', 'NSFW', or 'ILLEGAL'. Fails open to 'SAFE' if neither
    provider can answer — the report flow is the backstop."""
    for verdict in (await _groq_vision(b64_webp), await _anthropic_vision(b64_webp)):
        if verdict in {"SAFE", "NSFW", "ILLEGAL"}:
            return verdict
        if verdict:
            log.warning("image_moderation_unknown_verdict", verdict=verdict[:40])
    return "SAFE"
