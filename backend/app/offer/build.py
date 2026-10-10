"""From the priced tender to the numbers that go on the tender's own offer form.

The LV is filled the way it is structured:
- item lines (sections A–D) carry supply prices;
- section E carries installation ("Montage und Transport") and services ("Dienstleistungen"),
  plus the hygiene inspection on its own line, and the installation days;
- section F (insulation, "inkl. Montage") carries supply and installation;
- install-only lines (e.g. field devices) carry their labour.
SIA 118 Art. 39: transport, surcharges etc. are included in the unit prices. So every cost component is
multiplied by one factor  m = offer price ÷ direct cost,  which spreads overhead, risk and margin evenly
and makes the filled form add up to the offer price (up to rounding to centimes).
"""

from __future__ import annotations

from collections import defaultdict

INSTALLED_SECTIONS = {"F"}  # sections whose unit prices include installation
INCLUDED = {"out_of_scope", "non_priceable"}


def build_offer(parsed: dict, pricing: dict, settings: dict | None = None) -> dict:
    settings = settings or {}
    p = pricing["project"]
    params = pricing["settings"]
    small_pct = params["allowances"]["small_material_pct"] / 100 if p["small_material"] else 0.0
    cont_pct = params["allowances"]["supplier_package_contingency_pct"] / 100 if p["supplier_contingency"] else 0.0
    factor = p["selling_price"] / p["direct"] if p["direct"] else 0.0

    systems = {code: {"sections": defaultdict(float), "montage_raw": 0.0, "labour_hours": 0.0, "services_raw": 0.0,
                      "hygiene_raw": 0.0, "cad_material_raw": 0.0, "direct": 0.0}
               for code in parsed["systems"]}
    lines: dict[str, dict] = {}

    # 1. Line components (raw = before the factor)
    for r in pricing["lines"]:
        sysd = systems[r["system"]]
        c, status = r["cost"], r["decision"]["status"]
        if r["source"] == "cad":
            if c:
                sysd["cad_material_raw"] += c["material_cost"] * (1 + small_pct)
                sysd["montage_raw"] += c["labour_cost"]
                sysd["labour_hours"] += c["adjusted_hours"]
                sysd["direct"] += c["direct_cost"]
            continue
        if not c:
            lines[r["line_id"]] = {"kind": "included" if status in INCLUDED else "empty", "status": status}
            continue
        sysd["direct"] += c["direct_cost"]
        extra = c["material_cost"] * (cont_pct if c["price_source"] == "supplier_package" else small_pct)
        labour_only = c["material_cost"] == 0 and c["labour_cost"] > 0
        keep_labour = r["section"] in INSTALLED_SECTIONS or labour_only
        raw = c["material_cost"] + extra + (c["labour_cost"] if keep_labour else 0.0)
        if not keep_labour:
            sysd["montage_raw"] += c["labour_cost"]
            sysd["labour_hours"] += c["adjusted_hours"]
        qty = r["decision"]["quantity"] or 0.0
        lines[r["line_id"]] = {"kind": "priced", "raw": raw, "quantity": qty, "unit": r["decision"]["unit"],
                               "includes_labour": keep_labour, "section": r["section"], "system": r["system"]}

    # 2. Project-level costs, allocated to systems by their share of direct line cost
    total_direct = sum(s["direct"] for s in systems.values()) or 1.0
    services = p["engineering"] + p["commissioning"] + p["documentation"]
    hygiene_lines = {r["system"]: r["line_id"] for r in pricing["lines"] if r["decision"].get("rule_key") == "hygiene"}
    for code, sysd in systems.items():
        share = sysd["direct"] / total_direct
        sysd["share"] = share
        sysd["montage_raw"] += p["transport"] * share
        sysd["services_raw"] += services * share
        if code in hygiene_lines:
            sysd["hygiene_raw"] += p["hygiene"] * share
        else:
            sysd["services_raw"] += p["hygiene"] * share

    # 3. Apply the factor and round to centimes, the way the form is filled
    def chf(x: float) -> float:
        return round(x * factor + 1e-9, 2)

    for line_id, ln in lines.items():
        if ln["kind"] != "priced":
            continue
        amount = chf(ln["raw"])
        ln["unit_price"] = round(amount / ln["quantity"], 2) if ln["quantity"] else amount
        ln["amount"] = round(ln["unit_price"] * ln["quantity"], 2) if ln["quantity"] else amount
        systems[ln["system"]]["sections"][ln["section"] or "X"] += ln["amount"]

    for code, sysd in systems.items():
        sysd["montage"] = chf(sysd["montage_raw"])
        sysd["services"] = chf(sysd["services_raw"])
        sysd["cad_material"] = chf(sysd["cad_material_raw"])
        sysd["hygiene"] = chf(sysd["hygiene_raw"])
        if code in hygiene_lines and sysd["hygiene"]:
            lines[hygiene_lines[code]] = {"kind": "priced", "quantity": 1.0, "unit": "pc", "unit_price": sysd["hygiene"],
                                          "amount": sysd["hygiene"], "includes_labour": True, "section": "E", "system": code}
        sec = sysd["sections"]
        sec["B"] += sysd["cad_material"]
        sec["E"] += sysd["montage"] + sysd["services"] + sysd["hygiene"]
        sysd["total"] = round(sum(sec.values()), 2)
        sysd["sections"] = {k: round(v, 2) for k, v in sorted(sec.items())}

    lots: dict[str, float] = defaultdict(float)
    for code, sysd in systems.items():
        lots[parsed["systems"][code]["lot"]] += sysd["total"]
    brutto = round(sum(lots.values()), 2)

    # 4. Conditions scheme (p.2): rates printed by the client; discount and cash discount from the estimator
    cond = parsed.get("conditions") or {}
    discount_pct = float(settings.get("discount_pct", 0.0))
    cash_pct = float(settings.get("cash_discount_pct", 0.0))
    ded_pct, vat_pct = cond.get("deductions_pct", 0.0), cond.get("vat_pct", 0.0)
    discount = round(brutto * discount_pct / 100, 2)
    sub1 = round(brutto - discount, 2)
    cash = round(sub1 * cash_pct / 100, 2)
    sub2 = round(sub1 - cash, 2)
    deductions = round(sub2 * ded_pct / 100, 2)
    sub3 = round(sub2 - deductions, 2)
    vat = round(sub3 * vat_pct / 100, 2)

    return {
        "factor": factor,
        "selling_price": p["selling_price"],
        "lines": lines,
        "systems": {code: {k: v for k, v in s.items() if not k.endswith("_raw")} for code, s in systems.items()},
        "lots": {k: round(v, 2) for k, v in sorted(lots.items())},
        "brutto": brutto,
        "rounding_difference": round(brutto - p["selling_price"], 2),
        "conditions": {"page": cond.get("page"), "brutto": brutto, "discount_pct": discount_pct, "discount": discount, "sub1": sub1,
                       "cash_discount_pct": cash_pct, "cash_discount": cash, "sub2": sub2, "deductions_pct": ded_pct,
                       "deductions": deductions, "sub3": sub3, "vat_pct": vat_pct, "vat": vat, "netto": round(sub3 + vat, 2)},
    }
