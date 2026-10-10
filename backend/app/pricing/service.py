"""Price a parsed tender: decisions + estimator overrides + project settings → traceable result.

Pure function of its inputs; recomputed on every request, so an edit is reflected instantly and
no stale totals are ever stored.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import asdict

from app.matching.attributes import line_attributes, mismatch_pages
from app.matching.ducts import derive_duct_lines
from app.matching.groups import assign_groups
from app.matching.matcher import Check, Decision, decide_all
from app.matching.text import T, chf
from app.reference.models import ProjectParameters, ReferenceData

from .engine import BuildUpOptions, LineInput, build_project, price_line
from .scenarios import award_price_points, bid_scenarios  # bid scenarios: hook for the AI offer loop

UNPRICED_STATUSES = {"out_of_scope", "non_priceable", "insufficient_information"}


def effective_parameters(ref: ReferenceData, settings: dict) -> ProjectParameters:
    params = ref.parameters.model_copy(deep=True)
    for key, value in (settings.get("factors") or {}).items():
        if key in params.productivity_factors:
            params.productivity_factors[key] = float(value)
    for key, value in (settings.get("allowances") or {}).items():
        if hasattr(params.allowances, key):
            setattr(params.allowances, key, float(value))
    for key, value in (settings.get("project_costs") or {}).items():
        if hasattr(params.project_costs, key):
            setattr(params.project_costs, key, float(value))
    if settings.get("overhead_pct") is not None:
        params.commercial.overhead_pct = float(settings["overhead_pct"])
    return params


def apply_override(d: Decision, ov: dict) -> dict:
    """The estimator's edits: a corrected quantity, installation hours per unit, or a unit price (typically a supplier quote)."""
    changed = []
    if ov.get("quantity") is not None:
        d.quantity = float(ov["quantity"])
        changed.append("quantity")
        if d.status == "insufficient_information" and d.install_code:
            d.status, d.priced = "assumption_applied", bool(d.product_id or d.install_code)
    if ov.get("unit_price") is not None:
        quote = ov.get("unit_price_source") == "quote"
        price = chf(float(ov["unit_price"]))
        d.priced, d.status = True, "calculated"
        d.reasons = [T(f"Unit price CHF {price} from {'a supplier quote' if quote else 'the estimator'}.",
                       f"Einheitspreis CHF {price} {'aus Lieferantenofferte' if quote else 'vom Kalkulator eingegeben'}.")]
        d.checks.append(Check("estimator", T("Net unit price entered", "Netto-Einheitspreis eingegeben"), "pass", 1.0, ov.get("note") or ""))
        changed.append("unit_price")
    if ov.get("hours_per_unit") is not None:
        changed.append("hours_per_unit")
    out = asdict(d)
    out["overridden"] = changed
    out["override_note"] = ov.get("note")
    return out


def _cost_input(line_id: str, d: dict, ov: dict) -> LineInput:
    return LineInput(
        line_id=line_id, quantity=d["quantity"] or 0.0, unit=d["unit"] or "", product_id=d["product_id"],
        install_code=d["install_code"], location=d["location"],
        unit_cost_override=ov.get("unit_price"), unit_cost_source=ov.get("unit_price_source", "estimator_input") if ov.get("unit_price") is not None else None,
        hours_override=ov.get("hours_per_unit"),
    )


