"""Write the offer into the original tender PDF.

The tender requires the original LV, filled in, with no text changes ("zwingend das zugestellte
Originalleistungsverzeichnis ausgefüllt einzureichen … Textänderungen … werden nicht beachtet").
So we only add numbers into the price fields: unit price and amount on every LV line, section totals,
the installation and services totals of section E, the installation days, the cost summary per
system and lot, and the conditions scheme. Dotted placeholders are covered, nothing else is touched.

Every field is located on the page itself (column rectangles under the "Einheits-" / "Betrag"
headers, row labels such as "Total …", "Eingabesumme Los n", "MWST"), not by fixed coordinates.
"""

from __future__ import annotations

import re

import pymupdf

FONT, SIZE, INK = "helv", 8.5, (0.02, 0.02, 0.02)
SMALL = 7.0  # cost-summary cells are narrow
DOTS = re.compile(r"^\.{3,}$")


def fmt(x: float, decimals: int = 2) -> str:
    return f"{x:,.{decimals}f}".replace(",", "'")


class Writer:
    def __init__(self, doc: pymupdf.Document):
        self.doc = doc
        self.fields: list[dict] = []

    def put(self, page_no: int, right_x: float, baseline: float, text: str, kind: str, ref: str = "", size: float = SIZE,
            cover: list[pymupdf.Rect] | None = None) -> None:
        page = self.doc[page_no - 1]
        for r in cover or []:
            page.draw_rect(r, color=None, fill=(1, 1, 1), overlay=True)
        width = pymupdf.get_text_length(text, fontname=FONT, fontsize=size)
        page.insert_text((right_x - width, baseline), text, fontname=FONT, fontsize=size, color=INK)
        self.fields.append({"page": page_no, "bbox": [right_x - width - 1, baseline - size, right_x + 1, baseline + 2],
                            "text": text, "kind": kind, "ref": ref})


def _rows(page: pymupdf.Page) -> list[dict]:
    """Words grouped into visual rows: [{y0, y1, text, words}]."""
    rows: list[dict] = []
    for w in sorted(page.get_text("words"), key=lambda w: ((w[1] + w[3]) / 2, w[0])):
        cy = (w[1] + w[3]) / 2
        if rows and abs(rows[-1]["cy"] - cy) < 3:
            rows[-1]["words"].append(w)
        else:
            rows.append({"cy": cy, "words": [w]})
    for r in rows:
        r["words"].sort(key=lambda w: w[0])
        r["text"] = " ".join(w[4] for w in r["words"])
        r["y0"], r["y1"] = min(w[1] for w in r["words"]), max(w[3] for w in r["words"])
    return rows


def _price_columns(page: pymupdf.Page) -> tuple[pymupdf.Rect, pymupdf.Rect] | None:
    """The unit-price and amount columns: the drawn rectangles that contain the 'Einheits-' and 'Betrag' headers."""
    words = [w for w in page.get_text("words") if w[1] < 80]
    head = {name: next((w for w in words if w[4].startswith(name)), None) for name in ("Einheits", "Betrag")}
    if not all(head.values()):
        return None
    cols = {}
    for name, w in head.items():
        cx, cy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        boxes = [d["rect"] for d in page.get_drawings() if d["rect"].contains(pymupdf.Point(cx, cy)) and d["rect"].height < 60]
        cols[name] = min(boxes, key=lambda r: r.width) if boxes else pymupdf.Rect(w[0] - 4, 0, w[2] + 40, 0)
    return cols["Einheits"], cols["Betrag"]


def _dots_in(row: dict, x0: float, x1: float) -> list[pymupdf.Rect]:
    return [pymupdf.Rect(w[:4]) for w in row["words"] if DOTS.match(w[4]) and w[0] >= x0 - 2 and w[2] <= x1 + 2]


def _group_total(label: str, system: str, at: tuple[int, float], lines: list[dict], offer_lines: dict, done: set[str]) -> float:
    """Sum of the amounts of the positions a "Total aller <items>" row closes: same system, printed before the row,
    not yet in an earlier group total, and named with the same noun (e.g. "Volumenstromregler")."""
    noun = label.split()[2].split("-")[-1].lower() if len(label.split()) > 2 else ""
    total = 0.0
    for line in lines:
        ln = offer_lines.get(line["line_id"])
        if (line["system"] != system or line["line_id"] in done or not ln or ln["kind"] != "priced"
                or (line["page"], line["row_bbox"][1]) >= at or noun not in (line["header"] or "").lower()):
            continue
        total += ln["amount"]
        done.add(line["line_id"])
    return round(total, 2)


