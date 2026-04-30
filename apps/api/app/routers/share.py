"""Share machinery — OG image renders + permalink HTML pages.

URLs (mounted at root):
  GET  /cards/moan/{id}.png   → 1200x630 tabloid PNG, immutable cache
  GET  /m/{id}                → SSR HTML with full OG/Twitter meta + JS redirect
                                 to the SPA for human visitors. Crawlers (WhatsApp,
                                 Twitterbot, Facebook, Slack, Discord) read meta
                                 and render the unfurl card before the redirect.
  GET  /robots.txt
  GET  /sitemap.xml
"""

from __future__ import annotations

import html
from datetime import UTC, datetime, timedelta

import asyncpg
from fastapi import APIRouter, HTTPException, Request, Response

from ..config import get_settings
from ..services.card_render import render_moan_card

router = APIRouter(tags=["share"])


_MOAN_ROW_SQL = """
SELECT
  m.id::text         AS id,
  m.text, m.kind, m.status, m.created_at,
  m.laughs, m.agrees, m.cope, m.ratio,
  u.handle           AS user_handle,
  t.name             AS team_name,
  t.short_name       AS team_short_name,
  t.primary_color    AS team_primary,
  t.secondary_color  AS team_secondary,
  COALESCE(
    (SELECT array_agg('#'||tg.slug ORDER BY tg.use_count DESC) FROM moan_tags mt
       JOIN tags tg ON tg.id = mt.tag_id
      WHERE mt.moan_id = m.id),
    ARRAY[]::text[]
  ) AS tags
FROM moans m
JOIN users u  ON u.id = m.user_id
LEFT JOIN teams t ON t.id = m.team_id
WHERE m.id = $1 AND m.deleted_at IS NULL AND m.status = 'PUBLISHED'
"""


async def _fetch_moan(pool: asyncpg.Pool, moan_id: str) -> asyncpg.Record:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(_MOAN_ROW_SQL, moan_id)
    if not row:
        raise HTTPException(404, "Moan not found")
    return row


@router.get("/cards/moan/{moan_id}.png")
async def card_moan_png(moan_id: str, request: Request) -> Response:
    row = await _fetch_moan(request.app.state.pool, moan_id)
    png = render_moan_card(
        handle=row["user_handle"],
        text=row["text"],
        kind=row["kind"],
        team_name=row["team_name"],
        team_primary=row["team_primary"],
        team_secondary=row["team_secondary"],
        laughs=row["laughs"],
        agrees=row["agrees"],
        cope=row["cope"],
        ratio=row["ratio"],
        tags=list(row["tags"]),
    )
    return Response(
        content=png,
        media_type="image/png",
        headers={
            # Reactions can change — short cache, browsers will revalidate
            "Cache-Control": "public, max-age=300, s-maxage=300",
        },
    )


def _truncate(text: str, n: int = 200) -> str:
    if len(text) <= n:
        return text
    cut = text[: n - 1].rsplit(" ", 1)[0]
    return cut + "…"


@router.get("/m/{moan_id}")
async def moan_permalink(moan_id: str, request: Request) -> Response:
    settings = get_settings()
    row = await _fetch_moan(request.app.state.pool, moan_id)
    title_team = row["team_short_name"] or "FAN"
    kind_label = {
        "MOAN": "MOAN",
        "ROAST": "ROAST",
        "BANTER": "BANTER",
    }.get(row["kind"], "MOAN")
    title = f"@{row['user_handle']} · {kind_label} · {title_team} | Moanyfans"
    desc = _truncate(row["text"], 200)
    canonical = f"{settings.api_public_base}/m/{moan_id}"
    spa_url = f"{settings.web_public_base}/?m={moan_id}"
    og_image = f"{settings.api_public_base}/cards/moan/{moan_id}.png"

    body = _PERMALINK_HTML.format(
        title=html.escape(title),
        desc=html.escape(desc),
        canonical=canonical,
        spa_url=spa_url,
        og_image=og_image,
        text=html.escape(row["text"]),
        handle=html.escape(row["user_handle"]),
    )
    return Response(
        content=body,
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "public, max-age=120"},
    )