def price_tender(parsed: dict, ref: ReferenceData, overrides: dict | None = None, settings: dict | None = None,
                 win: Callable[[float, float, dict, dict], dict] | None = None) -> dict:
    """`win(baseline, selling_price, parsed, settings)` adds the win-probability curve (app.winprob.service.WinService.curve)."""
    overrides, settings = overrides or {}, settings or {}
    params = effective_parameters(ref, settings)

    rows: list[dict] = []
    locations = system_locations(parsed, params, settings)
    decisions = decide_all(parsed["lines"], ref, locations)
    derived = derive_duct_lines(parsed, ref, locations) if settings.get("include_cad_ductwork", True) else []
    entries = [(line, d, "lv") for line, d in zip(parsed["lines"], decisions)] + [(line, d, "cad") for line, d in derived]

    costs = []
    flagged_pages = mismatch_pages(parsed.get("anomalies", []))
    for line, decision, source in entries:
        ov = overrides.get(line["line_id"], {})
        d = apply_override(decision, ov)
        cost = None
        if d["priced"] and d["status"] not in UNPRICED_STATUSES:
            c = price_line(_cost_input(line["line_id"], d, ov), ref, params)
            if d["product_id"] is None and ov.get("unit_price") is None:
                c = c.__class__(**{**asdict(c), "price_source": "labour_only", "trace": c.trace})
            costs.append(c)
            cost = asdict(c)
        rows.append({
            "line_id": line["line_id"], "source": source, "page": line["page"], "system": line["system"], "lot": line["lot"],
            "section": line["section"], "section_name": line.get("section_name") or "",
            "section_name_en": line.get("section_name_en") or line.get("section_name") or "",
            "title_en": d["title_en"], "title_de": d["title_de"],
            "tender_quantity": line["quantity"], "tender_unit": line["unit"], "decision": d, "cost": cost,
            "status_key": status_key(d["status"], cost),
            "evidence": line.get("evidence"), "pages": line.get("pages"),
            "attributes": line_attributes(line, d, flagged_pages) if source == "lv" else cad_attributes(line, d),
        })

    assign_groups(rows, {line["line_id"]: line for line in parsed["lines"]},
                  {pid: item.subcategory for pid, item in ref.catalog.items()})

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
        **({"win_curve": win(project.baseline, project.selling_price, parsed, settings)} if win else {}),
        "lines": rows,
        "project": asdict(project),
        "scenarios": [asdict(s) for s in scenarios],
        "award": award_curve(parsed.get("award")),
        "summary": summarize(rows),
        "settings": {"factors": params.productivity_factors, "allowances": params.allowances.model_dump(),
                     "project_costs": params.project_costs.model_dump(),
                     "discount_pct": float(settings.get("discount_pct", 0.0)), "cash_discount_pct": float(settings.get("cash_discount_pct", 0.0)),
                     "overhead_pct": params.commercial.overhead_pct, "margin_pct": project.margin_pct,
                     "risk_allowance_chf": opts.risk_allowance_chf, "include_project_costs": opts.include_project_costs,
                     "include_small_material": opts.include_small_material,
                     "include_supplier_contingency": opts.include_supplier_contingency,
                     "include_cad_ductwork": settings.get("include_cad_ductwork", True),
                     "locations": locations, "location_options": location_options(params),
                     "target_margin_pct": params.commercial.target_margin_pct, "round_to_chf": params.commercial.round_to_chf,
                     "win_context": settings.get("win_context") or {}},
    }


def cad_attributes(line: dict, d: dict) -> list[dict]:
    src = [{"page": e["page"], "bbox": e["bbox"], "text": ""} for e in (line.get("evidence") or [])]
    return [
        {"key": "type", "label": T("Item", "Artikel"), "value": {"en": d["title_en"], "de": d["title_de"]}, "sources": src[:1], "level": "read",
         "why": T("Listed in the CAD component list", "In der Bauteilliste aufgeführt")},
        {"key": "quantity", "label": T("Quantity", "Menge"), "value": f"{d['quantity']:g} {d['unit']}", "sources": src, "level": "derived",
         "why": T(f"Summed over {len(src)} list row(s)", f"Über {len(src)} Listenzeile(n) summiert")},
    ]


HEIGHT_PREFIX = "mounting_height_"


def location_options(params: ProjectParameters) -> list[str]:
    """Mounting-height locations defined in the parameters (mounting_height_<location>)."""
    return [k[len(HEIGHT_PREFIX):] for k in params.productivity_factors if k.startswith(HEIGHT_PREFIX)]


