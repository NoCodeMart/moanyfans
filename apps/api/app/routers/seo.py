"""SEO permalinks: AI match recaps + auto-generated rivalry pages.

  GET /recap/{fixture_id}              SSR HTML with OG meta
  GET /cards/recap/{fixture_id}.png    1200x630 OG card

  GET /r/{slug-vs-slug}                SSR HTML — evergreen rivalry page,
                                       indexable, links to live feeds.
  GET /cards/rivalry/{slug-vs-slug}.png

Rivalry pages are derived from the teams table on demand. With 104 clubs
that's 104×103/2 = 5,356 unique pages, all auto-rendered, all crawlable.
"""

from __future__ import annotations

import html

import asyncpg
from fastapi import APIRouter, HTTPException, Request, Response

from ..config import get_settings
from ..services.card_render import render_recap_card, render_rivalry_card

router = APIRouter(tags=["seo"])


# ── Recap permalink + card ──────────────────────────────────────────────────

_RECAP_SQL = """
SELECT f.id::text AS id, f.competition, f.kickoff_at,
       f.home_score, f.away_score,
       ht.short_name AS home_short, ht.name AS home_name,
       ht.primary_color AS home_primary,
       at.short_name AS away_short, at.name AS away_name,
       at.primary_color AS away_primary,
       r.headline, r.body, r.created_at
  FROM fixtures f
  JOIN teams ht ON ht.id = f.home_team_id
  JOIN teams at ON at.id = f.away_team_id
  JOIN match_recaps r ON r.fixture_id = f.id
 WHERE f.id = $1
"""


@router.get("/recap/{fixture_id}")
async def recap_permalink(fixture_id: str, request: Request) -> Response:
    settings = get_settings()
    pool: asyncpg.Pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(_RECAP_SQL, fixture_id)
    if not row:
        raise HTTPException(404, "Recap not found")
    score = f"{row['home_short']} {row['home_score']}–{row['away_score']} {row['away_short']}"
    title = f"{row['headline']} | Moanyfans"
    desc = row["body"][:200]
    canonical = f"{settings.api_public_base}/recap/{fixture_id}"
    spa_url = f"{settings.web_public_base}/?recap={fixture_id}"
    og_image = f"{settings.api_public_base}/cards/recap/{fixture_id}.png"
    body = _RECAP_HTML.format(
        title=html.escape(title),
        desc=html.escape(desc),
        canonical=canonical, spa_url=spa_url, og_image=og_image,
        score=html.escape(score),
        headline=html.escape(row["headline"]),
        recap_body=html.escape(row["body"]),
        comp=html.escape(row["competition"]),
        date=row["kickoff_at"].date().isoformat(),
    )
    return Response(content=body, media_type="text/html; charset=utf-8",
                    headers={"Cache-Control": "public, max-age=600"})


@router.get("/cards/recap/{fixture_id}.png")
async def recap_card(fixture_id: str, request: Request) -> Response:
    pool: asyncpg.Pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(_RECAP_SQL, fixture_id)
    if not row:
        raise HTTPException(404, "Recap not found")
    png = render_recap_card(
        headline=row["headline"],
        score_line=f"{row['home_short']} {row['home_score']}–{row['away_score']} {row['away_short']}",
        home_primary=row["home_primary"],
        away_primary=row["away_primary"],
    )
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400, s-maxage=86400"})


_RECAP_HTML = """<!DOCTYPE html>
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

<style>
  body {{ background:#f4ede0;color:#0a0908;font-family:Georgia,serif;
          margin:0;padding:48px 24px;line-height:1.5 }}
  .wrap {{ max-width:680px;margin:0 auto }}
  .stamp {{ display:inline-block;padding:6px 14px;background:#e63946;color:#f4ede0;
            font-family:Impact,'Anton',sans-serif;letter-spacing:.05em }}
  h1 {{ font-family:Impact,'Anton',sans-serif;font-size:48px;line-height:1.1;
        margin:18px 0 8px }}
  .score {{ font-size:24px;font-weight:700;margin:8px 0 24px }}
  .meta {{ color:#5a5048;font-size:14px;margin-bottom:24px }}
  a {{ color:#e63946 }}
  .cta {{ display:inline-block;margin-top:24px;padding:12px 22px;background:#0a0908;
          color:#f4ede0;text-decoration:none;font-family:Impact,'Anton',sans-serif;
          letter-spacing:.05em }}
</style>
</head><body><div class="wrap">
  <span class="stamp">MATCH RECAP</span>
  <h1>{headline}</h1>
  <div class="score">{score}</div>
  <div class="meta">{comp} · {date}</div>
  <p>{recap_body}</p>
  <a class="cta" href="{spa_url}">JOIN THE MOAN →</a>
</div></body></html>"""


# ── Rivalry pages ───────────────────────────────────────────────────────────

def _normalise_pair(slug_a: str, slug_b: str) -> tuple[str, str]:
    """Always return slugs alphabetically — prevents duplicate URLs."""
    return tuple(sorted([slug_a, slug_b]))  # type: ignore[return-value]


async def _load_rivalry(
    pool: asyncpg.Pool, slug_pair: str,
) -> tuple[asyncpg.Record, asyncpg.Record] | None:
    if "-vs-" not in slug_pair:
        return None
    a, b = slug_pair.split("-vs-", 1)
    a, b = _normalise_pair(a, b)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id::text, slug, name, short_name, city, league, "
            "primary_color, secondary_color FROM teams WHERE slug = ANY($1::text[])",
            [a, b],
        )
    if len(rows) != 2:
        return None
    by_slug = {r["slug"]: r for r in rows}
    return (by_slug[a], by_slug[b])


