"""Web Push dispatch.

Holds the VAPID-signed pywebpush call, the per-notification payload builder,
and the scheduler tick that flushes unpushed notifications. We never block
the request lifecycle on push delivery — everything happens out-of-band.

Failure handling:
- 404/410 from a push endpoint means the subscription is gone for good
  (user uninstalled, browser cleared storage). Delete the row.
- Any other exception is logged and the notification is left as un-pushed
  for the next tick — bounded by a 24h cutoff so we never replay stale
  notifications if the dispatcher is broken for a day.
"""
from __future__ import annotations

import asyncio
import base64
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg
import structlog
from pywebpush import WebPushException, webpush

from ..config import Settings, get_settings

log = structlog.get_logger(__name__)

# Don't replay anything older than this — protects users from notification
# floods if the dispatcher was down for a long stretch.
MAX_PUSH_AGE = timedelta(hours=24)


def public_key_b64(settings: Settings | None = None) -> str | None:
    settings = settings or get_settings()
    return settings.vapid_public_key_b64


def _vapid_private_pem(b64: str) -> str:
    """py-vapid stores its private key as the raw 32-byte EC scalar, base64url
    encoded. pywebpush wants the same value as PEM. Reconstruct it via
    cryptography."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    raw = base64.urlsafe_b64decode(b64 + "==")
    priv_int = int.from_bytes(raw, "big")
    priv = ec.derive_private_key(priv_int, ec.SECP256R1())
    pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return pem.decode()


def _payload_for(notif: asyncpg.Record, web_base: str) -> dict[str, Any]:
    p = notif["payload"] or {}
    kind = notif["kind"]
    if kind == "followed":
        handle = p.get("follower_handle", "someone")
        return {
            "title": "New follower",
            "body": f"@{handle} followed you.",
            "url": f"{web_base}/?u={handle}",
            "tag": f"follow:{handle}",
        }
    if kind == "replied":
        handle = p.get("replier_handle", "someone")
        preview = (p.get("preview") or "")[:80]
        parent_id = p.get("parent_id", "")
        return {
            "title": f"@{handle} replied",
            "body": preview or "You got a reply.",
            "url": f"{web_base}/m/{parent_id}",
            "tag": f"reply:{parent_id}",
        }
    if kind == "reaction":
        handle = p.get("reactor_handle", "someone")
        r = p.get("reaction", "")
        label = {
            "laughs": "😂 HA", "agrees": "💯 TRUE",
            "cope": "🤡 CLOWN", "ratio": "🧂 SEETHE",
        }.get(r, "reacted")
        moan_id = p.get("moan_id", "")
        return {
            "title": f"@{handle} hit {label}",
            "body": "On your moan.",
            "url": f"{web_base}/m/{moan_id}",
            "tag": f"react:{moan_id}",
        }
    return {"title": "Moanyfans", "body": kind.replace("_", " "), "url": web_base, "tag": kind}


async def _send_one(
    pool: asyncpg.Pool, sub: asyncpg.Record, payload: dict[str, Any], settings: Settings,
) -> bool:
    assert settings.vapid_private_key_b64
    sub_info = {
        "endpoint": sub["endpoint"],
        "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
    }
    pem = _vapid_private_pem(settings.vapid_private_key_b64)
    try:
        # pywebpush is sync; run it in the default executor so we don't block.
        await asyncio.to_thread(
            webpush,
            subscription_info=sub_info,
            data=json.dumps(payload),
            vapid_private_key=pem,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=86400,
        )
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE push_subscriptions SET last_used_at = now() WHERE id = $1",
                sub["id"],
            )
        return True
    except WebPushException as exc:
        # 404/410 = subscription gone forever — purge it.
        status = getattr(exc.response, "status_code", None)
        if status in (404, 410):
            async with pool.acquire() as conn:
                await conn.execute("DELETE FROM push_subscriptions WHERE id = $1", sub["id"])
            log.info("push_subscription_purged", id=str(sub["id"]), status=status)
        else:
            log.warning("push_send_failed", id=str(sub["id"]), status=status, err=str(exc))
        return False


async def dispatch_pending(pool: asyncpg.Pool) -> int:
    """Find recent unpushed notifications, send to every sub for each user.
    Marks pushed_at regardless of per-sub outcome — we don't retry forever."""
    settings = get_settings()
    if not settings.vapid_private_key_b64:
        return 0
    cutoff = datetime.now(UTC) - MAX_PUSH_AGE

    async with pool.acquire() as conn:
        notifs = await conn.fetch(
            """
            SELECT id::text AS id, user_id::text AS user_id, kind, payload, created_at
              FROM notifications
             WHERE pushed_at IS NULL AND created_at >= $1
             ORDER BY created_at
             LIMIT 200
            """,
            cutoff,
        )
        if not notifs:
            return 0
        user_ids = list({n["user_id"] for n in notifs})
        subs = await conn.fetch(
            "SELECT id, user_id::text AS user_id, endpoint, p256dh, auth "
            "FROM push_subscriptions WHERE user_id = ANY($1::uuid[])",
            user_ids,
        )

    by_user: dict[str, list[asyncpg.Record]] = {}
    for s in subs:
        by_user.setdefault(s["user_id"], []).append(s)

    sent = 0
    for n in notifs:
        targets = by_user.get(n["user_id"], [])
        if targets:
            payload = _payload_for(n, settings.web_public_base)
            for sub in targets:
                if await _send_one(pool, sub, payload, settings):
                    sent += 1
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE notifications SET pushed_at = now() WHERE id = $1::uuid", n["id"],
            )
    if sent:
        log.info("push_dispatched", notifications=len(notifs), pushes_sent=sent)
    return sent
