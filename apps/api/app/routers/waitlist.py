"""Pre-launch waitlist signups.

Public POST is rate-limited per IP. Admin GET exposes the list and a CSV export.
"""
from __future__ import annotations

import csv
import io
import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr

from ..auth import CurrentUser
from ..services.ratelimit import limit_ip
from .admin import require_admin

router = APIRouter(tags=["waitlist"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class WaitlistJoinBody(BaseModel):
    email: EmailStr
    source: str | None = None


@router.post("/waitlist", status_code=200)
async def join_waitlist(body: WaitlistJoinBody, request: Request) -> dict[str, str]:
    limit_ip(request, action="waitlist", limit=5, window_s=600)
    email = str(body.email).strip()
    if not _EMAIL_RE.match(email) or len(email) > 254:
        raise HTTPException(400, "Invalid email.")
    email_lc = email.lower()
    fwd = request.headers.get("x-forwarded-for", "")
    ip = (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None))
    ua = (request.headers.get("user-agent") or "")[:300]
    source = (body.source or "")[:60] or None

    pool = request.app.state.pool
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO waitlist_emails (email, email_lc, ip, user_agent, source)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (email_lc) DO NOTHING
            """,
            email, email_lc, ip, ua, source,
        )
    return {"status": "ok"}


# ── Admin views ────────────────────────────────────────────────────────────

class WaitlistRow(BaseModel):
    email: str
    source: str | None
    created_at: str


@router.get("/admin/waitlist", response_model=list[WaitlistRow])
async def list_waitlist(request: Request,
                        _: Annotated[CurrentUser, Depends(require_admin)],
                        limit: int = 500) -> list[WaitlistRow]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT email, source, created_at FROM waitlist_emails "
            "ORDER BY created_at DESC LIMIT $1", limit,
        )
    return [
        WaitlistRow(email=r["email"], source=r["source"],
                    created_at=r["created_at"].isoformat())
        for r in rows
    ]


@router.get("/admin/waitlist.csv")
async def export_waitlist(request: Request,
                          _: Annotated[CurrentUser, Depends(require_admin)]) -> StreamingResponse:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT email, source, created_at FROM waitlist_emails ORDER BY created_at",
        )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["email", "source", "created_at"])
    for r in rows:
        w.writerow([r["email"], r["source"] or "", r["created_at"].isoformat()])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="waitlist.csv"'},
    )


@router.get("/admin/waitlist/count")
async def waitlist_count(request: Request,
                         _: Annotated[CurrentUser, Depends(require_admin)]) -> dict[str, int]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        n = await conn.fetchval("SELECT count(*) FROM waitlist_emails")
    return {"count": int(n)}
