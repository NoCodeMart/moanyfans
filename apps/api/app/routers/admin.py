"""Owner / moderator console.

Every endpoint requires the caller to have users.is_admin = true.
Anything else returns 403. Read endpoints take precedence over write
ones in the route order so list views are cheap to serve.
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..auth import CurrentUser, get_current_user

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only.")
    return user


# ── Stats ──────────────────────────────────────────────────────────────────

class AdminStats(BaseModel):
    users_total: int
    users_24h: int
    moans_total: int
    moans_24h: int
    reports_open: int
    moans_held: int


@router.get("/stats", response_model=AdminStats)
async def stats(request: Request,
                _: Annotated[CurrentUser, Depends(require_admin)]) -> AdminStats:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        r = await conn.fetchrow("""
            SELECT
              (SELECT count(*) FROM users WHERE deleted_at IS NULL)::int AS users_total,
              (SELECT count(*) FROM users WHERE deleted_at IS NULL
                 AND created_at > now() - interval '24 hours')::int       AS users_24h,
              (SELECT count(*) FROM moans WHERE deleted_at IS NULL)::int  AS moans_total,
              (SELECT count(*) FROM moans WHERE deleted_at IS NULL
                 AND created_at > now() - interval '24 hours')::int       AS moans_24h,
              (SELECT count(*) FROM reports WHERE resolved = false)::int  AS reports_open,
              (SELECT count(*) FROM moans WHERE status = 'HELD'
                 AND deleted_at IS NULL)::int                             AS moans_held
        """)
    return AdminStats(**dict(r))


# ── Reports queue ──────────────────────────────────────────────────────────

class ReportRow(BaseModel):
    id: str
    moan_id: str
    moan_text: str
    moan_status: str
    moan_user_handle: str
    moan_deleted: bool
    reporter_handle: str
    reason: str
    created_at: str


@router.get("/reports", response_model=list[ReportRow])
async def list_reports(request: Request,
                       _: Annotated[CurrentUser, Depends(require_admin)],
                       resolved: bool = False,
                       limit: int = 100) -> list[ReportRow]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT r.id::text AS id,
                   r.moan_id::text AS moan_id,
                   m.text AS moan_text,
                   m.status::text AS moan_status,
                   (m.deleted_at IS NOT NULL) AS moan_deleted,
                   mu.handle AS moan_user_handle,
                   ru.handle AS reporter_handle,
                   r.reason,
                   r.created_at
              FROM reports r
              JOIN moans m  ON m.id = r.moan_id
              JOIN users mu ON mu.id = m.user_id
              JOIN users ru ON ru.id = r.reporter_id
             WHERE r.resolved = $1
             ORDER BY r.created_at DESC
             LIMIT $2
            """,
            resolved, limit,
        )
    return [
        ReportRow(
            id=r["id"], moan_id=r["moan_id"],
            moan_text=r["moan_text"], moan_status=r["moan_status"],
            moan_user_handle=r["moan_user_handle"],
            moan_deleted=r["moan_deleted"],
            reporter_handle=r["reporter_handle"],
            reason=r["reason"],
            created_at=r["created_at"].isoformat(),
        ) for r in rows
    ]


@router.post("/reports/{report_id}/resolve")
async def resolve_report(report_id: str, request: Request,
                         _: Annotated[CurrentUser, Depends(require_admin)]) -> dict[str, str]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        n = await conn.execute(
            "UPDATE reports SET resolved = true WHERE id = $1", report_id,
        )
    if n == "UPDATE 0":
        raise HTTPException(404, "Report not found")
    return {"status": "resolved"}


# ── Moan moderation ────────────────────────────────────────────────────────

class ModerateMoanBody(BaseModel):
    action: Literal["remove", "restore", "publish"]


