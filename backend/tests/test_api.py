"""API smoke test: upload → parse → fetch, with Docling off for speed."""

import importlib

import pytest
from fastapi.testclient import TestClient

from .conftest import TENDER_PDF


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    mp = pytest.MonkeyPatch()
    mp.setenv("DATA_DIR", str(tmp_path_factory.mktemp("data")))
    mp.setenv("DOCLING_TABLES", "false")
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


def test_rejects_non_pdf(client):
    assert client.post("/api/tenders", files={"file": ("x.txt", b"hello", "text/plain")}).status_code == 400
