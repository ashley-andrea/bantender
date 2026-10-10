"""The attributes of one LV line, each with its value, where it was read (page + box) and how it was obtained.

The level says how the value was obtained, not a probability:
read      printed on this line's own rows (size row, quantity column, type code, page header)
derived   worked out from something printed elsewhere ("wie vorbeschrieben", a unit conversion, the parent item,
          document order where the page header is wrong)
assumed   not in the tender; the tool filled it in (a blank quantity on a priced item is taken as 1)
missing   not in the tender and needed to price the line
n/a       not in the tender and not needed (the line is included in another position)
"""

from __future__ import annotations

import re

from app.parsing.normalize import parse_sizes, size_key

from .lexicon import fold
from .text import T, section_label, system_label

LABELLED_SIZE = re.compile(r"^(grösse|groesse|b\s*x\s*h|ø|\d|dn\b|abmessung)", re.I)


CONTEXT_ROLES = ("system", "section")
INCLUDED = ("non_priceable", "out_of_scope")


def _rows_matching(rows: list[dict], test, roles: tuple[str, ...] | None = None) -> list[dict]:
    """Source rows passing `test`; page-header and section rows only when asked for by role."""
    return [{"page": r["page"], "bbox": r["bbox"], "text": r["text"]} for r in rows
            if (r["role"] in roles if roles else r["role"] not in CONTEXT_ROLES) and test(r)]


