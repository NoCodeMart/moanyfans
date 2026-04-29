"""Tabloid-style PNG card renderer (1200×630, OG-image dimensions).

Uses Pillow to draw a tabloid-newspaper-ish moan card. No headless browser.

Layout (1200×630):
  ┌─────────────────────────────────────────────┐
  │ ▓▓▓ TEAM-COLOUR BAND ▓▓▓                    │  88px tall
  │ MOANY|FANS™  ·  @HANDLE              ROAST  │
  ├─────────────────────────────────────────────┤
  │                                             │
  │   <BIG MOAN HEADLINE TEXT, WRAPPED>         │
  │                                             │
  ├─────────────────────────────────────────────┤
  │  HA 12K   ✓ 3.4K   😭 88   ✕ 12     #TAGS   │  60px tall
  └─────────────────────────────────────────────┘
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CARD_W = 1200
CARD_H = 630
HEADER_H = 88
FOOTER_H = 80
PADDING = 56

CREAM = (244, 237, 224)
INK = (10, 9, 8)
WHITE = (255, 255, 255)

ASSETS = Path(__file__).resolve().parent.parent / "assets"
FONT_DISPLAY = str(ASSETS / "Anton-Regular.ttf")
FONT_BODY = str(ASSETS / "Archivo.ttf")
FONT_MONO = str(ASSETS / "JetBrainsMono.ttf")


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    s = hex_str.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def _wrap_lines(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int
) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for w in words:
        test = f"{current} {w}".strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)
    return lines


def _fit_font_size(
    draw: ImageDraw.ImageDraw,
    text: str,
    font_path: str,
    max_width: int,
    max_height: int,
    max_size: int = 88,
    min_size: int = 36,
) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """Pick the largest font size where the wrapped text fits the box."""
    for size in range(max_size, min_size - 1, -4):
        font = ImageFont.truetype(font_path, size)
        lines = _wrap_lines(draw, text, font, max_width)
        line_h = font.size * 1.15
        if line_h * len(lines) <= max_height:
            return font, lines
    font = ImageFont.truetype(font_path, min_size)
    return font, _wrap_lines(draw, text, font, max_width)


def _halftone_overlay(img: Image.Image, color: tuple[int, int, int], spacing: int = 8) -> None:
    """Stamp soft halftone dots onto img in-place — adds tabloid 'paper' texture."""
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(0, img.size[1], spacing):
        for x in range(0, img.size[0], spacing):
            od.ellipse([x, y, x + 1, y + 1], fill=(*color, 36))
    img.alpha_composite(overlay)


def render_moan_card(
    *,
    handle: str,
    text: str,
    kind: str,
    team_name: str | None,
    team_primary: str | None,
    team_secondary: str | None,
    laughs: int,
    agrees: int,
    cope: int,
    ratio: int,
    tags: list[str],
) -> bytes:
    img = Image.new("RGBA", (CARD_W, CARD_H), CREAM + (255,))
    draw = ImageDraw.Draw(img)

    primary_rgb = _hex_to_rgb(team_primary) if team_primary else INK
    secondary_rgb = _hex_to_rgb(team_secondary) if team_secondary else CREAM

    # Header band
    draw.rectangle([(0, 0), (CARD_W, HEADER_H)], fill=primary_rgb)
    _halftone_overlay(img.crop((0, 0, CARD_W, HEADER_H)), INK, spacing=6)

    # Wordmark — left
    wm_font = ImageFont.truetype(FONT_DISPLAY, 44)
    draw.text((PADDING, HEADER_H // 2 - 26), "MOANY", fill=secondary_rgb, font=wm_font)
    moany_w = draw.textlength("MOANY", font=wm_font)
    # Tabloid red FANS chip
    chip_x = PADDING + moany_w + 6
    chip_w = draw.textlength("FANS", font=wm_font) + 16
    draw.rectangle(
        [(chip_x, HEADER_H // 2 - 22), (chip_x + chip_w, HEADER_H // 2 + 26)],
        fill=(230, 57, 70),
    )
    draw.text((chip_x + 8, HEADER_H // 2 - 26), "FANS", fill=CREAM, font=wm_font)

    # Handle + team — centre/right of header
    handle_font = ImageFont.truetype(FONT_DISPLAY, 32)
    handle_text = f"@{handle}"
    if team_name:
        handle_text += f"  ·  {team_name}"
    handle_w = draw.textlength(handle_text, font=handle_font)
    draw.text(
        (CARD_W - PADDING - handle_w, HEADER_H // 2 - 18),
        handle_text,
        fill=secondary_rgb,
        font=handle_font,
    )

    # Kind stamp — top right corner overlap (rotated rectangle)
    kind_color = {
        "ROAST": (230, 57, 70),
        "COPE":  (58, 134, 255),
        "BANTER": (255, 190, 11),
        "MOAN": INK,
    }.get(kind, INK)
    stamp_font = ImageFont.truetype(FONT_DISPLAY, 28)
    stamp_text = kind
    stamp_w = draw.textlength(stamp_text, font=stamp_font)
    sx0, sy0 = CARD_W - 200, HEADER_H + 20
    sx1, sy1 = sx0 + stamp_w + 32, sy0 + 50
    draw.rectangle([(sx0, sy0), (sx1, sy1)], fill=kind_color)
    draw.text((sx0 + 16, sy0 + 8), stamp_text, fill=CREAM, font=stamp_font)

    # Body text — fit to box
    body_top = HEADER_H + 90
    body_bottom = CARD_H - FOOTER_H - 40
    body_font, lines = _fit_font_size(
        draw, text, FONT_DISPLAY,
        max_width=CARD_W - 2 * PADDING,
        max_height=body_bottom - body_top,
    )
    line_h = body_font.size * 1.1
    y = body_top
    for ln in lines:
        draw.text((PADDING, y), ln, fill=INK, font=body_font)
        y += int(line_h)

    # Footer separator
    draw.rectangle([(0, CARD_H - FOOTER_H), (CARD_W, CARD_H - FOOTER_H + 4)], fill=INK)

    # Reactions row
    react_font = ImageFont.truetype(FONT_DISPLAY, 30)
    mono_font = ImageFont.truetype(FONT_MONO, 18)
    pieces = [
        ("HA",    _fmt_count(laughs)),
        ("AGR",   _fmt_count(agrees)),
        ("COPE",  _fmt_count(cope)),
        ("RATIO", _fmt_count(ratio)),
    ]
    rx = PADDING
    ry = CARD_H - FOOTER_H + 24
    for label, count in pieces:
        chunk = f"{label} {count}"
        draw.text((rx, ry), chunk, fill=INK, font=react_font)
        rx += int(draw.textlength(chunk, font=react_font)) + 36

    # Tags — right side of footer
    if tags:
        tag_text = "  ".join(tags[:3])
        tag_w = draw.textlength(tag_text, font=mono_font)
        draw.text(
            (CARD_W - PADDING - tag_w, ry + 8),
            tag_text,
            fill=(230, 57, 70),
            font=mono_font,
        )

    # URL / brand stamp — bottom right corner
    domain_font = ImageFont.truetype(FONT_MONO, 14)
    draw.text(
        (CARD_W - PADDING - 130, CARD_H - 24),
        "MOANYFANS.COM",
        fill=INK,
        font=domain_font,
    )

    out = io.BytesIO()
    img.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()


def _fmt_count(n: int) -> str:
    if n >= 1000:
        v = n / 1000.0
        return f"{v:.1f}K".replace(".0K", "K")
    return str(n)


def _draw_header(
    img: Image.Image, draw: ImageDraw.ImageDraw,
    primary_rgb: tuple[int, int, int], secondary_rgb: tuple[int, int, int],
    right_text: str,
) -> None:
    draw.rectangle([(0, 0), (CARD_W, HEADER_H)], fill=primary_rgb)
    _halftone_overlay(img.crop((0, 0, CARD_W, HEADER_H)), INK, spacing=6)
    wm_font = ImageFont.truetype(FONT_DISPLAY, 44)
    draw.text((PADDING, HEADER_H // 2 - 26), "MOANY", fill=secondary_rgb, font=wm_font)
    moany_w = draw.textlength("MOANY", font=wm_font)
    chip_x = PADDING + moany_w + 6
    chip_w = draw.textlength("FANS", font=wm_font) + 16
    draw.rectangle(
        [(chip_x, HEADER_H // 2 - 22), (chip_x + chip_w, HEADER_H // 2 + 26)],
        fill=(230, 57, 70),
    )
    draw.text((chip_x + 8, HEADER_H // 2 - 26), "FANS", fill=CREAM, font=wm_font)
    if right_text:
        right_font = ImageFont.truetype(FONT_DISPLAY, 32)
        rw = draw.textlength(right_text, font=right_font)
        draw.text(
            (CARD_W - PADDING - rw, HEADER_H // 2 - 18),
            right_text, fill=secondary_rgb, font=right_font,
        )


def render_recap_card(
    *, headline: str, score_line: str,
    home_primary: str | None, away_primary: str | None,
) -> bytes:
    img = Image.new("RGBA", (CARD_W, CARD_H), CREAM + (255,))
    draw = ImageDraw.Draw(img)
    home_rgb = _hex_to_rgb(home_primary) if home_primary else INK
    away_rgb = _hex_to_rgb(away_primary) if away_primary else INK
    # Split header: home colour left half, away colour right half
    draw.rectangle([(0, 0), (CARD_W // 2, HEADER_H)], fill=home_rgb)
    draw.rectangle([(CARD_W // 2, 0), (CARD_W, HEADER_H)], fill=away_rgb)
    _halftone_overlay(img.crop((0, 0, CARD_W, HEADER_H)), INK, spacing=6)
    wm_font = ImageFont.truetype(FONT_DISPLAY, 40)
    draw.text((PADDING, HEADER_H // 2 - 22), "MOANYFANS · MATCH RECAP",
              fill=CREAM, font=wm_font)

    # Score line
    score_font = ImageFont.truetype(FONT_DISPLAY, 56)
    sw = draw.textlength(score_line, font=score_font)
    draw.text(((CARD_W - sw) // 2, HEADER_H + 40), score_line, fill=INK, font=score_font)

    # Headline
    body_top = HEADER_H + 130
    body_bottom = CARD_H - 60
    body_font, lines = _fit_font_size(
        draw, headline, FONT_DISPLAY,
        max_width=CARD_W - 2 * PADDING,
        max_height=body_bottom - body_top,
        max_size=84, min_size=40,
    )
    line_h = body_font.size * 1.1
    y = body_top
    for ln in lines:
        lw = draw.textlength(ln, font=body_font)
        draw.text(((CARD_W - lw) // 2, y), ln, fill=INK, font=body_font)
        y += int(line_h)

    domain_font = ImageFont.truetype(FONT_MONO, 14)
    draw.text(
        (CARD_W - PADDING - 130, CARD_H - 24),
        "MOANYFANS.COM", fill=INK, font=domain_font,
    )
    out = io.BytesIO()
    img.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()


def render_rivalry_card(
    *, home_short: str, away_short: str,
    home_primary: str | None, away_primary: str | None,
) -> bytes:
    img = Image.new("RGBA", (CARD_W, CARD_H), CREAM + (255,))
    draw = ImageDraw.Draw(img)
    home_rgb = _hex_to_rgb(home_primary) if home_primary else INK
    away_rgb = _hex_to_rgb(away_primary) if away_primary else INK
    # Big diagonal split
    draw.rectangle([(0, 0), (CARD_W // 2, CARD_H)], fill=home_rgb)
    draw.rectangle([(CARD_W // 2, 0), (CARD_W, CARD_H)], fill=away_rgb)
    _halftone_overlay(img, INK, spacing=10)

    title_font = ImageFont.truetype(FONT_DISPLAY, 180)
    vs_font = ImageFont.truetype(FONT_DISPLAY, 100)
    draw.text((PADDING, CARD_H // 2 - 90),
              home_short.upper(), fill=CREAM, font=title_font)
    away_w = draw.textlength(away_short.upper(), font=title_font)
    draw.text((CARD_W - PADDING - away_w, CARD_H // 2 - 90),
              away_short.upper(), fill=CREAM, font=title_font)
    vs_w = draw.textlength("VS", font=vs_font)
    # Red chip behind VS
    cx = CARD_W // 2
    cy = CARD_H // 2
    draw.rectangle([(cx - vs_w // 2 - 16, cy - 50), (cx + vs_w // 2 + 16, cy + 50)],
                   fill=(230, 57, 70))
    draw.text((cx - vs_w // 2, cy - 56), "VS", fill=CREAM, font=vs_font)

    foot_font = ImageFont.truetype(FONT_MONO, 22)
    foot = "MOANYFANS · UK FOOTBALL RIVALRY"
    fw = draw.textlength(foot, font=foot_font)
    draw.text(((CARD_W - fw) // 2, CARD_H - 50), foot, fill=CREAM, font=foot_font)

    out = io.BytesIO()
    img.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()
