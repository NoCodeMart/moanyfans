"""Tiny in-memory rate limiter (per key, per window).

Good enough for single-replica deploys. Move to Redis when we scale out.
Returns retry-after seconds when over budget.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from ..auth import CurrentUser

_buckets: dict[str, deque[float]] = defaultdict(deque)
# Cap bucket count so a stream of unique IPs (botnet) can't OOM us.
# Once we hit the cap we evict the oldest-touched buckets first.
_MAX_BUCKETS = 50_000
_bucket_touch: dict[str, float] = {}


def _evict_if_needed() -> None:
    if len(_buckets) <= _MAX_BUCKETS:
        return
    # Drop the 10% oldest by last touch — cheap amortised cleanup.
    drop = sorted(_bucket_touch.items(), key=lambda kv: kv[1])[: _MAX_BUCKETS // 10]
    for k, _ in drop:
        _buckets.pop(k, None)
        _bucket_touch.pop(k, None)


def _take(key: str, *, limit: int, window_s: int) -> None:
    now = time.monotonic()
    cutoff = now - window_s
    bucket = _buckets[key]
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= limit:
        retry = int(window_s - (now - bucket[0])) + 1
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Rate limit exceeded — try again in {retry}s",
            headers={"Retry-After": str(retry)},
        )
    bucket.append(now)
    _bucket_touch[key] = now
    _evict_if_needed()


def limit_user(user: CurrentUser, *, action: str, limit: int, window_s: int = 60) -> None:
    _take(f"u:{user.id}:{action}", limit=limit, window_s=window_s)


def _client_ip(request: Request) -> str:
    """Return the real client IP, trusting X-Forwarded-For ONLY when the
    immediate connection came from a local proxy (Coolify/Traefik).

    Trusting the header from arbitrary peers lets attackers spoof their IP
    and bypass per-IP rate limits entirely.
    """
    direct = request.client.host if request.client else "?"
    # Coolify's Traefik runs on the Docker bridge → 172.x or 10.x.
    # 127.x covers anything looped back through localhost.
    trusted = (
        direct.startswith("172.") or direct.startswith("10.")
        or direct.startswith("127.") or direct == "::1"
    )
    if trusted:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip() or direct
    return direct


def limit_ip(request: Request, *, action: str, limit: int, window_s: int = 60) -> None:
    _take(f"ip:{_client_ip(request)}:{action}", limit=limit, window_s=window_s)
