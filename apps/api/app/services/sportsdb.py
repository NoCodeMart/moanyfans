"""TheSportsDB client — free fixtures + scores feed.

Uses the public free API key ("3"). The `eventsnextleague.php` endpoint
ignores the league filter on the free key, so we use `eventsround.php` to
pull per-league per-round fixtures (which DOES filter properly).

Strategy:
  - Pull a sliding window of rounds (configured per league) every hour.
    That gives us all fixtures + scores for the active part of each season.
  - Lookup individual events by id every 30s for live polling.

API docs: https://www.thesportsdb.com/api.php
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

log = logging.getLogger(__name__)

API_KEY = "3"
BASE = f"https://www.thesportsdb.com/api/v1/json/{API_KEY}"

# Map TheSportsDB league strings → our `teams.league` values.
LEAGUE_MAP = {
    "English Premier League":       "Premier League",
    "English League Championship":  "Championship",
    "English League 1":             "League One",
    "English League 2":             "League Two",
    "Scottish Premiership":         "Scottish Premiership",
}

# League IDs + how many rounds to scan. Most English leagues are 38-46 rounds.
# We scan the whole season so a freshly deployed instance backfills everything;
# the upserts are idempotent and TheSportsDB caches well.
LEAGUES = [
    {"id": 4328, "name": "Premier League",        "rounds": 38},
    {"id": 4329, "name": "Championship",          "rounds": 46},
    {"id": 4396, "name": "League One",            "rounds": 46},
    {"id": 4397, "name": "League Two",            "rounds": 46},
    {"id": 4330, "name": "Scottish Premiership",  "rounds": 38},
]

DEFAULT_SEASON = "2025-2026"


# Some clubs use slightly different names in TheSportsDB vs our seed data.
# Map TheSportsDB → our canonical name. Apply before name lookup.
TEAM_NAME_ALIASES: dict[str, str] = {
    "Brighton and Hove Albion": "Brighton & Hove Albion",
    "Manchester Utd":           "Manchester United",
    "Spurs":                    "Tottenham Hotspur",
    # Add more here when we hit unmapped team logs.
}


@dataclass
class Event:
    external_id: str
    league: str            # one of our LEAGUE_MAP values
    competition: str       # raw league name to display
    home_team_name: str
    away_team_name: str
    home_team_external_id: str | None
    away_team_external_id: str | None
    kickoff_at: datetime
    status: str            # "SCHEDULED" | "LIVE" | "FT"
    home_score: int | None
    away_score: int | None
    round: int | None


_STATUS_MAP = {
    "Not Started":     "SCHEDULED",
    "Match Finished":  "FT",
    "Match Postponed": "SCHEDULED",
    "Match Cancelled": "FT",
    "1st Half":        "LIVE",
    "Half Time":       "LIVE",
    "2nd Half":        "LIVE",
    "Extra Time":      "LIVE",
    "Penalties":       "LIVE",
}


def _normalise_team_name(name: str) -> str:
    return TEAM_NAME_ALIASES.get(name.strip(), name.strip())


def _parse_event(raw: dict) -> Event | None:
    raw_league = raw.get("strLeague") or ""
    league = LEAGUE_MAP.get(raw_league)
    if not league:
        return None

    ts = raw.get("strTimestamp") or ""
    if not ts:
        # Fall back to dateEvent + strTime for older entries
        date_s = raw.get("dateEvent")
        time_s = raw.get("strTime") or "15:00:00"
        if not date_s:
            return None
        ts = f"{date_s}T{time_s}"
    try:
        kickoff = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if kickoff.tzinfo is None:
            kickoff = kickoff.replace(tzinfo=UTC)
    except ValueError:
        return None

    raw_status = raw.get("strStatus") or "Not Started"
    status = _STATUS_MAP.get(raw_status, "SCHEDULED")

    return Event(
        external_id=str(raw.get("idEvent") or ""),
        league=league,
        competition=raw_league,
        home_team_name=_normalise_team_name(raw.get("strHomeTeam") or ""),
        away_team_name=_normalise_team_name(raw.get("strAwayTeam") or ""),
        home_team_external_id=str(raw.get("idHomeTeam")) if raw.get("idHomeTeam") else None,
        away_team_external_id=str(raw.get("idAwayTeam")) if raw.get("idAwayTeam") else None,
        kickoff_at=kickoff,
        status=status,
        home_score=_safe_int(raw.get("intHomeScore")),
        away_score=_safe_int(raw.get("intAwayScore")),
        round=_safe_int(raw.get("intRound")),
    )


def _safe_int(v: object) -> int | None:
    if v in (None, "", "null"):
        return None
    try:
        return int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


async def _fetch_round(
    client: httpx.AsyncClient, league_id: int, round_n: int, season: str,
) -> list[Event]:
    try:
        r = await client.get(
            f"{BASE}/eventsround.php",
            params={"id": league_id, "r": round_n, "s": season},
            timeout=10,
        )
        r.raise_for_status()
        payload = r.json() or {}
    except Exception:
        log.exception(
            "sportsdb_round_failed",
            extra={"league_id": league_id, "round": round_n},
        )
        return []
    out: list[Event] = []
    for raw in (payload.get("events") or []):
        e = _parse_event(raw)
        if e and e.external_id:
            out.append(e)
    return out


async def fetch_season(
    client: httpx.AsyncClient, season: str = DEFAULT_SEASON,
) -> list[Event]:
    """Pull the full season per league, round by round."""
    seen: dict[str, Event] = {}
    for league in LEAGUES:
        for round_n in range(1, league["rounds"] + 1):
            events = await _fetch_round(client, league["id"], round_n, season)
            for e in events:
                seen.setdefault(e.external_id, e)
            # Be polite to a free API
            await asyncio.sleep(0.15)
    return list(seen.values())


async def lookup_event(client: httpx.AsyncClient, external_id: str) -> Event | None:
    """Get current state of a single event — used to poll LIVE fixtures."""
    try:
        r = await client.get(
            f"{BASE}/lookupevent.php",
            params={"id": external_id},
            timeout=10,
        )
        r.raise_for_status()
        payload = r.json() or {}
    except Exception:
        log.exception("sportsdb_lookup_failed", extra={"external_id": external_id})
        return None
    events = payload.get("events") or []
    if not events:
        return None
    return _parse_event(events[0])
