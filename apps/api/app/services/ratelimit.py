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


def limit_user(user: CurrentUser, *, action: str, limit: int, window_s: int = 60) -> None:
    _take(f"u:{user.id}:{action}", limit=limit, window_s=window_s)


def limit_ip(request: Request, *, action: str, limit: int, window_s: int = 60) -> None:
    fwd = request.headers.get("x-forwarded-for", "")
    ip = (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?"))
    _take(f"ip:{ip}:{action}", limit=limit, window_s=window_s)
