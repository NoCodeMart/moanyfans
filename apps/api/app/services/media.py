"""Image upload pipeline.

Validates input, strips EXIF, resizes, transcodes to webp, writes to disk under
MEDIA_DIR. Returns a relative path that the API serves under /media/.

Defensive choices:
- Magic-byte sniff via Pillow.open before trusting the client mime
- Hard size + dimension caps before any pixel work (no decompression bombs)
- Random UUID filename, sharded by first 2 chars (avoids huge flat dirs)
- EXIF stripped (privacy + consistency)
- Output is always webp at q=82, max 1600px on the long edge
"""
from __future__ import annotations

import io
import os
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError

MEDIA_DIR = Path(os.environ.get("MEDIA_DIR", "/app/media"))
MAX_BYTES = 8 * 1024 * 1024  # 8 MB raw upload cap
MAX_PIXELS = 40_000_000  # 40 MP, blocks decompression bombs
MAX_LONG_EDGE = 1600
ALLOWED_INPUT_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@dataclass
class StoredMedia:
    path: str  # relative, e.g. "ab/abcd-...-uuid.webp"
    width: int
    height: int
    mime: str  # always image/webp post-processing


def _ensure_dir() -> None:
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)


async def store_upload(file: UploadFile) -> StoredMedia:
    if (file.content_type or "").lower() not in ALLOWED_INPUT_MIMES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            "Only JPEG/PNG/WEBP/GIF are accepted.")

    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            "Image too large (max 8 MB).")
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty upload.")

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(raw)) as img:
            img.verify()  # cheap structural check
    except (UnidentifiedImageError, Image.DecompressionBombError, Exception) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Could not decode image.") from exc

    # verify() leaves the image unusable; reopen for the actual work
    with Image.open(io.BytesIO(raw)) as img:
        img = ImageOps.exif_transpose(img)  # honour EXIF rotation, then drop
        if img.mode in ("P", "PA"):
            img = img.convert("RGBA")
        if img.mode == "CMYK":
            img = img.convert("RGB")
        # Flatten transparency onto a paper-coloured background so webp stays small
        if img.mode in ("RGBA", "LA"):
            bg = Image.new("RGB", img.size, (251, 248, 235))
            bg.paste(img, mask=img.split()[-1])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")

        img.thumbnail((MAX_LONG_EDGE, MAX_LONG_EDGE), Image.LANCZOS)

        out = io.BytesIO()
        img.save(out, format="WEBP", quality=82, method=6)
        data = out.getvalue()
        width, height = img.size

    file_id = uuid.uuid4().hex
    shard = file_id[:2]
    rel_path = f"{shard}/{file_id}.webp"

    _ensure_dir()
    target = MEDIA_DIR / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    # write atomically — temp + rename — so partial writes never get served
    tmp = target.with_suffix(".webp.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, target)

    return StoredMedia(path=rel_path, width=width, height=height, mime="image/webp")
