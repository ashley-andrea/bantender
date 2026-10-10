"""Ductwork the LV does not quantify: derived from the CAD component lists (Bauteilliste).

The LV's duct section points to these lists ("Materialauszug gemäss separater Materialliste").
Every derived line states its formula and cites the list pages, and carries status
'assumption_applied' so the estimator sees it is computed, not read.
"""

from __future__ import annotations

from collections import defaultdict

from app.reference.models import ReferenceData

from .matcher import Check, Decision, item_size
from .text import T

ROUND_NAMES = {"BGE": ("Round bend", "Bogen")}


def _evidence(rows) -> list[dict]:
    return [{"page": r["page"], "bbox": r["bbox"]} for r in rows if r.get("bbox")]


def _line(system: str, info: dict, n: int, rows: list[dict], title_en: str, title_de: str, quantity: float, unit: str) -> dict:
    pages = sorted({r["page"] for r in rows})
    return {
        "line_id": f"{system}-CAD-{n:02d}", "page": pages[0], "system": system, "system_name": info["name"], "lot": info["lot"],
        "section": "B", "section_name": "Kanäle", "header": title_de, "shared_text": [], "local_text": [],
        "quantity": round(quantity, 2), "unit_raw": unit, "unit": unit, "row_bbox": None, "header_page": None, "header_bbox": None,
        "flags": [], "description": title_de, "source": "component_list", "evidence": _evidence(rows), "pages": pages,
        "title_en": title_en,
    }


def _decision(line: dict, product_id: str | None, install_code: str, location: str, checks: list[Check], assumption: dict,
              status: str = "assumption_applied", reason: dict | None = None) -> Decision:
    d = Decision(line_id=line["line_id"], rule_key="cad_ductwork", title_en=line["title_en"], title_de=line["header"],
                 product_id=product_id, install_code=install_code, quantity=line["quantity"], unit=line["unit"],
                 location=location, status=status, priced=True, confidence=None, band=None, checks=checks)
    d.assumptions.append(assumption)
    if reason:
        d.reasons.append(reason)
    d.confidence = 1.0
    for c in checks:
        d.confidence *= c.score
    d.band = "high" if d.confidence >= 0.85 else "medium" if d.confidence >= 0.6 else "low"
    return d


