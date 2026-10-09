"""T-PRICE-1..3: the engine reproduces expected_output_example.json exactly."""

import pytest

from app.pricing import BuildUpOptions, LineInput, award_price_points, bid_scenarios, build_project, price_line

SUBSET = BuildUpOptions(include_project_costs=False, include_small_material=False, include_supplier_contingency=False)


def _priced(examples, ref):
    return [
        price_line(LineInput(e["lv_id"], float(e["quantity"]), e["unit"], e["suggested_product_id"], e["expected_install_code"]), ref)
        for e in examples
    ]


def test_reference_counts(ref):
    assert len(ref.catalog) == 56
    assert len(ref.rules) == 22


def test_golden_positions(examples, ref, golden):
    expected = {g["lv_id"]: g for g in golden["position_results"]}
    for cost in _priced(examples, ref):
        g = expected[cost.line_id]
        assert cost.net_unit_cost == pytest.approx(g["net_unit_cost_chf"], abs=0.005)
        assert cost.material_cost == pytest.approx(g["material_cost_chf"], abs=0.006)
        assert round(cost.adjusted_hours, 2) == pytest.approx(g["adjusted_install_hours"], abs=1e-9)
        assert cost.labour_cost == pytest.approx(g["labour_cost_chf"], abs=0.006)
        assert cost.direct_cost == pytest.approx(g["direct_position_cost_chf"], abs=0.011)
        assert cost.price_source == g["price_source"]


def test_golden_subset_summary(examples, ref, golden):
    project = build_project(_priced(examples, ref), ref.parameters, SUBSET)
    s = golden["example_subset_summary"]
    assert project.material == pytest.approx(s["material_cost_chf"], abs=0.01)
    assert project.labour == pytest.approx(s["labour_cost_chf"], abs=0.01)
    assert project.lines_direct == pytest.approx(s["direct_cost_chf"], abs=0.01)
    assert project.baseline == pytest.approx(s["cost_baseline_chf"], abs=0.01)


def test_golden_scenarios(examples, ref, golden):
    project = build_project(_priced(examples, ref), ref.parameters, SUBSET)
    got = {s.name: s for s in bid_scenarios(project.baseline, ref.parameters)}
    for g in golden["recommended_bid_range"]["scenarios"]:
        s = got[g["scenario"]]
        assert s.bid_price == g["bid_price_chf"]
        assert s.margin_pct == g["margin_pct"]
        assert round(s.win_probability, 2) == g["estimated_win_probability"]
        assert s.expected_contribution == pytest.approx(g["expected_contribution_chf"], abs=0.01)


def test_sports_hall_uses_its_height_factor(ref):
    school = price_line(LineInput("x", 5, "pc", "P-AIR-001", None, location="school"), ref)
    hall = price_line(LineInput("x", 5, "pc", "P-AIR-001", None, location="sports_hall"), ref)
    assert hall.adjusted_hours == pytest.approx(school.adjusted_hours * 1.25 / 1.10)


def test_site_efficiency_change_is_traceable(ref):
    params = ref.parameters.model_copy(deep=True)
    params.productivity_factors["site_efficiency"] = 1.0
    cost = price_line(LineInput("LV0001", 5, "pc", "P-AIR-001", None), ref, params)
    assert round(cost.adjusted_hours, 2) == 3.83


def test_full_build_up_adds_each_term_once(examples, ref):
    lines = _priced(examples, ref)
    p = build_project(lines, ref.parameters)
    parts = p.lines_direct + p.transport + p.small_material + p.supplier_contingency + p.engineering + p.commissioning + p.hygiene + p.documentation
    assert p.direct == pytest.approx(parts)
    assert p.engineering == 420 * 145 and p.commissioning == 160 * 155
    assert p.selling_price >= p.selling_price_exact and p.selling_price % 1000 == 0


def test_override_price_is_used_and_labelled(ref):
    cost = price_line(LineInput("x", 4, "pc", "P-SIL-001", None, unit_cost_override=2400, unit_cost_source="quote"), ref)
    assert cost.price_source == "quote" and cost.material_cost == pytest.approx(4 * 2400 * 1.04)


@pytest.mark.parametrize("ratio,points", [(1.0, 60), (1.1, 48), (1.5, 0), (1.8, 0)])
def test_award_points(ratio, points):
    assert award_price_points(100 * ratio, 100) == pytest.approx(points)