_PERMALINK_HTML = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canonical}">

<meta property="og:type" content="article">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{og_image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="{canonical}">
<meta property="og:site_name" content="Moanyfans">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{og_image}">

<meta http-equiv="refresh" content="0; url={spa_url}">
<style>
  body {{ background:#f4ede0;color:#0a0908;font-family:Georgia,serif;
          margin:0;padding:48px 24px;text-align:center }}
  .card {{ max-width:600px;margin:0 auto }}
  .stamp {{ display:inline-block;padding:6px 14px;background:#e63946;color:#f4ede0;
            font-family:'Anton',sans-serif;letter-spacing:.05em }}
  .quote {{ font-size:24px;line-height:1.3;margin:24px 0;font-weight:700 }}
  a {{ color:#e63946 }}
</style>
</head><body>
<div class="card">
  <span class="stamp">MOANYFANS</span>
  <p class="quote">"{text}"</p>
  <p>— @{handle}</p>
  <p><a href="{spa_url}">Continue to Moanyfans →</a></p>
</div>
<script>setTimeout(function(){{location.replace("{spa_url}")}},50);</script>
</body></html>"""


@router.get("/robots.txt", include_in_schema=False)
async def robots() -> Response:
    settings = get_settings()
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /docs\n"
        "Disallow: /openapi.json\n"
        f"Sitemap: {settings.api_public_base}/sitemap.xml\n"
    )
    return Response(content=body, media_type="text/plain")


@router.get("/sitemap.xml", include_in_schema=False)
async def sitemap(request: Request) -> Response:
    settings = get_settings()
    pool = request.app.state.pool
    cutoff = datetime.now(UTC) - timedelta(days=180)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id::text AS id, GREATEST(updated_at, created_at) AS lastmod
              FROM moans
             WHERE deleted_at IS NULL
               AND status = 'PUBLISHED'
               AND parent_moan_id IS NULL
               AND created_at >= $1
             ORDER BY created_at DESC
             LIMIT 5000
            """,
            cutoff,
        )
        team_rows = await conn.fetch("SELECT slug FROM teams ORDER BY league, name")
        recap_rows = await conn.fetch(
            "SELECT fixture_id::text AS id, created_at FROM match_recaps "
            "ORDER BY created_at DESC LIMIT 2000",
        )

    parts = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    parts.append(f"<url><loc>{settings.web_public_base}/</loc><priority>1.0</priority></url>")
    for t in team_rows:
        parts.append(
            f"<url><loc>{settings.web_public_base}/?team={t['slug']}</loc>"
            f"<priority>0.7</priority></url>"
        )

    # Rivalry pages — every unique alphabetical pair (5,356 for 104 clubs).
    slugs = [t["slug"] for t in team_rows]
    for i in range(len(slugs)):
        for j in range(i + 1, len(slugs)):
            a, b = sorted([slugs[i], slugs[j]])
            parts.append(
                f"<url><loc>{settings.api_public_base}/r/{a}-vs-{b}</loc>"
                f"<priority>0.5</priority></url>"
            )

    for r in recap_rows:
        parts.append(
            f"<url><loc>{settings.api_public_base}/recap/{r['id']}</loc>"
            f"<lastmod>{r['created_at'].date().isoformat()}</lastmod>"
            f"<priority>0.7</priority></url>"
        )
    for r in rows:
        parts.append(
            f"<url><loc>{settings.api_public_base}/m/{r['id']}</loc>"
            f"<lastmod>{r['lastmod'].date().isoformat()}</lastmod>"
            f"<priority>0.6</priority></url>"
        )
    parts.append("</urlset>")
    return Response(content="\n".join(parts), media_type="application/xml")