def line_attributes(line: dict, decision: dict, mismatch_pages: set[int]) -> list[dict]:
    rows = line.get("rows") or []
    attrs: list[dict] = []

    def add(key, label, value, src, level, why):
        attrs.append({"key": key, "label": label, "value": value, "sources": src, "level": level, "why": why})

    # Item type: the row that names the item
    title = line.get("item_title") or line["header"] or (line["local_text"][0] if line["local_text"] else "")
    title_rows = _rows_matching(rows, lambda r: r["text"].strip() == (title or "").strip()) or _rows_matching(rows, lambda r: r["role"] == "header")
    by_parent = decision.get("rule_key") == "accessory"
    add("type", T("Item", "Artikel"), {"en": decision["title_en"], "de": decision["title_de"]}, title_rows[:1],
        "derived" if by_parent else "read" if decision.get("rule_key") else "assumed",
        T("Recognised from its parent item" if by_parent else "Named on its own row" if decision.get("rule_key") else "Not recognised",
          "Über den übergeordneten Artikel erkannt" if by_parent else "In der eigenen Zeile benannt" if decision.get("rule_key") else "Nicht erkannt"))

    # Quantity and unit: the quantity column of the line's own row
    qty_rows = _rows_matching(rows, lambda r: r["role"] == "quantity")
    tender_qty, qty = line["quantity"], decision["quantity"]
    unit = line["unit"] or line["unit_raw"]
    if tender_qty is None and decision["status"] in INCLUDED:
        add("quantity", T("Quantity", "Menge"), None, qty_rows, "n/a", T("Blank; not needed, included in another position", "Leer; nicht nötig, in anderer Position enthalten"))
    elif tender_qty is None and qty is None:
        add("quantity", T("Quantity", "Menge"), None, qty_rows, "missing", T("Blank in the tender; needed for a price", "In der Ausschreibung leer; für den Preis nötig"))
    elif tender_qty is None:
        # The assumption rests on the item's own name (one numbered device, e.g. "Zuluftgerät 1-1"): show both.
        add("quantity", T("Quantity", "Menge"), f"{qty:g} {decision['unit']}", qty_rows + title_rows[:1], "assumed",
            T("Blank in the tender; one device is named, so 1 is assumed", "In der Ausschreibung leer; ein Gerät ist benannt, daher 1 angenommen"))
    elif qty != tender_qty:
        add("quantity", T("Quantity", "Menge"), f"{qty:g} {decision['unit']}", qty_rows, "derived",
            T(f"Converted from {tender_qty:g} {unit}", f"Umgerechnet aus {tender_qty:g} {unit}"))
    else:
        add("quantity", T("Quantity", "Menge"), f"{qty:g} {unit}", qty_rows, "read", T("Quantity column", "Mengenspalte"))

    # Size: the row that states it
    sizes = parse_sizes(line["description"])
    key = size_key(sizes)
    if key:
        exact = _rows_matching(rows, lambda r: size_key(parse_sizes(r["text"])) == key)
        labelled = [r for r in exact if LABELLED_SIZE.match(r["text"].strip())]
        if labelled:
            add("size", T("Size", "Grösse"), key, labelled[:1], "read", T("Size row", "Grössenzeile"))
        elif exact:
            add("size", T("Size", "Grösse"), key, exact[:1], "read", T("Type code", "Typenbezeichnung"))
        else:
            inherited = "wie vorbeschrieben" in fold(line["description"])
            table = _rows_matching(rows, lambda r: r["role"] in ("attribute", "own")
                                   and (r["text"].startswith("Mod.") or re.match(r"^[A-Z0-9.][\w\-.]*\s+\d", r["text"])))
            inherit_rows = _rows_matching(rows, lambda r: "wie vorbeschrieben" in fold(r["text"])) if inherited else []
            add("size", T("Size", "Grösse"), key, inherit_rows[:1] + (table[-1:] if table else []), "derived",
                T("Same as the item above" if inherited else "Combined from a table row and its header",
                  "Wie vorbeschrieben" if inherited else "Aus Tabellenzeile und Kopf zusammengesetzt"))
    if sizes.airflow_m3h:
        src = _rows_matching(rows, lambda r: "m3" in r["text"].replace(" ", "").replace("³", "3") and "/h" in r["text"].replace(" ", ""))
        add("airflow", T("Airflow", "Luftmenge"), f"{sizes.airflow_m3h:,.0f} m³/h".replace(",", "'"), src[:1], "read",
            T("Airflow row", "Luftmengenzeile"))
    if sizes.thickness_mm:
        add("thickness", T("Insulation", "Dämmstärke"), f"{sizes.thickness_mm:g} mm", title_rows[:1], "read", T("Item name", "Bezeichnung"))

    # Make / type reference (information only)
    brand = _rows_matching(rows, lambda r: re.match(r"^(Fabrikat|Typ)\b", r["text"]))
    if brand:
        add("reference", T("Reference product", "Referenzprodukt"), _reference_value(brand[:2]), brand[:2], "read",
            T("Example product, or equivalent", "Beispielprodukt oder gleichwertig"))

    # Where in the LV: system and section
    wrong_header = line["page"] in mismatch_pages
    system_en, system_de = system_label(line["system"], line["system_name"])
    add("system", T("System", "Anlage"), {"en": system_en, "de": system_de},
        _rows_matching(rows, lambda r: True, roles=("system",)), "derived" if wrong_header else "read",
        T("By document order; the page header is wrong" if wrong_header else "Page header",
          "Nach Reihenfolge; Seitenkopf falsch" if wrong_header else "Seitenkopf"))
    if line["section"]:
        sec_en, sec_de = section_label(line["section"], line["section_name"])
        add("section", T("Section", "Abschnitt"), {"en": sec_en, "de": sec_de},
            _rows_matching(rows, lambda r: True, roles=("section",)), "read", T("Section heading", "Abschnittstitel"))
    return attrs


def _reference_value(rows: list[dict]) -> dict:
    """'Fabrikat z.B. X' / 'Typ z.B. Y' → 'X · Y' (make and model; the tender says 'or equivalent')."""
    parts = [re.sub(r"^(Fabrikat|Typ)\s*(z\.\s?B\.?)?\s*", "", r["text"]).strip() for r in rows]
    value = " · ".join(p for p in parts if p)
    return {"en": value, "de": value}


def mismatch_pages(anomalies: list[dict]) -> set[int]:
    pages = set()
    for a in anomalies:
        if a["code"] == "header_system_mismatch":
            m = re.match(r"Pages (\d+)–(\d+)", a["message"])
            if m:
                pages |= set(range(int(m.group(1)), int(m.group(2)) + 1))
    return pages
