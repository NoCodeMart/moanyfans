import mimetypes

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# python-slim ships an incomplete mime map — without this, StaticFiles serves
# our user-uploaded webp images as text/plain and browsers refuse to render them.
mimetypes.add_type("image/webp", ".webp")

from .config import get_settings
from .db import lifespan
from .routers import (
    admin, auth, battles, fixtures, health, me, media, moans, notifications, push, search, seo,
    share, tags, teams, users, waitlist,
)
from .services.media import MEDIA_DIR

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
)
log = structlog.get_logger()

settings = get_settings()

app = FastAPI(
    title="Moanyfans API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# CSRF mitigation — refuse state-changing requests whose Origin header isn't
# in our allowlist. The CORS middleware blocks browser-initiated cross-origin
# requests, but a cookie-bearing request from a malicious page submitted via
# <form> bypasses CORS entirely. Origin-checking on the server-side closes
# that gap.
_ALLOWED_ORIGINS = set(settings.cors_origins)
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    if request.method not in _SAFE_METHODS:
        origin = request.headers.get("origin")
        # Server-to-server / curl traffic has no Origin — let it through.
        # Browser traffic always sends Origin on POST/PUT/DELETE/PATCH.
        if origin and origin not in _ALLOWED_ORIGINS:
            return JSONResponse(status_code=403,
                                content={"detail": "Cross-origin request rejected"})
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Strict-Transport-Security", "max-age=31536000; includeSubDomains",
    )
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled_error", path=request.url.path, method=request.method)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(health.router)
app.include_router(teams.router)
app.include_router(me.router)
app.include_router(moans.router)
app.include_router(tags.router)
app.include_router(share.router)
app.include_router(fixtures.router)
app.include_router(battles.router)
app.include_router(seo.router)
app.include_router(users.router)
app.include_router(notifications.router)
app.include_router(search.router)
app.include_router(media.router)
app.include_router(push.router)
app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(waitlist.router)

# Serve uploaded images. The directory lives outside the source tree (Docker volume)
# so deploys don't blow user content away.
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
from fastapi.staticfiles import StaticFiles  # noqa: E402
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")


@app.middleware("http")
async def security_headers(request: Request, call_next):  # noqa: ANN001
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Permissions-Policy",
        "geolocation=(), microphone=(), camera=(), payment=()")
    return response


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": "moanyfans-api", "version": "0.1.0", "docs": "/docs"}
