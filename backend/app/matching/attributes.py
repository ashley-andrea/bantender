"""The attributes of one LV line, each with its value, where it was read (page + box) and how certain it is.

Certainty is rule-based and explained in words, so the estimator can see why a value is green or amber:
1.0  read directly from a labelled row of this line (e.g. "Grösse Ø 10 cm", quantity column)
0.9  read from an inline table or a type code of this line ("Mod. DN …", "KOSD 100/900")
0.8  inherited or derived ("wie vorbeschrieben", pieces × length, assigned by document order)
0.6  assumed (quantity left blank in the tender)
"""

from __future__ import annotations

import re

from app.parsing.normalize import parse_sizes, size_key

from .lexicon import fold
from .text import T

LABELLED_SIZE = re.compile(r"^(grösse|groesse|b\s*x\s*h|ø|\d|dn\b|abmessung)", re.I)


def _rows_matching(rows: list[dict], test) -> list[dict]:
    return [{"page": r["page"], "bbox": r["bbox"], "text": r["text"]} for r in rows if test(r)]


def line_attributes(line: dict, decision: dict, mismatch_pages: set[int]) -> list[dict]:
    rows = line.get("rows") or []
    attrs: list[dict] = []

    def add(key, label, value, src, certainty, why):
        attrs.append({"key": key, "label": label, "value": value, "sources": src, "certainty": certainty, "why": why})

    # Item type: the row that names the item
    title = line.get("item_title") or line["header"] or (line["local_text"][0] if line["local_text"] else "")
    title_rows = _rows_matching(rows, lambda r: r["text"].strip() == (title or "").strip()) or _rows_matching(rows, lambda r: r["role"] == "header")
    by_parent = decision.get("rule_key") == "accessory"
    add("type", T("Item", "Artikel"), {"en": decision["title_en"], "de": decision["title_de"]}, title_rows[:1],
        0.8 if by_parent else 1.0 if decision.get("rule_key") else 0.3,
        T("Named by its own row" if not by_parent else "Recognised from its parent item",
          "Durch die eigene Zeile benannt" if not by_parent else "Über den übergeordneten Artikel erkannt"))

    # Quantity and unit: the quantity column of the line's own row
    qty_rows = _rows_matching(rows, lambda r: r["role"] == "quantity")
    tender_qty, qty = line["quantity"], decision["quantity"]
    if tender_qty is None and qty is None:
        add("quantity", T("Quantity", "Menge"), None, qty_rows, 0.0, T("Left blank in the tender", "In der Ausschreibung leer"))
    elif tender_qty is None:
        add("quantity", T("Quantity", "Menge"), f"{qty:g} {decision['unit']}", qty_rows, 0.6, T("Blank in the tender; assumed", "Leer; angenommen"))
    elif qty != tender_qty:
        add("quantity", T("Quantity", "Menge"), f"{qty:g} {decision['unit']}", qty_rows, 0.8,
            T(f"Derived from {tender_qty:g} {line['unit_raw']} in the tender", f"Abgeleitet aus {tender_qty:g} {line['unit_raw']}"))
    else:
        add("quantity", T("Quantity", "Menge"), f"{qty:g} {line['unit_raw']}", qty_rows, 1.0,
            T("Read from the quantity column", "Aus der Mengenspalte gelesen"))

    # Size: the row that states it
    sizes = parse_sizes(line["description"])
    key = size_key(sizes)
    if key:
        exact = _rows_matching(rows, lambda r: size_key(parse_sizes(r["text"])) == key)
        labelled = [r for r in exact if LABELLED_SIZE.match(r["text"].strip())]
        if labelled:
            add("size", T("Size", "Grösse"), key, labelled[:1], 1.0, T("Read from a labelled size row", "Aus einer Grössenzeile gelesen"))
        elif exact:
            add("size", T("Size", "Grösse"), key, exact[:1], 0.9, T("Read from a type code or inline table", "Aus Typenbezeichnung oder Tabelle"))
        else:
            inherited = "wie vorbeschrieben" in fold(line["description"])
            table = _rows_matching(rows, lambda r: r["role"] in ("attribute", "own")
                                   and (r["text"].startswith("Mod.") or re.match(r"^[A-Z0-9.][\w\-.]*\s+\d", r["text"])))
            add("size", T("Size", "Grösse"), key, table[-1:] if table else [], 0.8 if inherited else 0.9,
                T("Inherited from the line above" if inherited else "Combined from an inline table",
                  "Von der Zeile darüber übernommen" if inherited else "Aus einer Tabelle zusammengesetzt"))
    if sizes.airflow_m3h:
        src = _rows_matching(rows, lambda r: "m3" in r["text"].replace(" ", "").replace("³", "3") and "/h" in r["text"].replace(" ", ""))
        add("airflow", T("Airflow", "Luftmenge"), f"{sizes.airflow_m3h:,.0f} m³/h".replace(",", "'"), src[:1], 1.0,
            T("Read from the airflow row", "Aus der Luftmengenzeile gelesen"))
    if sizes.thickness_mm:
        add("thickness", T("Insulation", "Dämmstärke"), f"{sizes.thickness_mm:g} mm", title_rows[:1], 1.0, T("Read from the item name", "Aus der Bezeichnung"))

    # Make / type reference (information only)
    brand = _rows_matching(rows, lambda r: re.match(r"^(Fabrikat|Typ)\b", r["text"]))
    if brand:
        add("reference", T("Reference product", "Referenzprodukt"), " · ".join(b["text"] for b in brand[:2]), brand[:2], 1.0,
            T("'z.B. … oder gleichwertig': a reference, not a requirement", "«z.B. … oder gleichwertig»: Referenz, keine Vorgabe"))

    # Where in the LV: system and section
    add("system", T("System", "Anlage"), f"{line['system']} {line['system_name']} · {line['section']} {line['section_name']}",
        [{"page": line["page"], "bbox": None, "text": ""}], 0.8 if line["page"] in mismatch_pages else 1.0,
        T("Assigned by document order (page header mislabelled)" if line["page"] in mismatch_pages else "From the page header and section",
          "Nach Reihenfolge zugeordnet (Seitenkopf falsch)" if line["page"] in mismatch_pages else "Aus Seitenkopf und Abschnitt"))
    return attrs


def mismatch_pages(anomalies: list[dict]) -> set[int]:
    pages = set()
    for a in anomalies:
        if a["code"] == "header_system_mismatch":
            m = re.match(r"Pages (\d+)–(\d+)", a["message"])
            if m:
                pages |= set(range(int(m.group(1)), int(m.group(2)) + 1))
    return pages