def fill_offer(pdf_bytes: bytes, parsed: dict, offer: dict) -> tuple[bytes, list[dict]]:
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    out = Writer(doc)
    lines_by_page: dict[int, list[dict]] = {}
    for line in parsed["lines"]:
        lines_by_page.setdefault(line["page"], []).append(line)

    page_system = {}
    for code, info in parsed["systems"].items():
        for p in range(info["first_page"], info["last_page"] + 1):
            page_system[p] = code

    group_done: set[str] = set()

    # 1. LV pages: unit prices, amounts, "inkl.", and the form's own total rows
    for page_info in parsed["pages"]:
        if page_info["kind"] != "lv":
            continue
        pno = page_info["page"]
        page = doc[pno - 1]
        cols = _price_columns(page)
        if cols is None:
            continue
        unit_col, amount_col = cols
        rows = _rows(page)
        system = offer["systems"].get(page_system.get(pno, ""), {})

        def row_at(y0: float, y1: float) -> dict | None:
            return next((r for r in rows if r["y0"] <= (y0 + y1) / 2 <= r["y1"] + 1), None)

        for line in lines_by_page.get(pno, []):
            ln = offer["lines"].get(line["line_id"])
            if not ln:
                continue
            y0, y1 = line["row_bbox"][1], line["row_bbox"][3]
            row = row_at(y0, y1) or {"words": []}
            base = y1 - 1.5
            if ln["kind"] == "priced":
                out.put(pno, unit_col.x1 - 3, base, fmt(ln["unit_price"]), "unit_price", line["line_id"], cover=_dots_in(row, unit_col.x0, unit_col.x1))
                out.put(pno, amount_col.x1 - 3, base, fmt(ln["amount"]), "amount", line["line_id"], cover=_dots_in(row, amount_col.x0, amount_col.x1))
            elif ln["kind"] == "included":
                out.put(pno, amount_col.x1 - 3, base, "inkl.", "included", line["line_id"], cover=_dots_in(row, amount_col.x0, amount_col.x1))

        if not system:
            continue
        code = page_system.get(pno, "")
        summary_page = any(r["text"] == "KOSTENZUSAMMENSTELLUNG" for r in rows)
        for i, row in enumerate(rows):
            text, base = row["text"], row["y1"] - 1.5
            cover = _dots_in(row, amount_col.x0, amount_col.x1)
            below = rows[i + 1] if i + 1 < len(rows) else None
            if not cover and below and DOTS.match(below["text"]):  # the dotted cell sometimes sits one row lower
                cover, base = _dots_in(below, amount_col.x0, amount_col.x1), below["y1"] - 1.5
            if summary_page:
                # The system's own cost summary: one row per section, then "Total <system>".
                m = re.match(r"^([A-F]) \S", text)
                t = re.match(r"^Total (\d{3})\.(\d{1,2})\b", text)
                if m and row["words"][0][0] < 80 and cover:  # dotted cell; "entfällt" rows are left as printed
                    value = system["sections"].get(m.group(1), 0.0)
                    out.put(pno, amount_col.x1 - 3, base, fmt(value), "system_summary", f"{code}/{m.group(1)}", cover=cover)
                elif t:  # the system of the page (document order); the printed code can be wrong (p.195 says 244.01)
                    out.put(pno, amount_col.x1 - 3, base, fmt(system["total"]), "system_total", code, cover=cover)
                continue
            if text.startswith("Total aller "):
                # Group total ("Total aller Einkanal-Volumenstromregler …"): the label may run onto the next row.
                target = next((r for r in rows[i:i + 3] if _dots_in(r, amount_col.x0, amount_col.x1)), row)
                value = _group_total(text, code, (pno, row["y0"]), parsed["lines"], offer["lines"], group_done)
                if value:
                    out.put(pno, amount_col.x1 - 3, target["y1"] - 1.5, fmt(value), "group_total", text[12:60],
                            cover=_dots_in(target, amount_col.x0, amount_col.x1))
                continue
            m = re.match(r"^Total .*\"([A-F])\"", text)
            if m:
                value = system["sections"].get(m.group(1))
                if value:
                    out.put(pno, amount_col.x1 - 3, base, fmt(value), "section_total", f"{m.group(1)}", cover=cover)
            elif text.startswith("Total Montage und Transport"):
                out.put(pno, amount_col.x1 - 3, base, fmt(system["montage"]), "montage", cover=cover)
            elif text.startswith("Total Dienstleistungen"):
                out.put(pno, amount_col.x1 - 3, base, fmt(system["services"]), "services", cover=cover)
            elif text.startswith("Materialauszug") and system.get("cad_material"):
                out.put(pno, amount_col.x1 - 3, base, fmt(system["cad_material"]), "cad_material", cover=cover)
            elif "Mann" in text and "Tage" in text and any("Montagezeit" in r["text"] for r in rows[max(0, i - 2):i]):
                crew = int(re.search(r"(\d+)\s+Mann", text).group(1))
                days = system["labour_hours"] / (crew * 8)
                tage = next(w for w in row["words"] if w[4] == "Tage")
                dots = [pymupdf.Rect(w[:4]) for w in row["words"] if DOTS.match(w[4]) and w[0] > tage[2]]
                right = dots[0].x1 if dots else tage[2] + 30
                out.put(pno, right, base, fmt(days, 1), "days", cover=dots[:1])

    # 2. Cost summary (Kostenzusammenstellung): systems × sections, lot totals, offer sums
    for page_info in parsed["pages"]:
        page = doc[page_info["page"] - 1]
        if "KOSTENZUSAMMENSTELLUNG" not in page.get_text():
            continue
        rows = _rows(page)
        header = next((r for r in rows if [w[4] for w in r["words"]][:6] == ["A", "B", "C", "D", "E", "F"]), None)
        total_word = next((w for r in rows for w in r["words"] if w[4] == "Total" and w[0] > 400), None)
        if not header or not total_word:
            continue
        right = {w[4]: (w[0] + w[2]) / 2 + 22 for w in header["words"]}
        right["Total"] = total_word[2] + 6
        bkp = parsed.get("project", {}).get("bkp")
        lot = None
        for row in rows:
            first = row["words"][0][4]
            base = row["y1"] - 1.5
            m = re.match(r"^LOS$", first)
            if m and len(row["words"]) > 1:
                lot = row["words"][1][4]
                continue
            m = re.match(r"^(\d{3})\.(\d{1,2})$", first)
            if m and (bkp is None or m.group(1) == bkp):
                code = f"{m.group(1)}.{int(m.group(2)):02d}"
                sysd = offer["systems"].get(code)
                if not sysd:
                    continue
                for sec, value in sysd["sections"].items():
                    if value and sec in right:
                        out.put(page_info["page"], right[sec], base, fmt(value, 0), "summary_cell", f"{code}/{sec}", size=SMALL)
                out.put(page_info["page"], right["Total"], base, fmt(sysd["total"], 0), "summary_total", code, size=SMALL)
            elif first == "Total" and len(row["words"]) == 1 and lot in offer["lots"]:
                lot_systems = [c for c, info in parsed["systems"].items() if info["lot"] == lot]
                for sec in "ABCDEF":
                    value = sum(offer["systems"][c]["sections"].get(sec, 0.0) for c in lot_systems)
                    if value and sec in right:
                        out.put(page_info["page"], right[sec], base, fmt(value, 0), "lot_cell", f"{lot}/{sec}", size=SMALL)
                out.put(page_info["page"], right["Total"], base, fmt(offer["lots"][lot], 0), "lot_total", lot, size=SMALL)
            elif row["text"].startswith("Eingabesumme Los"):
                n = row["words"][2][4]
                dots = [pymupdf.Rect(w[:4]) for w in row["words"] if DOTS.match(w[4])]
                if n in offer["lots"] and dots:
                    out.put(page_info["page"], dots[0].x1, base, fmt(offer["lots"][n]), "lot_brutto", n, cover=dots)
            elif row["text"].startswith("Total Eingabesumme"):
                dots = [pymupdf.Rect(w[:4]) for w in row["words"] if DOTS.match(w[4])]
                if dots:
                    out.put(page_info["page"], dots[0].x1, base, fmt(offer["brutto"]), "brutto", cover=dots)

    # 3. Conditions scheme ("Konditionen"): gross → discounts → deductions → VAT → net
    c = offer["conditions"]
    if c.get("page"):
        pno = c["page"]
        page = doc[pno - 1]
        rows = _rows(page)
        labels = [("Brutto", c["brutto"], None), ("Rabatt", c["discount"], c["discount_pct"]), ("Zwischentotal 1", c["sub1"], None),
                  ("Skonto", c["cash_discount"], c["cash_discount_pct"]), ("Zwischentotal 2", c["sub2"], None),
                  ("allg. Bauabzüge", c["deductions"], None), ("Zwischentotal 3", c["sub3"], None), ("MWST", c["vat"], None),
                  ("Netto", c["netto"], None)]
        in_scheme = False
        for row in rows:
            if row["text"].startswith("Bezeichnung"):
                in_scheme = True
                continue
            dots = [pymupdf.Rect(w[:4]) for w in row["words"] if DOTS.match(w[4])]
            base = row["y1"] - 1.5
            if not in_scheme:
                # Summary by BKP at the top: gross and net per BKP line and in total
                if len(dots) >= 2 and (row["words"][0][4] in ("Total",) or re.match(r"^\d{3}$", row["words"][0][4]) or row["text"].startswith("ohne NPK")):
                    if row["text"].startswith("ohne NPK"):
                        continue
                    out.put(pno, dots[0].x1, base, fmt(c["brutto"]), "brutto", cover=[dots[0]])
                    out.put(pno, dots[1].x1, base, fmt(c["netto"]), "netto", cover=[dots[1]])
                continue
            for label, value, pct in labels:
                if row["text"].startswith(label):
                    amount_dots = [d for d in dots if d.width > 60]
                    if amount_dots:
                        out.put(pno, amount_dots[0].x1, base, fmt(value), "condition", label, cover=[amount_dots[0]])
                    pct_dots = [d for d in dots if d.width <= 60]
                    if pct is not None and pct_dots:
                        out.put(pno, pct_dots[0].x1, base, fmt(pct), "condition_pct", label, cover=[pct_dots[0]])
                    break

    data = doc.tobytes(garbage=3, deflate=True)
    doc.close()
    return data, out.fields
