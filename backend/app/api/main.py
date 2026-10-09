"""HTTP API. The estimator's only input is the tender PDF; reference data stays server-side."""

from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from app.config import get_settings
from app.parsing.pipeline import parse_tender, tender_to_dict
from app.reference import load_reference
from app.storage import make_storage

settings = get_settings()
storage = make_storage(settings.storage, settings.data_dir)
reference = load_reference(settings.reference_dir)

app = FastAPI(title="Tender Pricing API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


@app.get("/api/healthz")
def healthz() -> dict:
    return {"status": "ok", "environment": settings.environment, "reference_version": reference.version}


@app.get("/api/reference")
def reference_summary() -> dict:
    """Summary only: catalogue rows are served per match, never in bulk."""
    return {
        "version": reference.version,
        "catalog_items": len(reference.catalog),
        "productivity_rules": len(reference.rules),
        "parameters": reference.parameters.model_dump(),
    }


@app.post("/api/tenders")
async def upload_tender(file: UploadFile) -> dict:
    data = await file.read()
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "Please upload a PDF file.")
    tender_id = hashlib.sha256(data).hexdigest()[:16]
    result_key = f"tenders/{tender_id}/parsed.json"
    if not storage.exists(result_key):
        storage.put(f"tenders/{tender_id}/tender.pdf", data)
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "tender.pdf"
            pdf.write_bytes(data)
            tender, meta = parse_tender(pdf)
        meta["filename"] = file.filename
        storage.put(result_key, json.dumps(tender_to_dict(tender, meta), ensure_ascii=False).encode())
    return {"tender_id": tender_id, **summary(tender_id)}


def _load(tender_id: str) -> dict:
    key = f"tenders/{tender_id}/parsed.json"
    if not tender_id.isalnum() or not storage.exists(key):
        raise HTTPException(404, "Unknown tender")
    return json.loads(storage.get(key))


def summary(tender_id: str) -> dict:
    parsed = _load(tender_id)
    return {
        "filename": parsed["meta"].get("filename"),
        "pages": parsed["meta"]["pages"],
        "systems": parsed["systems"],
        "lines": len(parsed["lines"]),
        "anomalies": len(parsed["anomalies"]),
        "readers": {k: parsed["meta"][k] for k in ("lv_reader", "component_reader")},
    }


@app.get("/api/tenders/{tender_id}")
def get_tender(tender_id: str) -> dict:
    return _load(tender_id)


@app.get("/api/tenders/{tender_id}/pdf")
def get_pdf(tender_id: str) -> Response:
    _load(tender_id)
    return Response(storage.get(f"tenders/{tender_id}/tender.pdf"), media_type="application/pdf")
