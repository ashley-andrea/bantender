"""HTTP API. The estimator's only input is the tender PDF; reference data stays server-side."""

from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from app.config import get_settings
from pydantic import BaseModel

from app.offer.build import build_offer
from app.offer.pdf_fill import fill_offer
from app.parsing.pipeline import PARSER_VERSION, parse_tender, tender_to_dict
from app.pricing.service import price_tender
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
        _parse_and_store(tender_id, file.filename)
    return {"tender_id": tender_id, **summary(tender_id)}


def _parse_and_store(tender_id: str, filename: str | None) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        pdf = Path(tmp) / "tender.pdf"
        pdf.write_bytes(storage.get(f"tenders/{tender_id}/tender.pdf"))
        tender, meta = parse_tender(pdf)
    meta["filename"] = filename
    parsed = tender_to_dict(tender, meta)
    storage.put(f"tenders/{tender_id}/parsed.json", json.dumps(parsed, ensure_ascii=False).encode())
    return parsed


def _load(tender_id: str) -> dict:
    key = f"tenders/{tender_id}/parsed.json"
    if not tender_id.isalnum() or not storage.exists(key):
        raise HTTPException(404, "Unknown tender")
    parsed = json.loads(storage.get(key))
    if parsed["meta"].get("parser_version") != PARSER_VERSION:
        # Parser improved since this tender was stored: re-parse the stored PDF (line ids are stable, overrides survive).
        parsed = _parse_and_store(tender_id, parsed["meta"].get("filename"))
    return parsed


def summary(tender_id: str) -> dict:
    parsed = _load(tender_id)
    return {
        "filename": parsed["meta"].get("filename"),
        "pages": parsed["meta"]["pages"],
        "project": parsed.get("project", {}),
        "systems": parsed["systems"],
        "lines": len(parsed["lines"]),
        "anomalies": len(parsed["anomalies"]),
    }


@app.get("/api/tenders")
def list_tenders() -> list[dict]:
    root = settings.data_dir / "files" / "tenders"
    if not root.exists():
        return []
    items = []
    for path in sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if (path / "parsed.json").exists():
            items.append({"tender_id": path.name, **summary(path.name)})
    return items


@app.get("/api/tenders/{tender_id}")
def get_tender(tender_id: str) -> dict:
    return _load(tender_id)


@app.get("/api/tenders/{tender_id}/pdf")
def get_pdf(tender_id: str) -> Response:
    _load(tender_id)
    return Response(storage.get(f"tenders/{tender_id}/tender.pdf"), media_type="application/pdf")


# ---- pricing, overrides, settings ---------------------------------------------------------------

USER = "estimator"  # dev auth; Entra ID in production


def _get_json(key: str, default):
    return json.loads(storage.get(key)) if storage.exists(key) else default


def _put_json(key: str, value) -> None:
    storage.put(key, json.dumps(value, ensure_ascii=False).encode())


def _audit(tender_id: str, entry: dict) -> None:
    key = f"tenders/{tender_id}/audit.json"
    log = _get_json(key, [])
    log.append({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "by": USER, **entry})
    _put_json(key, log)


def _pricing(tender_id: str) -> dict:
    parsed = _load(tender_id)
    overrides = _get_json(f"tenders/{tender_id}/overrides.json", {})
    settings_ = _get_json(f"tenders/{tender_id}/settings.json", {})
    result = price_tender(parsed, reference, overrides, settings_)
    result["anomalies"] = parsed["anomalies"]
    result["tender"] = {"project": parsed.get("project", {}), "lots": parsed.get("lots", {}),
                        "systems": parsed["systems"], "award": parsed.get("award")}
    result["reference_version"] = reference.version
    return result


@app.get("/api/tenders/{tender_id}/pricing")
def get_pricing(tender_id: str) -> dict:
    return _pricing(tender_id)


class LineOverride(BaseModel):
    quantity: float | None = None
    unit_price: float | None = None  # net unit price, e.g. from a supplier quote
    unit_price_source: str | None = None  # estimator_input | quote
    note: str | None = None


