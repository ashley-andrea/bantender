"""API smoke test: upload → parse → fetch."""

import importlib

import pytest
from fastapi.testclient import TestClient

from .conftest import TENDER_PDF


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    mp = pytest.MonkeyPatch()
    mp.setenv("DATA_DIR", str(tmp_path_factory.mktemp("data")))
    from app import config
    config.get_settings.cache_clear()
    import app.api.main as main
    importlib.reload(main)
    yield TestClient(main.app)
    mp.undo()
    config.get_settings.cache_clear()


def test_health_and_reference(client):
    assert client.get("/api/healthz").json()["status"] == "ok"
    ref = client.get("/api/reference").json()
    assert ref["catalog_items"] == 56 and ref["productivity_rules"] == 22


def test_upload_parse_and_fetch(client):
    r = client.post("/api/tenders", files={"file": ("tender.pdf", TENDER_PDF.read_bytes(), "application/pdf")})
    assert r.status_code == 200
    body = r.json()
    assert body["lines"] >= 240 and set(body["systems"]) == {"244.01", "244.02", "244.03", "244.04", "244.05", "244.06"}
    parsed = client.get(f"/api/tenders/{body['tender_id']}").json()
    assert parsed["lines"][0]["page"] >= 67 and parsed["lines"][0]["row_bbox"]
    assert client.get(f"/api/tenders/{body['tender_id']}/pdf").content.startswith(b"%PDF")
    first = next(l for l in parsed["lines"] if l["page"] == 78 and l["quantity"] == 5)
    assert first["size_key"] == "DN100"
    assert [t["tender_id"] for t in client.get("/api/tenders").json()] == [body["tender_id"]]


def test_rejects_non_pdf(client):
    assert client.post("/api/tenders", files={"file": ("x.txt", b"hello", "text/plain")}).status_code == 400


def test_pricing_override_settings_and_audit(client):
    tid = client.get("/api/tenders").json()[0]["tender_id"]
    base = client.get(f"/api/tenders/{tid}/pricing").json()
    assert base["project"]["selling_price"] > 0 and base["summary"]["priced_lines"] > 100
    target = next(r for r in base["lines"] if r["decision"]["status"] == "review_required" and not r["cost"])
    edited = client.patch(f"/api/tenders/{tid}/lines/{target['line_id']}", json={"unit_price": 250, "note": "list price"}).json()
    assert edited["project"]["selling_price"] >= base["project"]["selling_price"]
    assert client.patch(f"/api/tenders/{tid}/lines/x", json={"product_id": "NOPE"}).status_code == 400
    lower = client.patch(f"/api/tenders/{tid}/settings", json={"margin_pct": 2.5}).json()
    assert lower["settings"]["margin_pct"] == 2.5
    audit = client.get(f"/api/tenders/{tid}/audit").json()
    assert [a["action"] for a in audit[:2]] == ["settings", "override"]
    reset = client.delete(f"/api/tenders/{tid}/lines/{target['line_id']}/override").json()
    assert next(r for r in reset["lines"] if r["line_id"] == target["line_id"])["cost"] is None
    assert client.get("/api/catalog/search", params={"q": "silencer"}).json()
