"""Win model in the system: startup, fallbacks, tender context, win_curve in the pricing result (plan §7, §10, §11)."""

import importlib
import json

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.pricing.service import price_tender

from .conftest import REFERENCE_DIR, SAMPLE_DIR, TENDER_PDF

pytest.importorskip("sklearn")

from app.winprob.service import WinService  # noqa: E402

CONTEXT = SAMPLE_DIR / "tender_context.json"
PARSED = {"project": {"name": "SH Erlenstrasse Oberglatt", "bkp": "244"}, "award": {"weight": 60.0, "zero_at_ratio": 1.5},
          "lots": {"1": {}, "2": {}}}


@pytest.fixture(scope="module")
def service(ref):
    return WinService(REFERENCE_DIR, ref.parameters, CONTEXT)


def test_learned_model_is_used_and_summarised(service):
    assert service.kind == "ml" and service.reason is None
    s = service.summary()
    assert s["monotone"] and s["metrics"]["ml"]["log_loss"] < s["metrics"]["placeholder"]["log_loss"]
    assert {d["feature"] for d in s["importance"]} >= {"price_position", "canton", "bkp_trade"}


def test_context_sources(service):
    values, sources = service.context(PARSED, {"win_context": {"n_bidders": 3}})
    assert values["bkp_trade"] == "244" and sources["bkp_trade"] == "tender"
    assert values["building_type"] == "school" and sources["building_type"] == "tender"  # "SH" = Schulhaus
    assert (values["price_weight_pct"], values["n_lots"]) == (60.0, 2)
    assert sources["competitive_intensity"] == "market_snapshot"
    assert sources["market_reference_chf"] == "demo_fixture"
    assert values["n_bidders"] == 3 and sources["n_bidders"] == "estimator"


def test_curve_block(service):
    c = service.curve(2_325_198.0, 2_461_000.0, PARSED, {})
    assert c["model"] == "ml" and len(c["points"]) == 201
    p = [pt["win_probability"] for pt in c["points"]]
    assert all(a >= b for a, b in zip(p, p[1:]))
    names = [s["name"] for s in c["scenarios"]]
    offers = [s["offer"] for s in c["scenarios"]]
    assert names == ["Aggressive", "Target", "Conservative"] and offers == sorted(offers)
    assert all(s["margin_pct"] >= 1.9 and s["offer"] % 1000 == 0 for s in c["scenarios"])
    assert c["current"]["p_low"] <= c["current"]["win_probability"] <= c["current"]["p_high"]
    assert c["explanation"] and json.dumps(c)  # JSON-safe


def test_missing_client_estimate_uses_flagged_fallback(ref, tmp_path):
    ctx = json.loads(CONTEXT.read_text())
    ctx.pop("market_reference_chf")
    (tmp_path / "ctx.json").write_text(json.dumps(ctx))
    c = WinService(REFERENCE_DIR, ref.parameters, tmp_path / "ctx.json").curve(1_000_000.0, 1_060_000.0, PARSED, {})
    assert c["market_reference_source"] == "target_margin_fallback"
    assert c["market_reference_chf"] == pytest.approx(1_000_000 / (1 - ref.parameters.commercial.target_margin_pct / 100))


@pytest.mark.parametrize("why", ["forced", "no_history"])
def test_placeholder_fallback(ref, tmp_path, why):
    ref_dir = REFERENCE_DIR if why == "forced" else tmp_path
    svc = WinService(ref_dir, ref.parameters, CONTEXT, mode="placeholder" if why == "forced" else "ml")
    assert svc.kind == "placeholder" and svc.reason
    c = svc.curve(1_000_000.0, 1_060_000.0, PARSED, {})
    assert c["model"] == "placeholder" and len(c["points"]) == 201 and c["explanation"] == []


def test_override_validation(service):
    service.check_override({"n_bidders": 4})
    with pytest.raises(ValueError, match="Unknown"):
        service.check_override({"bidders": 4})


def test_pricing_result_carries_the_curve(ref, service):
    parsed = {**PARSED, "lines": [], "systems": {}, "anomalies": [], "component_rows": []}
    assert "win_curve" not in price_tender(parsed, ref, {}, {})  # without the hook: unchanged result
    assert price_tender(parsed, ref, {}, {}, win=service.curve)["win_curve"]["model"] == "ml"


def test_api_routes_the_curve(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    import app.api.main as main
    importlib.reload(main)
    client = TestClient(main.app)
    try:
        assert client.get("/api/win-model").json()["model"] == "ml"
        tid = client.post("/api/tenders", files={"file": ("t.pdf", TENDER_PDF.read_bytes(), "application/pdf")}).json()["tender_id"]
        wc = client.get(f"/api/tenders/{tid}/pricing").json()["win_curve"]
        assert wc["model"] == "ml" and wc["context"]["building_type"] == "school"
        edited = client.patch(f"/api/tenders/{tid}/settings", json={"win_context": {"n_bidders": 2}}).json()
        assert edited["win_curve"]["sources"]["n_bidders"] == "estimator"
        assert edited["win_curve"]["current"]["win_probability"] > wc["current"]["win_probability"]  # fewer bidders
        assert client.patch(f"/api/tenders/{tid}/settings", json={"win_context": {"nope": 1}}).status_code == 400
        moved = client.patch(f"/api/tenders/{tid}/settings", json={"margin_pct": wc["scenarios"][1]["margin_pct"]}).json()
        assert moved["project"]["selling_price"] == wc["scenarios"][1]["offer"]  # a scenario can be applied as the offer
    finally:
        get_settings.cache_clear()


def test_shap_values_are_exact_and_follow_the_offer(service):
    import math

    c = service.curve(2_325_198.0, 2_461_000.0, PARSED, {})
    shap = c["shap"]
    from app.winprob.schema import FEATURES

    assert set(shap["fixed"]) | {k.removeprefix("shap_") for k in shap["per_point"]} == set(FEATURES)
    for pt in c["points"][::20]:
        logit = shap["base"] + sum(shap["fixed"].values()) + sum(pt[k] for k in shap["per_point"])
        assert 1 / (1 + math.exp(-logit)) == pytest.approx(pt["win_probability"], abs=1e-5)  # base + Σ SHAP = model
    first, last = c["points"][0], c["points"][-1]
    assert last["shap_price_position_x_sensitivity"] < first["shap_price_position_x_sensitivity"]  # dearer offer, lower


def test_placeholder_has_no_shap(ref):
    svc = WinService(REFERENCE_DIR, ref.parameters, CONTEXT, mode="placeholder")
    assert svc.curve(1_000_000.0, 1_060_000.0, PARSED, {})["shap"] is None