def system_locations(parsed: dict, params: ProjectParameters, settings: dict) -> dict[str, str]:
    """Location per system: estimator setting, else detected from the system / lot name, else the first option."""
    options = location_options(params)
    default = options[0] if options else "default"
    chosen = settings.get("locations") or {}
    out = {}
    for code, info in parsed["systems"].items():
        detected = info.get("location", "default")
        out[code] = chosen.get(code) or (detected if detected in options else default)
    return out


def award_curve(award: dict | None) -> dict | None:
    """The tender's own price-scoring rule, with points at a few price ratios. None if the tender states none."""
    if not award or not award.get("weight"):
        return None
    ratios = [1.0, 1.05, 1.1, 1.2] + [award["zero_at_ratio"]]
    return {**award, "points_per_pct": award["weight"] / ((award["zero_at_ratio"] - 1) * 100),
            "examples": [{"ratio": r, "points": award_price_points(r, 1.0, award["weight"], award["zero_at_ratio"])} for r in ratios]}


def status_key(status: str, cost: dict | None) -> str:
    """One status per line for filters and counts: an unpriced review line is 'needs_price'."""
    return "needs_price" if status == "review_required" and not cost else status


EXCLUDED = {"out_of_scope", "non_priceable"}
UNPRICED = {"needs_price", "insufficient_information"}


def summarize(rows: list[dict]) -> dict:
    """Counts and CHF. Definitions (tender lines only for the counts):
    - excluded  = out_of_scope + non_priceable
    - to_price  = lines − excluded
    - priced    = to_price lines that have a computed cost (calculated, supplier quote, assumption, priced review)
    - calculated= priced lines with status 'calculated' (no open question); provisional = priced − calculated
    - unpriced  = to_price − priced = needs_price + insufficient_information
    - coverage  = priced / to_price
    CHF values are direct line costs (material + labour) before project allowances, overhead and margin.
    """
    by_status: dict[str, dict] = defaultdict(lambda: {"count": 0, "lv": 0, "cad": 0, "chf": 0.0})
    by_system: dict[str, float] = defaultdict(float)
    by_lot: dict[str, float] = defaultdict(float)
    by_section: dict[str, float] = defaultdict(float)
    for r in rows:
        chf = r["cost"]["direct_cost"] if r["cost"] else 0.0
        b = by_status[r["status_key"]]
        b["count"] += 1
        b[r["source"]] += 1
        b["chf"] += chf
        by_system[r["system"]] += chf
        by_lot[r["lot"]] += chf
        by_section[r["section"] or "X"] += chf

    lv = [r for r in rows if r["source"] == "lv"]
    cad = [r for r in rows if r["source"] == "cad"]
    excluded = sum(1 for r in lv if r["status_key"] in EXCLUDED)
    to_price = len(lv) - excluded
    priced = sum(1 for r in lv if r["cost"])
    calculated = sum(1 for r in lv if r["cost"] and r["status_key"] == "calculated")
    total = sum(r["cost"]["direct_cost"] for r in rows if r["cost"])
    calc_chf = sum(r["cost"]["direct_cost"] for r in rows if r["cost"] and r["status_key"] == "calculated")
    return {
        "tender": {
            "lines": len(lv), "excluded": excluded, "to_price": to_price, "priced": priced,
            "calculated": calculated, "provisional": priced - calculated, "unpriced": to_price - priced,
            "needs_price": sum(1 for r in lv if r["status_key"] == "needs_price"),
            "missing_info": sum(1 for r in lv if r["status_key"] == "insufficient_information"),
            "coverage_pct": round(100 * priced / to_price, 1) if to_price else 0.0,
        },
        "cad": {"lines": len(cad), "priced": sum(1 for r in cad if r["cost"]),
                "chf": sum(r["cost"]["direct_cost"] for r in cad if r["cost"])},
        "value": {"total_chf": total, "calculated_chf": calc_chf, "provisional_chf": total - calc_chf,
                  "calculated_pct": round(100 * calc_chf / total, 1) if total else 0.0},
        "by_status": dict(by_status), "by_system": dict(by_system), "by_lot": dict(by_lot), "by_section": dict(by_section),
    }
