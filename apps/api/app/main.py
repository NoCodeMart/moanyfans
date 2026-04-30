import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import lifespan
from .routers import (
    battles, fixtures, health, me, moans, notifications, search, seo, share,
    tags, teams, users,
)

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
