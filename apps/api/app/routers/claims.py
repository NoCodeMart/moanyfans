"""Reserved-handle claims.

Public POST /claims — anyone (a real Klopp, a club's marketing team) submits
a request for a reserved handle. Heavily rate-limited.

Admin GET/POST under /admin/claims/* — review queue, approve (releases the
handle), deny (records reason). Approval doesn't auto-create a user — the
claimant gets the handle made available and is told to sign up at moanyfans.com
and pick it. Email notification is wired separately when Resend is up.
"""
from __future__ import annotations

import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from ..auth import CurrentUser
from ..services import handles
from ..services.ratelimit import _client_ip, limit_ip
from .admin import require_admin

router = APIRouter(tags=["claims"])

_URL_RE = re.compile(r"^https?://", re.IGNORECASE)


class SubmitClaim(BaseModel):
    handle: str = Field(min_length=handles.HANDLE_MIN, max_length=handles.HANDLE_MAX)
    claimant_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    social_proof: str = Field(min_length=8, max_length=2000)
    message: str | None = Field(default=None, max_length=2000)


@router.post("/claims", status_code=201)
async def submit_claim(body: SubmitClaim, request: Request) -> dict[str, str]:
    """Public submission. Limited to 3 claims per IP per day."""
    limit_ip(request, action="claim_submit", limit=3, window_s=86_400)

    handle = handles.normalise(body.handle)
    if (err := handles.format_error(handle)):
        raise HTTPException(400, err)

    pool = request.app.state.pool
    async with pool.acquire() as conn:
        # Confirm the handle is actually reserved — no point claiming a
        # name nobody's holding back.
        reserved = await conn.fetchval(
            "SELECT 1 FROM reserved_handles WHERE handle_lc = lower($1) AND released_at IS NULL",
            handle,
        )
        if not reserved:
            raise HTTPException(400, "That handle isn't reserved — sign up and grab it.")

        # Lightweight URL sanity on social_proof
        urls = [u for u in re.split(r"[\s,;]+", body.social_proof) if u]
        if not any(_URL_RE.match(u) for u in urls):
            raise HTTPException(400, "Please include at least one URL as proof "
                                     "(verified social account, official site, etc).")

        ip = _client_ip(request)
        ua = (request.headers.get("user-agent") or "")[:300]
        try:
            await conn.execute(
                """
                INSERT INTO handle_claims
                  (handle_lc, claimant_name, email, email_lc, social_proof,
                   message, ip, user_agent)
                VALUES ($1, $2, $3, lower($3), $4, $5, $6, $7)
                """,
                handle.lower(), body.claimant_name.strip(), str(body.email),
                body.social_proof.strip(), (body.message or "").strip() or None,
                ip, ua,
            )
        except Exception as e:
            # Unique constraint violation — already pending claim
            if "handle_claims_dedupe_pending_idx" in str(e):
                raise HTTPException(409, "You've already submitted a pending claim for this handle.") from e
            raise
    return {"status": "submitted"}


# ── Admin review ───────────────────────────────────────────────────────────

class ClaimRow(BaseModel):
    id: str
    handle: str
    claimant_name: str
    email: str
    social_proof: str
    message: str | None
    status: str
    created_at: str
    reviewed_at: str | None = None
    review_notes: str | None = None


@router.get("/admin/claims", response_model=list[ClaimRow])
async def list_claims(request: Request,
                      _: Annotated[CurrentUser, Depends(require_admin)],
                      status_: Annotated[str, Field(alias="status")] = "PENDING",
                      limit: int = 100) -> list[ClaimRow]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id::text, handle_lc, claimant_name, email, social_proof,
                   message, status, created_at, reviewed_at, review_notes
              FROM handle_claims
             WHERE status = $1
             ORDER BY created_at DESC
             LIMIT $2
            """,
            status_.upper(), limit,
        )
    return [
        ClaimRow(
            id=r["id"],
            handle=r["handle_lc"].upper(),
            claimant_name=r["claimant_name"],
            email=r["email"],
            social_proof=r["social_proof"],
            message=r["message"],
            status=r["status"],
            created_at=r["created_at"].isoformat(),
            reviewed_at=r["reviewed_at"].isoformat() if r["reviewed_at"] else None,
            review_notes=r["review_notes"],
        ) for r in rows
    ]


class ReviewBody(BaseModel):
    action: Literal["approve", "deny"]
    notes: str | None = Field(default=None, max_length=1000)


@router.post("/admin/claims/{claim_id}/review")
async def review_claim(claim_id: str, body: ReviewBody, request: Request,
                       caller: Annotated[CurrentUser, Depends(require_admin)]) -> dict[str, str]:
    pool = request.app.state.pool
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "SELECT handle_lc, status FROM handle_claims WHERE id = $1 FOR UPDATE",
            claim_id,
        )
        if not row:
            raise HTTPException(404, "Claim not found.")
        if row["status"] != "PENDING":
            raise HTTPException(400, f"Claim already {row['status'].lower()}.")

        new_status = "APPROVED" if body.action == "approve" else "DENIED"
        await conn.execute(
            """
            UPDATE handle_claims
               SET status = $1, reviewed_by = $2, reviewed_at = now(), review_notes = $3
             WHERE id = $4
            """,
            new_status, caller.id, body.notes, claim_id,
        )

        if body.action == "approve":
            # Release the handle so the claimant can grab it on signup.
            await conn.execute(
                "UPDATE reserved_handles SET released_at = now(), released_by = $1 "
                "WHERE handle_lc = $2 AND released_at IS NULL",
                caller.id, row["handle_lc"],
            )
    return {"status": new_status.lower()}
