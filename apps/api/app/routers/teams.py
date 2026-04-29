from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/teams", tags=["teams"])


class Team(BaseModel):
    id: str
    slug: str
    name: str
    short_name: str = Field(alias="short_name")
    city: str
    country: str
    league: str
    sport: str
    primary_color: str
    secondary_color: str
    founded_year: int | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


@router.get("", response_model=list[Team])
async def list_teams(request: Request, league: str | None = None) -> list[Team]:
    pool = request.app.state.pool
    sql = (
        "SELECT id::text, slug, name, short_name, city, country, league, sport, "
        "primary_color, secondary_color, founded_year FROM teams"
    )
    args: list = []
    if league:
        sql += " WHERE league = $1"
        args.append(league)
    sql += " ORDER BY league, name"
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    return [Team(**dict(r)) for r in rows]


@router.get("/{slug}", response_model=Team)
async def get_team(request: Request, slug: str) -> Team:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id::text, slug, name, short_name, city, country, league, sport, "
            "primary_color, secondary_color, founded_year "
            "FROM teams WHERE slug = $1",
            slug,
        )
    if not row:
        raise HTTPException(404, "Team not found")
    return Team(**dict(row))
