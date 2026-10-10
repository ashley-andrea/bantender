"""M6–M7: matching, statuses and full-tender pricing."""

from collections import Counter

import pytest

from app.matching.matcher import decide_all
from .evaluate import evaluate
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
    assert ahus["244.01-A-p67.1"] == "P-AHU-1000"  # 700 m³/h
    assert ahus["244.02-A-p89.1"] == "P-AHU-6200"  # 6`200 m³/h (backtick thousands separator)
    assert all(decisions[k].status == "supplier_quote_required" for k in ahus)


def test_compact_silencers_matched_by_their_own_diameter(decisions):
    by_dn = {d.product_id for d in decisions.values() if d.rule_key == "silencer_compact"}
    assert {"P-SIL-002", "P-SIL-005", "P-SIL-006", "P-SIL-007"} <= by_dn  # DN100, 125, 160, 200


def test_every_line_to_price_is_priced_except_a_missing_quantity(parsed, ref):
    r = price_tender(parsed[1], ref)
    unpriced = [x for x in r["lines"] if x["source"] == "lv" and x["status_key"] in ("needs_price", "insufficient_information")]
    assert [x["status_key"] for x in unpriced] == ["insufficient_information"]


def test_ground_duct_block_components(decisions):
    block = {k: d for k, d in decisions.items() if k.startswith("244.02-B-p103")}
    assert block["244.02-B-p103.1"].product_id == "P-DCT-G-250" and block["244.02-B-p103.1"].quantity == 48  # 16 × 3 m
    assert [block[f"244.02-B-p103.{i}"].product_id for i in (4, 5, 6, 7)] == ["P-DCT-G-B45", "P-DCT-G-B90", "P-DCT-G-CON", "P-DCT-G-CLP"]


def test_project_costs_not_double_counted(decisions):
    covered = [d for d in decisions.values() if d.rule_key in ("hygiene", "commissioning", "installation_time", "installation_transport")]
    assert covered and all(d.status == "out_of_scope" for d in covered)


def test_full_tender_pricing_is_consistent(parsed, ref):
    result = price_tender(parsed[1], ref)
    p, rows = result["project"], [r for r in result["lines"] if r["cost"]]
    assert p["lines_direct"] == pytest.approx(sum(r["cost"]["direct_cost"] for r in rows))
    assert sum(result["summary"]["by_lot"].values()) == pytest.approx(p["lines_direct"])
    assert 1_000_000 < p["selling_price"] < 3_000_000  # plausibility guard for a school ventilation job
    assert result["summary"]["cad"]["lines"] > 0


def test_overrides_and_settings_change_the_price(parsed, ref):
    base = price_tender(parsed[1], ref)
    quoted = next(r for r in base["lines"] if r["status_key"] == "supplier_quote_required")
    ov = {quoted["line_id"]: {"unit_price": quoted["cost"]["net_unit_cost"] * 1.5, "unit_price_source": "quote", "note": "Quote 123"}}
    edited = price_tender(parsed[1], ref, overrides=ov)
    row = next(r for r in edited["lines"] if r["line_id"] == quoted["line_id"])
    assert row["cost"]["price_source"] == "quote" and row["decision"]["status"] == "calculated"
    assert edited["project"]["lines_direct"] > base["project"]["lines_direct"]
    cheaper = price_tender(parsed[1], ref, settings={"margin_pct": 2.5})
    assert cheaper["project"]["selling_price"] < base["project"]["selling_price"]


