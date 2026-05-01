"""Username (handle) policy.

Three layers of protection so randoms can't grab high-value names:

  1. **Format rules** — length, allowed chars, no leading digit, no double `__`.
  2. **Hard-blocked** — slurs and impersonation patterns. Never available.
  3. **Reserved** — celebrity / club / player names. Held back at signup;
     can be released later via admin console (e.g. when a real KLOPP wants
     in, or we want to give them away as a promo).

Validation is centralised so signup, handle change, and admin grants all use
the same rules.
"""
from __future__ import annotations

import asyncpg

# ── Format ─────────────────────────────────────────────────────────────────

HANDLE_MIN = 3
HANDLE_MAX = 20
_VALID_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")


def normalise(handle: str) -> str:
    return handle.strip().upper()


def format_error(handle: str) -> str | None:
    h = normalise(handle)
    if not h:
        return "Handle is required."
    if len(h) < HANDLE_MIN:
        return f"Handle must be at least {HANDLE_MIN} characters."
    if len(h) > HANDLE_MAX:
        return f"Handle must be at most {HANDLE_MAX} characters."
    if h[0].isdigit():
        return "Handle can't start with a digit."
    if "__" in h:
        return "Handle can't contain consecutive underscores."
    if any(c not in _VALID_CHARS for c in h):
        return "Handle can only use letters, numbers, and underscores."
    return None


# ── Hard-blocked (impersonation, system, slurs) ────────────────────────────
# Never available, ever. All comparisons happen in upper-case.

_BLOCKED_IMPERSONATION = {
    # System / role
    "ADMIN", "ADMINS", "ADMINISTRATOR", "MOD", "MODS", "MODERATOR",
    "SUPPORT", "HELP", "STAFF", "TEAM", "OWNER", "ROOT", "SYSTEM",
    "OFFICIAL", "INFO", "CONTACT", "ABOUT", "LEGAL", "PRIVACY", "TERMS",
    "API", "WWW", "MAIL", "EMAIL", "SECURITY", "ABUSE", "POSTMASTER",
    "WEBMASTER", "HOSTMASTER", "BOT", "TEST", "NULL", "UNDEFINED",
    "ANONYMOUS", "ANON", "USER", "USERS", "GUEST", "GUEST_TESTER",
    # Brand
    "MOANYFANS", "MOANY", "MOANYFAN", "FANS", "MOANYFANS_OFFICIAL",
}

# House persona handles — owned by us, used by the seeder.
_BLOCKED_HOUSE = {
    "TERRACE_TOM", "THE_GAFFER", "PUNDIT_PETE", "HOT_TAKE_HARRY",
    "RAGE_RANKER", "HOUSE", "HOUSE_BOT",
}

# Slurs — kept short and obvious here. Real slur defence happens in the
# moderation pass, this just stops the most overt as handles.
_BLOCKED_SLURS = {
    "NIGGER", "NIGGA", "FAGGOT", "TRANNY", "RETARD", "KIKE", "SPIC",
    "CHINK", "PAKI", "WETBACK", "GOOK", "COON", "DYKE",
}

HARD_BLOCKED: frozenset[str] = frozenset(
    _BLOCKED_IMPERSONATION | _BLOCKED_HOUSE | _BLOCKED_SLURS
)


# ── Reserved (high-value, releasable later) ────────────────────────────────
# Football clubs, top players, managers, pundits, presenters. Stored in the
# `reserved_handles` DB table so the admin console can release them later.

# Premier League clubs + nicknames + short forms
RESERVED_CLUBS = [
    "ARSENAL", "GUNNERS", "AFC",
    "ASTON_VILLA", "VILLA", "AVFC", "UTV",
    "BOURNEMOUTH", "AFCB", "CHERRIES",
    "BRENTFORD", "BEES",
    "BRIGHTON", "SEAGULLS", "BHA",
    "CHELSEA", "CFC", "BLUES",
    "CRYSTAL_PALACE", "PALACE", "CPFC", "EAGLES",
    "EVERTON", "EFC", "TOFFEES",
    "FULHAM", "FFC", "COTTAGERS",
    "IPSWICH", "ITFC", "TRACTOR_BOYS",
    "LEICESTER", "LCFC", "FOXES",
    "LIVERPOOL", "LFC", "REDS",
    "MAN_CITY", "MCFC", "CITIZENS",
    "MAN_UNITED", "MUFC", "MAN_UTD", "RED_DEVILS", "UNITED",
    "NEWCASTLE", "NUFC", "MAGPIES", "TOON",
    "NOTTINGHAM_FOREST", "NFFC", "FOREST",
    "SOUTHAMPTON", "SAINTS", "SFC",
    "SPURS", "TOTTENHAM", "THFC", "COYS",
    "WEST_HAM", "WHU", "HAMMERS", "IRONS",
    "WOLVES", "WWFC",
    # Scottish big two
    "CELTIC", "CFC_SCOT", "BHOYS",
    "RANGERS", "RFC", "GERS",
    # English big-league heritage
    "LEEDS", "LUFC",
    "WEDNESDAY", "SWFC",
    "SUNDERLAND", "SAFC", "MACKEMS",
    "BIRMINGHAM", "BCFC", "BLUES_BIRM",
    "BLACKBURN", "ROVERS",
]

