from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from ..auth import CurrentUser, get_current_user

router = APIRouter(prefix="/battles", tags=["battles"])

BattleStatus = Literal["PENDING", "ACTIVE", "CLOSED", "EXPIRED"]


class UserRef(BaseModel):
    id: str
    handle: str
    avatar_seed: str | None = None
    team_id: str | None = None
    team_slug: str | None = None
    team_name: str | None = None


class BattleOut(BaseModel):
    id: str
    challenger: UserRef
    opponent: UserRef
    topic: str | None
    status: BattleStatus
    challenger_votes: int
    opponent_votes: int
    winner_id: str | None
    expires_at: str
    created_at: str
    your_vote: str | None = None  # the user_id you voted for
    message_count: int = 0


class BattleMessage(BaseModel):
    id: str
    user_id: str
    handle: str
    text: str
    created_at: str


class CreateBattle(BaseModel):
    opponent_handle: str = Field(min_length=3, max_length=20)
    topic: str | None = Field(default=None, max_length=200)


class CreateBattleMessage(BaseModel):
    text: str = Field(min_length=1, max_length=400)


class VoteRequest(BaseModel):
    vote_for_user_id: str  # must be challenger or opponent id


_BATTLE_SQL = """
SELECT
  b.id::text                AS id,
  b.topic, b.status, b.challenger_votes, b.opponent_votes,
  b.winner_id::text         AS winner_id,
  b.expires_at, b.created_at,
  c.id::text                AS c_id,
  c.handle                  AS c_handle,
  c.avatar_seed             AS c_avatar_seed,
  c.team_id::text           AS c_team_id,
  ct.slug                   AS c_team_slug,
  ct.name                   AS c_team_name,
  o.id::text                AS o_id,
  o.handle                  AS o_handle,
  o.avatar_seed             AS o_avatar_seed,
  o.team_id::text           AS o_team_id,
  ot.slug                   AS o_team_slug,
  ot.name                   AS o_team_name,
  (SELECT voted_for::text FROM battle_votes WHERE battle_id = b.id AND user_id = $1)
                            AS your_vote,
  (SELECT count(*) FROM battle_messages WHERE battle_id = b.id)
                            AS message_count
FROM battles b
JOIN users c ON c.id = b.challenger_id
JOIN users o ON o.id = b.opponent_id
LEFT JOIN teams ct ON ct.id = c.team_id
LEFT JOIN teams ot ON ot.id = o.team_id
"""


def _battle_from_row(row) -> BattleOut:  # noqa: ANN001
    return BattleOut(
        id=row["id"],
        topic=row["topic"],
        status=row["status"],
        challenger_votes=row["challenger_votes"],
        opponent_votes=row["opponent_votes"],
        winner_id=row["winner_id"],
        expires_at=(row["expires_at"] if row["expires_at"].tzinfo
                    else row["expires_at"].replace(tzinfo=UTC)).isoformat(),
        created_at=(row["created_at"] if row["created_at"].tzinfo
                    else row["created_at"].replace(tzinfo=UTC)).isoformat(),
        your_vote=row["your_vote"],
        message_count=row["message_count"],
        challenger=UserRef(
            id=row["c_id"], handle=row["c_handle"], avatar_seed=row["c_avatar_seed"],
            team_id=row["c_team_id"], team_slug=row["c_team_slug"], team_name=row["c_team_name"],
        ),
        opponent=UserRef(
            id=row["o_id"], handle=row["o_handle"], avatar_seed=row["o_avatar_seed"],
            team_id=row["o_team_id"], team_slug=row["o_team_slug"], team_name=row["o_team_name"],
        ),
    )