@app.patch("/api/tenders/{tender_id}/lines/{line_id}")
def override_line(tender_id: str, line_id: str, body: LineOverride) -> dict:
    _load(tender_id)
    key = f"tenders/{tender_id}/overrides.json"
    overrides = _get_json(key, {})
    old = overrides.get(line_id, {})
    new = {**old, **body.model_dump(exclude_none=True)}
    overrides[line_id] = new
    _put_json(key, overrides)
    _audit(tender_id, {"line_id": line_id, "action": "override", "before": old, "after": new})
    return _pricing(tender_id)


@app.delete("/api/tenders/{tender_id}/lines/{line_id}/override")
def reset_line(tender_id: str, line_id: str) -> dict:
    key = f"tenders/{tender_id}/overrides.json"
    overrides = _get_json(key, {})
    old = overrides.pop(line_id, None)
    _put_json(key, overrides)
    _audit(tender_id, {"line_id": line_id, "action": "reset", "before": old})
    return _pricing(tender_id)


@app.patch("/api/tenders/{tender_id}/settings")
def update_settings(tender_id: str, body: dict) -> dict:
    _load(tender_id)
    allowed = {"factors", "allowances", "project_costs", "overhead_pct", "margin_pct", "risk_allowance_chf", "include_project_costs",
               "include_small_material", "include_supplier_contingency", "include_cad_ductwork", "locations",
               "discount_pct", "cash_discount_pct"}
    if set(body) - allowed:
        raise HTTPException(400, f"Unknown settings: {sorted(set(body) - allowed)}")
    key = f"tenders/{tender_id}/settings.json"
    old = _get_json(key, {})
    new = {**old, **body}
    _put_json(key, new)
    _audit(tender_id, {"action": "settings", "before": old, "after": new})
    return _pricing(tender_id)


@app.get("/api/tenders/{tender_id}/audit")
def get_audit(tender_id: str) -> list[dict]:
    _load(tender_id)
    return list(reversed(_get_json(f"tenders/{tender_id}/audit.json", [])))


@app.get("/api/catalog/{product_id}")
def catalog_context(product_id: str) -> dict:
    """The matched catalogue row, its neighbours in the same family, and its productivity rule (for the catalogue step)."""
    item = reference.catalog.get(product_id)
    if not item:
        raise HTTPException(404, "Unknown product")
    family = [i.model_dump() for i in reference.catalog.values() if i.subcategory == item.subcategory and i.category == item.category]
    rule = reference.rules.get(item.install_code)
    return {"item": item.model_dump(), "family": family[:12], "rule": rule.model_dump() if rule else None,
            "reference_version": reference.version}


# ---- offer: the numbers for the tender's own form, and the filled PDF ---------------------------

def _offer(tender_id: str) -> tuple[dict, dict, dict]:
    parsed = _load(tender_id)
    pricing = _pricing(tender_id)
    settings_ = _get_json(f"tenders/{tender_id}/settings.json", {})
    return parsed, pricing, build_offer(parsed, pricing, settings_)


@app.get("/api/tenders/{tender_id}/offer")
def get_offer(tender_id: str) -> dict:
    parsed, _, offer = _offer(tender_id)
    _, fields = fill_offer(storage.get(f"tenders/{tender_id}/tender.pdf"), parsed, offer)
    return {**offer, "fields": fields}


@app.get("/api/tenders/{tender_id}/offer.pdf")
def get_offer_pdf(tender_id: str, download: bool = False) -> Response:
    parsed, _, offer = _offer(tender_id)
    data, _ = fill_offer(storage.get(f"tenders/{tender_id}/tender.pdf"), parsed, offer)
    name = f"Offer_{(parsed['meta'].get('filename') or tender_id).removesuffix('.pdf')}.pdf"
    disposition = "attachment" if download else "inline"
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'{disposition}; filename="{name}"'})