@router.get("/r/{slug_pair}")
async def rivalry_permalink(slug_pair: str, request: Request) -> Response:
    settings = get_settings()
    pool: asyncpg.Pool = request.app.state.pool
    pair = await _load_rivalry(pool, slug_pair)
    if not pair:
        raise HTTPException(404, "Rivalry not found")
    a, b = pair
    canonical_slug = f"{a['slug']}-vs-{b['slug']}"
    if canonical_slug != slug_pair:
        # Redirect to canonical alphabetical form
        return Response(
            status_code=301,
            headers={"Location": f"{settings.api_public_base}/r/{canonical_slug}"},
        )

    # Pull a few recent moans from either team for content
    async with pool.acquire() as conn:
        moans = await conn.fetch(
            """
            SELECT m.id::text AS id, m.text, m.kind, u.handle, t.short_name
              FROM moans m
              JOIN users u ON u.id = m.user_id
              JOIN teams t ON t.id = m.team_id
             WHERE m.deleted_at IS NULL AND m.status = 'PUBLISHED'
               AND m.team_id = ANY($1::uuid[])
             ORDER BY m.created_at DESC
             LIMIT 8
            """,
            [a["id"], b["id"]],
        )

    title = f"{a['short_name']} vs {b['short_name']} — UK Football Rivalry | Moanyfans"
    desc = (
        f"Live banter, moans and roasts between {a['name']} and {b['name']} fans. "
        f"{a['league']} / {b['league']}. Pick a side, run your mouth."
    )[:300]
    canonical = f"{settings.api_public_base}/r/{canonical_slug}"
    spa_url = f"{settings.web_public_base}/?rivalry={canonical_slug}"
    og_image = f"{settings.api_public_base}/cards/rivalry/{canonical_slug}.png"

    moan_html = "".join(
        f'<li><b>@{html.escape(m["handle"])}</b> '
        f'<span class="tag">{html.escape(m["short_name"] or "")}</span><br>'
        f'{html.escape(m["text"][:240])}</li>'
        for m in moans
    ) or "<li>No moans yet — be the first to start a war.</li>"

    body = _RIVALRY_HTML.format(
        title=html.escape(title),
        desc=html.escape(desc),
        canonical=canonical, spa_url=spa_url, og_image=og_image,
        a_name=html.escape(a["name"]), b_name=html.escape(b["name"]),
        a_short=html.escape(a["short_name"]), b_short=html.escape(b["short_name"]),
        a_league=html.escape(a["league"]), b_league=html.escape(b["league"]),
        a_city=html.escape(a["city"]), b_city=html.escape(b["city"]),
        moan_html=moan_html,
    )
    return Response(content=body, media_type="text/html; charset=utf-8",
                    headers={"Cache-Control": "public, max-age=300"})


@router.get("/cards/rivalry/{slug_pair}.png")
async def rivalry_card(slug_pair: str, request: Request) -> Response:
    pool: asyncpg.Pool = request.app.state.pool
    pair = await _load_rivalry(pool, slug_pair)
    if not pair:
        raise HTTPException(404, "Rivalry not found")
    a, b = pair
    png = render_rivalry_card(
        home_short=a["short_name"], away_short=b["short_name"],
        home_primary=a["primary_color"], away_primary=b["primary_color"],
    )
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=604800, s-maxage=604800"})


_RIVALRY_HTML = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canonical}">

<meta property="og:type" content="website">
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

<style>
  body {{ background:#f4ede0;color:#0a0908;font-family:Georgia,serif;
          margin:0;padding:0;line-height:1.5 }}
  .hero {{ display:grid;grid-template-columns:1fr 1fr;text-align:center;
           font-family:Impact,'Anton',sans-serif;color:#f4ede0;letter-spacing:.04em }}
  .hero > div {{ padding:64px 24px;font-size:64px }}
  .hero .a {{ background:#0a0908 }}
  .hero .b {{ background:#e63946 }}
  .wrap {{ max-width:760px;margin:0 auto;padding:48px 24px }}
  h1 {{ font-family:Impact,'Anton',sans-serif;font-size:36px;line-height:1.1;
        margin:0 0 16px }}
  ul {{ list-style:none;padding:0 }}
  li {{ background:#fff;border-left:4px solid #e63946;padding:14px 18px;margin:12px 0;
        border-radius:4px }}
  .tag {{ display:inline-block;background:#0a0908;color:#f4ede0;font-size:12px;
          padding:2px 8px;letter-spacing:.05em }}
  .cta {{ display:inline-block;margin-top:24px;padding:14px 26px;background:#e63946;
          color:#f4ede0;text-decoration:none;font-family:Impact,'Anton',sans-serif;
          letter-spacing:.05em;font-size:18px }}
  .meta {{ color:#5a5048;font-size:14px;margin-bottom:16px }}
</style>
</head><body>
<div class="hero">
  <div class="a">{a_short}</div>
  <div class="b">{b_short}</div>
</div>
<div class="wrap">
  <h1>{a_name} vs {b_name}</h1>
  <div class="meta">{a_city} ({a_league}) vs {b_city} ({b_league})</div>
  <p>The Moanyfans rivalry feed: every roast, moan, COPE and ratio between these two
  fan bases, in one place. Tap in, pick a side, give the other lot what they deserve.</p>
  <h2>Recent moans</h2>
  <ul>{moan_html}</ul>
  <a class="cta" href="{spa_url}">OPEN RIVALRY FEED →</a>
</div>
</body></html>"""
