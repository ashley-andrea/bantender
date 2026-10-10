"""Compare extracted lines with the verified examples (example_lv_positions.csv)."""

from __future__ import annotations

import re

from app.parsing.models import LVLine
from app.parsing.normalize import parse_sizes


def expected_size(description: str) -> dict:
    d = description.lower()
    out = {}
    m = re.search(r"dn\s?(\d+)", d)
    if m:
        out["dn_mm"] = float(m.group(1))
    m = re.search(r"(\d+)x(\d+)(?:x(\d+))?\s*mm", d)
    if m:
        out["width_mm"], out["height_mm"] = float(m.group(1)), float(m.group(2))
    m = re.search(r"(\d+)\s*mm", d)
    if "mineral wool" in d and m:
        out["thickness_mm"] = float(m.group(1))
    return out


def size_matches(line: LVLine, exp: dict) -> bool:
    s = parse_sizes(line.description)
    if "width_mm" in exp:
        if not (s.width_mm and s.height_mm):
            return False
        if sorted((s.width_mm, s.height_mm)) != sorted((exp["width_mm"], exp["height_mm"])):
            return False
        exp = {k: v for k, v in exp.items() if k not in ("width_mm", "height_mm")}
    for key, value in exp.items():
        got = getattr(s, key)
        if got is None or abs(got - value) > 0.5:
            return False
    return True


def evaluate(lines: list[LVLine], examples: list[dict]) -> dict:
    results, used = [], set()
    for e in examples:
        page, qty, unit = int(e["source_page"]), float(e["quantity"]), e["unit"]
        exp = expected_size(e["description"])
        candidates = [l for l in lines if l.page == page and l.quantity == qty and l.unit == unit and l.line_id not in used]
        sized = [l for l in candidates if size_matches(l, exp)] if exp else candidates
        best = (sized or candidates or [None])[0]
        if best:
            used.add(best.line_id)
        results.append({
            "lv_id": e["lv_id"], "page": page, "quantity": qty, "unit": unit,
            "found": bool(candidates), "size_ok": bool(sized) if exp else None,
            "line_id": best.line_id if best else None, "system_ok": bool(best and best.system == e["system"][:6]),
        })
    return {
        "found": sum(r["found"] for r in results),
        "size_ok": sum(1 for r in results if r["size_ok"]),
        "size_checked": sum(1 for r in results if r["size_ok"] is not None),
        "system_ok": sum(r["system_ok"] for r in results),
        "total": len(results),
        "details": results,
    }
