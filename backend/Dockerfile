FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    DOCLING_ARTIFACTS_PATH=/opt/docling-models PATH="/app/.venv/bin:$PATH"
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home appuser && mkdir -p /data /app && chown appuser /data /app

WORKDIR /app
COPY --chown=appuser:appuser pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
# Bake Docling's layout and table models into the image: no model download at runtime.
RUN docling-tools models download layout tableformer -o /opt/docling-models

COPY --chown=appuser:appuser app ./app
USER appuser
ENV DATA_DIR=/data REFERENCE_DIR=/reference/v1
EXPOSE 8000
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
