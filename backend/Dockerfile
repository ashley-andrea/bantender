FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_COMPILE_BYTECODE_TIMEOUT=600 UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH" DATA_DIR=/data REFERENCE_DIR=/reference/v2
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
RUN useradd --create-home appuser && mkdir -p /data /app && chown appuser /data /app
WORKDIR /app
COPY --chown=appuser:appuser pyproject.toml uv.lock ./


# API image: deterministic pipeline only (PyMuPDF), small and fast to start.
FROM base AS api
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --extra winprob --no-install-project
COPY --chown=appuser:appuser backend/app ./app
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
