"""TheSportsDB client — free fixtures + scores feed.

Uses the public free API key ("3"). Per-league filtering is unreliable on the
free tier but every event payload includes `idLeague` and `strLeague`, so we
fetch a broad set and filter ourselves to our 5 supported leagues.

API docs: https://www.thesportsdb.com/api.php
"""

from __future__ import annotations

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

# League IDs we'll poll. Free key tends to return mixed events regardless,
# but we make a couple of distinct calls to widen the pool.
POLL_LEAGUE_IDS = [4328, 4329, 4396, 4397, 4330]


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


def _parse_event(raw: dict) -> Event | None:
    """Convert a TheSportsDB event payload into our normalised shape.

    Returns None if the event isn't in one of our 5 supported leagues or
    the timestamp is unparseable.
    """
    raw_league = raw.get("strLeague") or ""
    league = LEAGUE_MAP.get(raw_league)
    if not league:
        return None

    ts = raw.get("strTimestamp") or ""
    if not ts:
        return None
    try:
        kickoff = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if kickoff.tzinfo is None:
            kickoff = kickoff.replace(tzinfo=UTC)
    except ValueError:
        return None

    raw_status = raw.get("strStatus") or "Not Started"
    status = _STATUS_MAP.get(raw_status, "SCHEDULED")
    # If kickoff was over 2 hours ago and TheSportsDB still says "Not Started",
    # don't trust their status — defer; the in-app scheduler advances states.

    home_score = _safe_int(raw.get("intHomeScore"))
    away_score = _safe_int(raw.get("intAwayScore"))

    return Event(
        external_id=str(raw.get("idEvent") or ""),
        league=league,
        competition=raw_league,
        home_team_name=(raw.get("strHomeTeam") or "").strip(),
        away_team_name=(raw.get("strAwayTeam") or "").strip(),
        home_team_external_id=str(raw.get("idHomeTeam")) if raw.get("idHomeTeam") else None,
        away_team_external_id=str(raw.get("idAwayTeam")) if raw.get("idAwayTeam") else None,
        kickoff_at=kickoff,
        status=status,
        home_score=home_score,
        away_score=away_score,
    )


def _safe_int(v: object) -> int | None:
    if v in (None, "", "null"):
        return None
    try:
        return int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


async def fetch_upcoming(client: httpx.AsyncClient) -> list[Event]:
    """Pull upcoming + recent past fixtures across our 5 leagues, deduped."""
    seen: dict[str, Event] = {}
    for lid in POLL_LEAGUE_IDS:
        for endpoint in ("eventsnextleague.php", "eventspastleague.php"):
            try:
                r = await client.get(f"{BASE}/{endpoint}", params={"id": lid}, timeout=10)
                r.raise_for_status()
                payload = r.json() or {}
            except Exception:
                log.exception("sportsdb_fetch_failed", extra={"endpoint": endpoint, "lid": lid})
                continue
            for raw in (payload.get("events") or []):
                e = _parse_event(raw)
                if e and e.external_id and e.external_id not in seen:
                    seen[e.external_id] = e
    return list(seen.values())


async def lookup_event(client: httpx.AsyncClient, external_id: str) -> Event | None:
    """Get current state of a single event — used to poll LIVE fixtures."""
    try:
        r = await client.get(f"{BASE}/lookupevent.php", params={"id": external_id}, timeout=10)
        r.raise_for_status()
        payload = r.json() or {}
    except Exception:
        log.exception("sportsdb_lookup_failed", extra={"external_id": external_id})
        return None
    events = payload.get("events") or []
    if not events:
        return None
    return _parse_event(events[0])
