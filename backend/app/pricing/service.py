"""Price a parsed tender: decisions + estimator overrides + project settings → traceable result.

Pure function of its inputs; recomputed on every request, so an edit is reflected instantly and
no stale totals are ever stored.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict

from app.matching.ducts import derive_duct_lines
from app.matching.matcher import Check, Decision, decide_all
from app.reference.models import ProjectParameters, ReferenceData

from .engine import BuildUpOptions, LineInput, build_project, price_line
from .scenarios import award_price_points, bid_scenarios

UNPRICED_STATUSES = {"out_of_scope", "non_priceable", "insufficient_information"}


def effective_parameters(ref: ReferenceData, settings: dict) -> ProjectParameters:
    params = ref.parameters.model_copy(deep=True)
    for key, value in (settings.get("factors") or {}).items():
        if key in params.productivity_factors:
            params.productivity_factors[key] = float(value)
    for key, value in (settings.get("allowances") or {}).items():
        if hasattr(params.allowances, key):
            setattr(params.allowances, key, float(value))
    if settings.get("overhead_pct") is not None:
        params.commercial.overhead_pct = float(settings["overhead_pct"])
    return params


def apply_override(d: Decision, ov: dict, ref: ReferenceData) -> Decision:
    changed = []
    if "quantity" in ov and ov["quantity"] is not None:
        d.quantity = float(ov["quantity"])
        changed.append("quantity")
        if d.status == "insufficient_information":
            d.status = "review_required"
    if ov.get("product_id"):
        item = ref.catalog[ov["product_id"]]
        d.product_id, d.install_code = item.product_id, item.install_code
        d.priced = True
        d.status = "supplier_quote_required" if item.supplier_quote_required and not ov.get("unit_price") else "calculated"
        d.checks.append(Check("estimator", "Product chosen by the estimator", "pass", 1.0, item.description))
        changed.append("product")
    if ov.get("labour_only") and d.install_code:
        d.product_id, d.priced, d.status = None, True, "calculated"
        d.checks.append(Check("estimator", "Labour only, decided by the estimator", "pass", 1.0, ""))
        changed.append("labour_only")
    if ov.get("unit_price") is not None:
        d.priced = True
        d.status = "calculated"
        changed.append("unit_price")
    if ov.get("status"):
        d.status = ov["status"]
        d.priced = d.priced and d.status not in UNPRICED_STATUSES
        changed.append("status")
    if ov.get("confirmed") and d.priced and d.status in ("review_required", "assumption_applied"):
        d.status = "calculated"
        d.checks.append(Check("estimator", "Confirmed by the estimator", "pass", 1.0, ov.get("note", "")))
        changed.append("confirmed")
    if changed:
        d.confidence = 1.0 if d.priced else d.confidence
        d.band = "high" if d.priced else d.band
    out = asdict(d)
    out["overridden"] = changed
    out["override_note"] = ov.get("note")
    return out


def _cost_input(line_id: str, d: dict, ov: dict) -> LineInput:
    return LineInput(
        line_id=line_id, quantity=d["quantity"] or 0.0, unit=d["unit"] or "", product_id=d["product_id"],
        install_code=d["install_code"], location=d["location"],
        unit_cost_override=ov.get("unit_price"), unit_cost_source=ov.get("unit_price_source", "estimator_input") if ov.get("unit_price") is not None else None,
    )


def price_tender(parsed: dict, ref: ReferenceData, overrides: dict | None = None, settings: dict | None = None) -> dict:
    overrides, settings = overrides or {}, settings or {}
    params = effective_parameters(ref, settings)

    rows: list[dict] = []
    decisions = decide_all(parsed["lines"], ref)
    derived = derive_duct_lines(parsed, ref) if settings.get("include_cad_ductwork", True) else []
    entries = [(line, d, "lv") for line, d in zip(parsed["lines"], decisions)] + [(line, d, "cad") for line, d in derived]

    costs = []
    for line, decision, source in entries:
        ov = overrides.get(line["line_id"], {})
        d = apply_override(decision, ov, ref)
        cost = None
        if d["priced"] and d["status"] not in UNPRICED_STATUSES:
            c = price_line(_cost_input(line["line_id"], d, ov), ref, params)
            if d["product_id"] is None and ov.get("unit_price") is None:
                c = c.__class__(**{**asdict(c), "price_source": "labour_only", "trace": c.trace})
            costs.append(c)
            cost = asdict(c)
        rows.append({
            "line_id": line["line_id"], "source": source, "page": line["page"], "system": line["system"], "lot": line["lot"],
            "section": line["section"], "title_en": d["title_en"], "title_de": d["title_de"],
            "tender_quantity": line["quantity"], "tender_unit": line["unit"], "decision": d, "cost": cost,
            "evidence": line.get("evidence"), "pages": line.get("pages"),
        })

    opts = BuildUpOptions(
        include_project_costs=settings.get("include_project_costs", True),
        include_small_material=settings.get("include_small_material", True),
        include_supplier_contingency=settings.get("include_supplier_contingency", True),
        risk_allowance_chf=float(settings.get("risk_allowance_chf", 0.0)),
        margin_pct=settings.get("margin_pct"),
    )
    project = build_project(costs, params, opts)
    scenarios = bid_scenarios(project.baseline, params)

    return {
        "lines": rows,
        "project": asdict(project),
        "scenarios": [asdict(s) for s in scenarios],
        "award": {"weight": 60, "zero_at_ratio": 1.5,
                  "examples": [{"ratio": r, "points": award_price_points(r, 1.0)} for r in (1.0, 1.05, 1.1, 1.2, 1.5)]},
        "summary": summarize(rows),
        "settings": {"factors": params.productivity_factors, "allowances": params.allowances.model_dump(),
                     "overhead_pct": params.commercial.overhead_pct, "margin_pct": project.margin_pct,
                     "risk_allowance_chf": opts.risk_allowance_chf, "include_project_costs": opts.include_project_costs,
                     "include_small_material": opts.include_small_material,
                     "include_supplier_contingency": opts.include_supplier_contingency,
                     "include_cad_ductwork": settings.get("include_cad_ductwork", True)},
    }


def summarize(rows: list[dict]) -> dict:
    by_status: dict[str, dict] = defaultdict(lambda: {"count": 0, "chf": 0.0})
    by_system: dict[str, float] = defaultdict(float)
    by_lot: dict[str, float] = defaultdict(float)
    by_section: dict[str, float] = defaultdict(float)
    priced_value = high_value = 0.0
    for r in rows:
        chf = r["cost"]["direct_cost"] if r["cost"] else 0.0
        s = by_status[r["decision"]["status"]]
        s["count"] += 1
        s["chf"] += chf
        by_system[r["system"]] += chf
        by_lot[r["lot"]] += chf
        by_section[r["section"] or "X"] += chf
        priced_value += chf
        if r["decision"]["band"] == "high" and r["decision"]["status"] == "calculated":
            high_value += chf
    lv = [r for r in rows if r["source"] == "lv"]
    actionable = [r for r in lv if r["decision"]["status"] not in ("out_of_scope", "non_priceable")]
    priced_lv = [r for r in actionable if r["cost"]]
    return {
        "lv_lines": len(lv), "cad_lines": len(rows) - len(lv), "actionable_lines": len(actionable), "priced_lines": len(priced_lv),
        "coverage_pct": round(100 * len(priced_lv) / len(actionable), 1) if actionable else 0.0,
        "value_confirmed_pct": round(100 * high_value / priced_value, 1) if priced_value else 0.0,
        "needs_price": sum(1 for r in actionable if not r["cost"]),
        "by_status": dict(by_status), "by_system": dict(by_system), "by_lot": dict(by_lot), "by_section": dict(by_section),
    }