@router.post("/moans/{moan_id}/moderate")
async def moderate_moan(moan_id: str, body: ModerateMoanBody, request: Request,
                        _: Annotated[CurrentUser, Depends(require_admin)]) -> dict[str, str]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        if body.action == "remove":
            n = await conn.execute(
                "UPDATE moans SET status = 'REMOVED', deleted_at = COALESCE(deleted_at, now()) "
                "WHERE id = $1", moan_id,
            )
        elif body.action == "restore":
            n = await conn.execute(
                "UPDATE moans SET status = 'PUBLISHED', deleted_at = NULL "
                "WHERE id = $1", moan_id,
            )
        else:  # publish — releases a HELD moan
            n = await conn.execute(
                "UPDATE moans SET status = 'PUBLISHED' "
                "WHERE id = $1 AND status = 'HELD'", moan_id,
            )
    if n == "UPDATE 0":
        raise HTTPException(404, "Moan not found or no-op")
    return {"status": body.action}


# ── User moderation ────────────────────────────────────────────────────────

class AdminUserRow(BaseModel):
    id: str
    handle: str
    is_admin: bool
    is_house: bool
    deleted: bool
    moan_count: int
    follower_count: int
    created_at: str


@router.get("/users", response_model=list[AdminUserRow])
async def list_users(request: Request,
                     _: Annotated[CurrentUser, Depends(require_admin)],
                     q: str | None = None,
                     include_deleted: bool = False,
                     limit: int = 50) -> list[AdminUserRow]:
    pool = request.app.state.pool
    sql = """
      SELECT u.id::text, u.handle, u.is_admin, u.is_house_account AS is_house,
             (u.deleted_at IS NOT NULL) AS deleted,
             u.follower_count,
             (SELECT count(*) FROM moans WHERE user_id = u.id
                AND deleted_at IS NULL)::int AS moan_count,
             u.created_at
        FROM users u
       WHERE TRUE
    """
    args: list = []
    if not include_deleted:
        sql += " AND u.deleted_at IS NULL"
    if q:
        args.append(f"%{q.lower()}%")
        sql += f" AND lower(u.handle) LIKE ${len(args)}"
    args.append(limit)
    sql += f" ORDER BY u.created_at DESC LIMIT ${len(args)}"
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    return [
        AdminUserRow(
            id=r["id"], handle=r["handle"],
            is_admin=r["is_admin"], is_house=r["is_house"],
            deleted=r["deleted"], moan_count=r["moan_count"],
            follower_count=r["follower_count"],
            created_at=r["created_at"].isoformat(),
        ) for r in rows
    ]


class UserActionBody(BaseModel):
    action: Literal["ban", "unban", "make_admin", "remove_admin"]


@router.post("/users/{handle}/action")
async def user_action(handle: str, body: UserActionBody, request: Request,
                      caller: Annotated[CurrentUser, Depends(require_admin)]) -> dict[str, str]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        target = await conn.fetchrow(
            "SELECT id::text AS id, handle FROM users WHERE lower(handle) = lower($1)",
            handle,
        )
        if not target:
            raise HTTPException(404, "User not found")
        if target["id"] == caller.id and body.action in {"ban", "remove_admin"}:
            raise HTTPException(400, "Cannot apply this action to yourself.")
        if body.action == "ban":
            await conn.execute(
                "UPDATE users SET deleted_at = now() WHERE id = $1", target["id"],
            )
            # Also soft-delete all their moans so they vanish from feeds.
            await conn.execute(
                "UPDATE moans SET deleted_at = COALESCE(deleted_at, now()) "
                "WHERE user_id = $1", target["id"],
            )
        elif body.action == "unban":
            await conn.execute(
                "UPDATE users SET deleted_at = NULL WHERE id = $1", target["id"],
            )
        elif body.action == "make_admin":
            await conn.execute(
                "UPDATE users SET is_admin = true WHERE id = $1", target["id"],
            )
        else:  # remove_admin
            await conn.execute(
                "UPDATE users SET is_admin = false WHERE id = $1", target["id"],
            )
    return {"status": body.action}