# Top managers (live + recent)
RESERVED_MANAGERS = [
    "GUARDIOLA", "PEP", "ARTETA", "KLOPP", "TENHAG", "POCH",
    "POSTECOGLOU", "ANGE", "DECHAMPS", "SOUTHGATE", "TUCHEL",
    "MOURINHO", "JOSE", "ANCELOTTI", "ALONSO", "AMORIM",
    "FERGUSON", "FERGIE", "WENGER", "MOYES", "DYCHE", "EMERY",
    "HOWE", "MARESCA", "VAN_NISTELROOY", "RODGERS", "BIELSA",
    "CONTE", "LAMPARD", "GERRARD", "BENITEZ", "ALLARDYCE",
]

# Top current players + a handful of icons (no surnames-only that are also
# common English words like "Cole" or "King" — fine to keep first-name forms
# where the player is iconic enough).
RESERVED_PLAYERS = [
    # Current PL stars
    "HAALAND", "SALAH", "SAKA", "ODEGAARD", "RICE", "BELLINGHAM",
    "FODEN", "DEBRUYNE", "KDB", "PALMER", "MBEUMO", "WATKINS",
    "ISAK", "GORDON", "MAINOO", "GARNACHO", "RASHFORD", "FERNANDES",
    "BRUNO", "MAGUIRE", "ONANA", "SON", "MADDISON", "VAN_DIJK",
    "VVD", "ALISSON", "NUNEZ", "SZOBOSZLAI", "MAC_ALLISTER",
    "DIAZ", "LUIS_DIAZ", "TRENT", "TAA", "ROBERTSON",
    "JACKSON", "FOFANA", "ENZO", "CAICEDO", "COLWILL", "JAMES",
    "RAYA", "MARTINELLI", "TROSSARD", "GABRIEL", "WHITE", "ZINCHENKO",
    "TIMBER", "HAVERTZ", "JESUS", "TOMIYASU",
    "GUEHI", "EZE", "OLISE", "MATETA",
    "CUNHA", "AIT_NOURI",
    # Iconic
    "MESSI", "RONALDO", "CR7", "MARADONA", "PELE", "ZIDANE",
    "BECKHAM", "GIGGS", "SCHOLES", "KEANE", "CANTONA", "ROONEY",
    "GERRARD", "HENRY", "BERGKAMP", "SHEARER", "DROGBA", "TERRY",
    "LAMPARD", "MBAPPE", "NEYMAR", "MODRIC", "KROOS", "RAMOS",
    "PIQUE", "INIESTA", "XAVI", "BUFFON", "MALDINI", "ZLATAN",
    "IBRAHIMOVIC", "MULLER", "NEUER",
]

# Pundits / presenters / commentators
RESERVED_PUNDITS = [
    "LINEKER", "GARY_LINEKER", "SHEARER", "WRIGHT", "IAN_WRIGHT",
    "RICHARDS", "MICAH", "CARRAGHER", "JAMIE_CARRAGHER", "NEVILLE",
    "GARY_NEVILLE", "PHIL_NEVILLE", "SOUNESS", "REDKNAPP", "SAVAGE",
    "ROBBIE_SAVAGE", "MERSON", "OWEN", "MICHAEL_OWEN", "DURHAM",
    "ADRIAN_DURHAM", "JORDAN", "SIMON_JORDAN", "TYLDESLEY",
    "MARTIN_TYLER", "TYLER", "HUTTON", "FOWLER", "ROBBIE_FOWLER",
    "HENDO", "HENDERSON", "JAMES_RICHARDSON", "GARY_DANIELS",
    "MOTD", "MATCH_OF_THE_DAY", "TALKSPORT", "SKY_SPORTS", "BBC_SPORT",
]


def all_reserved() -> set[str]:
    return set(
        RESERVED_CLUBS + RESERVED_MANAGERS + RESERVED_PLAYERS + RESERVED_PUNDITS
    )


# ── Validation against DB ──────────────────────────────────────────────────

async def sync_reserved(conn: asyncpg.Connection) -> int:
    """Upsert the in-code reserved list into the DB.
    Doesn't re-reserve handles that have already been released.
    Returns the number of new rows inserted.
    """
    inserted = 0
    by_cat = (
        ("club", RESERVED_CLUBS),
        ("manager", RESERVED_MANAGERS),
        ("player", RESERVED_PLAYERS),
        ("pundit", RESERVED_PUNDITS),
    )
    for category, names in by_cat:
        for name in names:
            handle_lc = name.lower()
            n = await conn.execute(
                "INSERT INTO reserved_handles (handle_lc, category) "
                "VALUES ($1, $2) ON CONFLICT (handle_lc) DO NOTHING",
                handle_lc, category,
            )
            if n.endswith(" 1"):
                inserted += 1
    return inserted


async def availability_error(conn: asyncpg.Connection, handle: str) -> str | None:
    """Return None if the handle is available, otherwise a user-facing reason.
    Caller must already have run ``format_error``.
    """
    h = normalise(handle)
    if h in HARD_BLOCKED:
        return "That handle isn't allowed."
    reserved = await conn.fetchval(
        "SELECT 1 FROM reserved_handles WHERE handle_lc = lower($1) AND released_at IS NULL",
        h,
    )
    if reserved:
        return "That handle is reserved. Pick another."
    taken = await conn.fetchval(
        "SELECT 1 FROM users WHERE lower(handle) = lower($1)",
        h,
    )
    if taken:
        return "That handle is taken."
    return None
