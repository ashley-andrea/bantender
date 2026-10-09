FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH" DATA_DIR=/data REFERENCE_DIR=/reference/v1
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
RUN useradd --create-home appuser && mkdir -p /data /app && chown appuser /data /app
WORKDIR /app
COPY --chown=appuser:appuser pyproject.toml uv.lock ./


# API image: deterministic pipeline only (PyMuPDF), small and fast to start.
FROM base AS api
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY --chown=appuser:appuser app ./app
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]


# Optional Docling cross-check image (layout + table models baked in, runs offline).
FROM base AS docling
ENV DOCLING_ARTIFACTS_PATH=/opt/docling-models HF_HUB_OFFLINE=1
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project --extra docling
RUN HF_HUB_OFFLINE=0 docling-tools models download layout tableformer -o /opt/docling-models
COPY --chown=appuser:appuser app ./app
USER appuser
ENTRYPOINT ["python", "-m", "app.cli"]
CMD ["crosscheck", "--all"]
