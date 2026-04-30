"""Notifications: list / unread count / mark-read."""
from __future__ import annotations

from datetime import UTC
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from ..auth import CurrentUser, get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


class Notification(BaseModel):
    id: str
    kind: str
    payload: dict[str, Any]
    read_at: str | None = None
    created_at: str


@router.get("", response_model=list[Notification])
async def list_notifications(
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    limit: int = Query(default=30, ge=1, le=100),
    unread_only: bool = Query(default=False),
) -> list[Notification]:
    pool = request.app.state.pool
    sql = (
        "SELECT id::text, kind::text, payload, read_at, created_at "
        "  FROM notifications WHERE user_id = $1"
    )
    args: list = [user.id]
    if unread_only:
        sql += " AND read_at IS NULL"
    args.append(limit)
    sql += f" ORDER BY created_at DESC LIMIT ${len(args)}"
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    out: list[Notification] = []
    for r in rows:
        ts = r["created_at"] if r["created_at"].tzinfo else r["created_at"].replace(tzinfo=UTC)
        out.append(Notification(
            id=r["id"], kind=r["kind"], payload=r["payload"] or {},
            read_at=(r["read_at"].astimezone(UTC).isoformat() if r["read_at"]
                     else None),
            created_at=ts.isoformat(),
        ))
    return out


class UnreadCount(BaseModel):
    unread: int


@router.get("/unread-count", response_model=UnreadCount)
async def unread_count(
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> UnreadCount:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        n = await conn.fetchval(
            "SELECT count(*) FROM notifications "
            "WHERE user_id = $1 AND read_at IS NULL",
            user.id,
        )
    return UnreadCount(unread=int(n or 0))


@router.post("/mark-all-read")
async def mark_all_read(
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, int]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        n = await conn.fetchval(
            "WITH up AS (UPDATE notifications SET read_at = now() "
            "WHERE user_id = $1 AND read_at IS NULL RETURNING 1) "
            "SELECT count(*) FROM up",
            user.id,
        )
    return {"marked": int(n or 0)}