def derive_duct_lines(parsed: dict, ref: ReferenceData, locations: dict[str, str] | None = None) -> list[tuple[dict, Decision]]:
    out: list[tuple[dict, Decision]] = []
    catalog = list(ref.catalog.values())
    round_ducts = {item_size(i).dn: i for i in catalog if i.install_code == "DUCT_ROUND"}
    rect_ducts = [i for i in catalog if i.install_code == "DUCT_RECT"]
    bends = {(item_size_dn(i.description), angle(i.model)): i for i in catalog if i.subcategory == "Circular bend"}

    by_system: dict[str, list[dict]] = defaultdict(list)
    for r in parsed["component_rows"]:
        # Cast-in pieces ("Einlage") are priced from their own LV lines (Rohreinlagen); skip to avoid double counting.
        if "einlage" not in r["name"].lower():
            by_system[r["system"]].append(r)

    for system, rows in sorted(by_system.items()):
        info = parsed["systems"][system]
        location = (locations or {}).get(system, "default")
        n = 0
        listed = Check("source", T("Quantities from the CAD component list", "Mengen aus der Bauteilliste (CAD)"), "pass", 1.0,
                       f"pp.{', '.join(str(p) for p in sorted({r['page'] for r in rows}))}")

        # Round ducts: total length per DN.
        groups: dict[float, list[dict]] = defaultdict(list)
        for r in rows:
            if r["table"] == "ducts_round" and r["dims"]:
                groups[r["dims"][0]].append(r)
        for dn, rs in sorted(groups.items()):
            n += 1
            mm = sum(r["quantity"] for r in rs)
            item = round_ducts.get(dn)
            line = _line(system, info, n, rs, f"Spiral round duct DN{dn:g}", f"Wickelfalzrohr Ø{dn:g} mm", mm / 1000, "m")
            size = Check("size", T("Diameter matches", "Durchmesser passt"), "pass" if item else "fail", 1.0 if item else 0.0, f"DN{dn:g}")
            total = f"{mm:,.0f}".replace(",", "'")
            out.append((line, _decision(line, item.product_id if item else None, "DUCT_ROUND", location, [listed, size],
                                        T(f"Length summed from the component list: {total} mm = {mm / 1000:.2f} m.",
                                          f"Länge aus der Bauteilliste summiert: {total} mm = {mm / 1000:.2f} m."))))

        # Rectangular ducts: surface area 2(a+b)·L, priced at the nearest catalogue size by perimeter.
        rect_groups: dict[str, list[tuple[dict, float]]] = defaultdict(list)
        for r in rows:
            if r["table"] == "ducts_rect" and len(r["dims"]) >= 2:
                a, b = r["dims"][:2]
                area = 2 * (a + b) / 1000 * r["quantity"] / 1000
                item = min(rect_ducts, key=lambda i: abs(2 * (item_size(i).w + item_size(i).h) - 2 * (a + b)))
                rect_groups[item.product_id].append((r, area))
        for pid, entries in sorted(rect_groups.items()):
            n += 1
            item = ref.catalog[pid]
            area = sum(a for _, a in entries)
            sizes = sorted({f"{r['dims'][0]:g}×{r['dims'][1]:g}" for r, _ in entries})
            line = _line(system, info, n, [r for r, _ in entries], f"Rectangular duct, sizes near {item_size(item).w:g}×{item_size(item).h:g} mm",
                         f"Luftleitung {', '.join(sizes[:4])}{' …' if len(sizes) > 4 else ''} mm", area, "m2")
            near = f"{item_size(item).w:g}×{item_size(item).h:g}"
            size = Check("size", T("Size matches the catalogue", "Grösse passt zum Katalog"), "partial", 0.8,
                         T(f"{len(sizes)} size(s) priced as {near}", f"{len(sizes)} Grösse(n) als {near} kalkuliert"))
            out.append((line, _decision(line, pid, "DUCT_RECT", location, [listed, size],
                                        T(f"Area = 2 × (a + b) × length over {len(entries)} duct run(s) = {area:.1f} m²; priced at the nearest catalogue size by perimeter.",
                                          f"Fläche = 2 × (a + b) × Länge über {len(entries)} Kanalstück(e) = {area:.1f} m²; zur nächsten Kataloggrösse (Umfang) kalkuliert."))))

        # Round bends: exact catalogue item by DN and angle; other fittings: labour only.
        bend_groups: dict[tuple, list[dict]] = defaultdict(list)
        other: list[dict] = []
        for r in rows:
            if r["table"] == "fittings_round" and r["code"] == "BGE" and len(r["dims"]) >= 2:
                bend_groups[(r["dims"][0], r["dims"][-1])].append(r)
            elif r["table"] in ("fittings_round", "fittings_rect"):
                other.append(r)
        for (dn, ang), rs in sorted(bend_groups.items()):
            n += 1
            item = bends.get((dn, ang))
            pcs = sum(r["quantity"] for r in rs)
            line = _line(system, info, n, rs, f"Round bend {ang:g}° DN{dn:g}", f"Bogen {ang:g}° Ø{dn:g}", pcs, "pc")
            if item:
                out.append((line, _decision(line, item.product_id, "DUCT_FITTING", location,
                                            [listed, Check("size", T("DN and angle match", "DN und Winkel passen"), "pass", 1.0, f"DN{dn:g}, {ang:g}°")],
                                            T("Pieces counted from the component list.", "Stückzahl aus der Bauteilliste."))))
            else:
                out.append((line, _decision(line, None, "DUCT_FITTING", location,
                                            [listed, Check("size", T("DN and angle match", "DN und Winkel passen"), "fail", 0.6, f"DN{dn:g}, {ang:g}°")],
                                            T("Pieces counted from the component list.", "Stückzahl aus der Bauteilliste."), status="review_required",
                                            reason=T("No catalogue price for this bend; labour only included.", "Kein Katalogpreis für diesen Bogen; nur Montage eingerechnet."))))
        if other:
            n += 1
            pcs = sum(r["quantity"] for r in other)
            line = _line(system, info, n, other, "Other duct fittings (transitions, branches, sockets)",
                         "Formstücke (Übergänge, Abzweige, Muffen)", pcs, "pc")
            out.append((line, _decision(line, None, "DUCT_FITTING", location,
                                        [listed, Check("size", T("Catalogue price available", "Katalogpreis vorhanden"), "fail", 0.6,
                                                       T("fitting types not in catalogue", "Formstücktypen nicht im Katalog"))],
                                        T("Pieces counted from the component list.", "Stückzahl aus der Bauteilliste."), status="review_required",
                                        reason=T("No catalogue price for these fitting types; labour only included.", "Kein Katalogpreis für diese Formstücke; nur Montage eingerechnet."))))
    return out


def item_size_dn(description: str) -> float | None:
    import re

    m = re.search(r"DN(\d+)", description)
    return float(m.group(1)) if m else None


def angle(model: str) -> float | None:
    import re

    m = re.match(r"B(\d+)-", model)
    return float(m.group(1)) if m else None