def test_summary_counts_and_formulas_add_up(parsed, ref):
    r = price_tender(parsed[1], ref)
    s, rows = r["summary"], r["lines"]
    t = s["tender"]
    lv = [x for x in rows if x["source"] == "lv"]
    assert t["lines"] == len(lv) == 254  # 251 + 3 rows whose unit was glued to the text
    assert t["to_price"] == t["lines"] - t["excluded"]
    assert t["priced"] + t["unpriced"] == t["to_price"]
    assert t["unpriced"] == t["needs_price"] + t["missing_info"]
    assert t["calculated"] + t["provisional"] == t["priced"]
    assert t["coverage_pct"] == round(100 * t["priced"] / t["to_price"], 1)
    # every row has exactly one status key, and the per-status counts cover all rows
    assert sum(b["count"] for b in s["by_status"].values()) == len(rows)
    assert sum(b["lv"] for b in s["by_status"].values()) == len(lv)
    # CHF: statuses, systems and lots all sum to the line total; value split adds up
    total = sum(x["cost"]["direct_cost"] for x in rows if x["cost"])
    for part in ("by_status", "by_system", "by_lot", "by_section"):
        values = [b["chf"] for b in s[part].values()] if part == "by_status" else list(s[part].values())
        assert sum(values) == pytest.approx(total)
    assert s["value"]["calculated_chf"] + s["value"]["provisional_chf"] == pytest.approx(total)
    assert r["project"]["lines_direct"] == pytest.approx(total)
    # a line has a cost if and only if its status is a priced one
    for x in rows:
        assert (x["cost"] is not None) == (x["status_key"] not in ("needs_price", "insufficient_information", "out_of_scope", "non_priceable"))


def test_tender_facts_are_read_from_the_document(parsed):
    _, p = parsed
    assert p["project"]["bkp"] == "244" and p["project"]["trade_en"] == "Ventilation"
    assert p["project"]["name"] == "SH Erlenstrasse Oberglatt"
    assert {k: v["name"] for k, v in p["lots"].items()} == {"1": "Schulhaus", "2": "Turnhalle"}
    assert p["lots"]["2"]["systems"] == ["244.05"]
    assert p["award"]["weight"] == 60 and p["award"]["zero_at_ratio"] == 1.5 and p["award"]["page"] == 9
    assert p["systems"]["244.05"]["location"] == "sports_hall" and p["systems"]["244.01"]["location"] == "default"


def test_locations_drive_the_height_factor(parsed, ref):
    base = price_tender(parsed[1], ref)
    moved = price_tender(parsed[1], ref, settings={"locations": {"244.01": "sports_hall"}})
    a = {x["line_id"]: x for x in base["lines"]}
    b = {x["line_id"]: x for x in moved["lines"]}
    line = next(k for k, x in a.items() if x["system"] == "244.01" and x["cost"] and x["cost"]["labour_cost"] > 0 and x["source"] == "lv"
                and x["decision"]["install_code"] == "DIFFUSER")
    assert b[line]["cost"]["adjusted_hours"] == pytest.approx(a[line]["cost"]["adjusted_hours"] * 1.25 / 1.10)
    assert base["settings"]["locations"]["244.05"] == "sports_hall"


def _overlap(a, b):
    w, h = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    return max(0, w) * max(0, h) > 0.2 * min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))


def test_attributes_have_sources_levels_and_no_overlapping_boxes(parsed, ref):
    result = price_tender(parsed[1], ref)
    levels = Counter()
    for row in (r for r in result["lines"] if r["source"] == "lv"):
        keys = {a["key"] for a in row["attributes"]}
        assert {"type", "quantity", "system", "section"} <= keys, row["line_id"]
        boxes = []
        for a in row["attributes"]:
            assert a["level"] in ("read", "derived", "assumed", "missing", "n/a")
            levels[(a["key"], a["level"])] += 1
            boxes += [(s["page"], tuple(s["bbox"])) for s in a["sources"] if s.get("bbox")]
            if a["key"] in ("system", "section", "type") or a["value"]:
                assert any(s.get("bbox") for s in a["sources"]), (row["line_id"], a["key"])
        distinct = sorted(set(boxes))
        for i, (p1, b1) in enumerate(distinct):
            assert not any(p1 == p2 and _overlap(b1, b2) for p2, b2 in distinct[i + 1:]), row["line_id"]
    # A blank quantity reads the same everywhere: assumed when priced, n/a when included elsewhere, missing otherwise.
    assert levels[("quantity", "assumed")] + levels[("quantity", "n/a")] + levels[("quantity", "missing")] == 5
    assert levels[("quantity", "missing")] == 1
