"""M6–M7: matching, statuses and full-tender pricing."""

from collections import Counter

import pytest

from app.matching.matcher import decide_all
from app.parsing.evaluate import evaluate
from app.parsing.pipeline import parse_tender, tender_to_dict
from app.pricing.service import price_tender

from .conftest import TENDER_PDF


@pytest.fixture(scope="module")
def parsed():
    tender, meta = parse_tender(TENDER_PDF)
    return tender, tender_to_dict(tender, meta)


@pytest.fixture(scope="module")
def decisions(parsed, ref):
    return {d.line_id: d for d in decide_all(parsed[1]["lines"], ref)}


def test_golden_products_and_statuses(parsed, decisions, examples, golden):
    tender, _ = parsed
    ev = evaluate(tender.lines, examples)
    expected = {g["lv_id"]: g for g in golden["position_results"]}
    for e, r in zip(examples, ev["details"]):
        d = decisions[r["line_id"]]
        assert d.product_id == e["suggested_product_id"], e["lv_id"]
        assert d.status == e["ground_truth_status"], e["lv_id"]
        assert d.install_code == e["expected_install_code"], e["lv_id"]
        assert (d.band == "high") == (expected[e["lv_id"]]["match_confidence"] >= 0.9 or d.status == "supplier_quote_required"), e["lv_id"]


def test_every_line_is_classified_with_one_status(decisions):
    assert all(d.rule_key for d in decisions.values())
    assert set(Counter(d.status for d in decisions.values())) <= {
        "calculated", "supplier_quote_required", "assumption_applied", "review_required",
        "insufficient_information", "out_of_scope", "non_priceable"}


def test_install_only_field_devices_are_labour_only(decisions):
    devices = [d for d in decisions.values() if d.rule_key == "field_device_install"]
    assert len(devices) >= 15 and all(d.product_id is None and d.install_code == "CONTROL_POINT" for d in devices)


def test_air_handling_units_sized_by_airflow(decisions):
    ahus = {k: d.product_id for k, d in decisions.items() if d.rule_key == "ahu"}
    assert ahus["244.01-A-001"] == "P-AHU-1000"  # 700 m³/h
    assert ahus["244.02-A-001"] == "P-AHU-6200"  # 6`200 m³/h (backtick thousands separator)
    assert all(decisions[k].status == "supplier_quote_required" for k in ahus)


def test_nearest_size_only_within_tolerance(decisions):
    by_size = {d.line_id: d for d in decisions.values() if d.rule_key == "silencer_compact"}
    assert by_size["244.04-C-014"].status == "assumption_applied"  # DN125 → DN100 allowed
    assert by_size["244.04-C-016"].product_id is None  # DN200 is not priced as DN100


def test_project_costs_not_double_counted(decisions):
    covered = [d for d in decisions.values() if d.rule_key in ("hygiene", "commissioning", "installation_time", "installation_transport")]
    assert covered and all(d.status == "out_of_scope" for d in covered)


def test_full_tender_pricing_is_consistent(parsed, ref):
    result = price_tender(parsed[1], ref)
    p, rows = result["project"], [r for r in result["lines"] if r["cost"]]
    assert p["lines_direct"] == pytest.approx(sum(r["cost"]["direct_cost"] for r in rows))
    assert sum(result["summary"]["by_lot"].values()) == pytest.approx(p["lines_direct"])
    assert 1_000_000 < p["selling_price"] < 3_000_000  # plausibility guard for a school ventilation job
    assert result["summary"]["cad_lines"] > 0


def test_overrides_and_settings_change_the_price(parsed, ref):
    base = price_tender(parsed[1], ref)
    unpriced = next(r for r in base["lines"] if r["decision"]["status"] == "review_required" and not r["cost"])
    ov = {unpriced["line_id"]: {"unit_price": 100.0, "note": "supplier list price"}}
    edited = price_tender(parsed[1], ref, overrides=ov)
    row = next(r for r in edited["lines"] if r["line_id"] == unpriced["line_id"])
    assert row["cost"]["price_source"] == "estimator_input" and row["decision"]["status"] == "calculated"
    assert edited["project"]["lines_direct"] > base["project"]["lines_direct"]
    cheaper = price_tender(parsed[1], ref, settings={"margin_pct": 2.5})
    assert cheaper["project"]["selling_price"] < base["project"]["selling_price"]