@router.get("", response_model=list[BattleOut])
async def list_battles(
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    status_filter: BattleStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[BattleOut]:
    pool = request.app.state.pool
    sql = _BATTLE_SQL
    args: list = [user.id]
    if status_filter:
        args.append(status_filter)
        sql += f" WHERE b.status = ${len(args)}"
    args.append(limit)
    sql += f" ORDER BY b.created_at DESC LIMIT ${len(args)}"
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    return [_battle_from_row(r) for r in rows]


@router.get("/{battle_id}", response_model=BattleOut)
async def get_battle(
    battle_id: str,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> BattleOut:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(_BATTLE_SQL + " WHERE b.id = $2", user.id, battle_id)
    if not row:
        raise HTTPException(404, "Battle not found")
    return _battle_from_row(row)


@router.post("", response_model=BattleOut, status_code=status.HTTP_201_CREATED)
async def create_battle(
    body: CreateBattle,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> BattleOut:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        opp = await conn.fetchrow(
            "SELECT id::text FROM users WHERE handle = $1 AND deleted_at IS NULL "
            "AND is_suspended = false",
            body.opponent_handle.upper(),
        )
        if not opp:
            raise HTTPException(404, f"User @{body.opponent_handle} not found")
        if opp["id"] == user.id:
            raise HTTPException(400, "Cannot challenge yourself")

        expires = datetime.now(UTC) + timedelta(hours=48)
        new_id = await conn.fetchval(
            "INSERT INTO battles (challenger_id, opponent_id, topic, status, expires_at) "
            "VALUES ($1, $2, $3, 'ACTIVE', $4) RETURNING id::text",
            user.id, opp["id"], body.topic, expires,
        )
        row = await conn.fetchrow(_BATTLE_SQL + " WHERE b.id = $2", user.id, new_id)
    assert row is not None
    return _battle_from_row(row)


@router.get("/{battle_id}/messages", response_model=list[BattleMessage])
async def list_messages(battle_id: str, request: Request) -> list[BattleMessage]:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT bm.id::text, bm.user_id::text, u.handle, bm.text, bm.created_at "
            "FROM battle_messages bm JOIN users u ON u.id = bm.user_id "
            "WHERE bm.battle_id = $1 ORDER BY bm.created_at ASC",
            battle_id,
        )
    return [
        BattleMessage(
            id=r["id"], user_id=r["user_id"], handle=r["handle"], text=r["text"],
            created_at=(r["created_at"] if r["created_at"].tzinfo
                        else r["created_at"].replace(tzinfo=UTC)).isoformat(),
        )
        for r in rows
    ]


@router.post("/{battle_id}/messages", response_model=BattleMessage,
             status_code=status.HTTP_201_CREATED)
async def post_message(
    battle_id: str,
    body: CreateBattleMessage,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> BattleMessage:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        battle = await conn.fetchrow(
            "SELECT challenger_id, opponent_id, status FROM battles WHERE id = $1",
            battle_id,
        )
        if not battle:
            raise HTTPException(404, "Battle not found")
        if battle["status"] != "ACTIVE":
            raise HTTPException(400, "Battle is not active")
        if user.id not in (str(battle["challenger_id"]), str(battle["opponent_id"])):
            raise HTTPException(403, "Only the two combatants can post in this battle")
        row = await conn.fetchrow(
            "INSERT INTO battle_messages (battle_id, user_id, text) "
            "VALUES ($1, $2, $3) RETURNING id::text, user_id::text, text, created_at",
            battle_id, user.id, body.text,
        )
        handle = await conn.fetchval("SELECT handle FROM users WHERE id = $1", user.id)
    return BattleMessage(
        id=row["id"], user_id=row["user_id"], handle=handle, text=row["text"],
        created_at=(row["created_at"] if row["created_at"].tzinfo
                    else row["created_at"].replace(tzinfo=UTC)).isoformat(),
    )


@router.post("/{battle_id}/vote", response_model=BattleOut)
async def vote_battle(
    battle_id: str,
    body: VoteRequest,
    request: Request,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> BattleOut:
    pool = request.app.state.pool
    async with pool.acquire() as conn, conn.transaction():
        battle = await conn.fetchrow(
            "SELECT challenger_id::text, opponent_id::text, status "
            "FROM battles WHERE id = $1",
            battle_id,
        )
        if not battle:
            raise HTTPException(404, "Battle not found")
        if battle["status"] != "ACTIVE":
            raise HTTPException(400, "Voting is closed")
        if body.vote_for_user_id not in (battle["challenger_id"], battle["opponent_id"]):
            raise HTTPException(400, "Vote must be for one of the two combatants")
        if user.id in (battle["challenger_id"], battle["opponent_id"]):
            raise HTTPException(400, "Combatants cannot vote in their own battle")

        existing = await conn.fetchrow(
            "SELECT voted_for::text FROM battle_votes "
            "WHERE battle_id = $1 AND user_id = $2",
            battle_id, user.id,
        )
        if existing and existing["voted_for"] == body.vote_for_user_id:
            pass  # idempotent
        elif existing:
            # Switch vote
            await conn.execute(
                "UPDATE battle_votes SET voted_for = $1 WHERE battle_id = $2 AND user_id = $3",
                body.vote_for_user_id, battle_id, user.id,
            )
            # Recompute counts
            await _recompute_counts(conn, battle_id)
        else:
            await conn.execute(
                "INSERT INTO battle_votes (battle_id, user_id, voted_for) VALUES ($1, $2, $3)",
                battle_id, user.id, body.vote_for_user_id,
            )
            await _recompute_counts(conn, battle_id)

        row = await conn.fetchrow(_BATTLE_SQL + " WHERE b.id = $2", user.id, battle_id)
    assert row is not None
    return _battle_from_row(row)


async def _recompute_counts(conn, battle_id: str) -> None:  # noqa: ANN001
    await conn.execute(
        """
        UPDATE battles SET
          challenger_votes = (SELECT count(*) FROM battle_votes
                                WHERE battle_id = $1 AND voted_for = battles.challenger_id),
          opponent_votes   = (SELECT count(*) FROM battle_votes
                                WHERE battle_id = $1 AND voted_for = battles.opponent_id)
        WHERE id = $1
        """,
        battle_id,
    )
