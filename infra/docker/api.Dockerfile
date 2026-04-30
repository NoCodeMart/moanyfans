FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY apps/api/pyproject.toml ./
RUN pip install fastapi 'uvicorn[standard]' asyncpg 'pydantic>=2.9' \
    'pydantic-settings>=2.6' python-dotenv httpx redis 'anthropic>=0.40' structlog \
    'pyjwt[crypto]>=2.10' 'Pillow>=11.0' 'jinja2>=3.1' 'python-multipart>=0.0.20'

# Persistent media volume mount target. The Coolify side must map a named
# volume here so user uploads survive deploys.
RUN mkdir -p /app/media
VOLUME ["/app/media"]
ENV MEDIA_DIR=/app/media

COPY apps/api/app ./app

# Templates and font/image assets
ENV WEB_PUBLIC_BASE=https://moanyfans.77-68-52-69.sslip.io \
    API_PUBLIC_BASE=https://api.moanyfans.77-68-52-69.sslip.io

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
