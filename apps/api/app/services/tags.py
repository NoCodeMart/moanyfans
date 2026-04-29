"""Tag extraction + upsert."""

from __future__ import annotations

import re

import asyncpg

# #LIKE_THIS — uppercase letters + digits + underscore, 2-32 chars after the #
_TAG_RE = re.compile(r"#([A-Za-z0-9_]{2,32})")


def extract_tags(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for m in _TAG_RE.finditer(text):
        slug = m.group(1).upper()
        if slug not in seen:
            seen.add(slug)
            out.append(slug)
    return out


async def upsert_tags(conn: asyncpg.Connection, slugs: list[str]) -> list[asyncpg.Record]:
    if not slugs:
        return []
    rows = await conn.fetch(
        """
        INSERT INTO tags (slug, display, use_count, last_seen)
        SELECT slug, '#' || slug, 1, now()
          FROM unnest($1::text[]) AS slug
        ON CONFLICT (slug) DO UPDATE
          SET use_count = tags.use_count + 1, last_seen = now()
        RETURNING id, slug
        """,
        slugs,
    )
    return rows


async def attach_tags_to_moan(
    conn: asyncpg.Connection, moan_id: str, tag_records: list[asyncpg.Record]
) -> None:
    if not tag_records:
        return
    await conn.executemany(
        "INSERT INTO moan_tags (moan_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [(moan_id, r["id"]) for r in tag_records],
    )
