"""Deterministic segmentation of a Messerli-style LV into priceable lines.

Works on visual rows (see pdf_layer / docling_layer), so different readers can be
compared on the same logic.
"""

from __future__ import annotations

import re
from collections import defaultdict

from .models import Anomaly, ComponentRow, LVLine, PageInfo, ParsedTender, Row
from .normalize import normalize_unit, parse_number, parse_sizes

CONTENT_TOP = 60.0  # pt: above this are page header and LV column titles
CONTENT_BOTTOM = 785.0  # pt: below this is the file-path footer
DEFAULT_COLUMNS = (365.0, 405.0, 445.0)  # unit, quantity, unit-price column starts

SYSTEM_RE = re.compile(r"\b(244\.\d{2})\s+(.+?)\s+Seite\s+\d+\s*/\s*\d+", re.I)
SYSTEM_TITLE_RE = re.compile(r"^244\.\d{2}\b")
SECTION_RE = re.compile(r"^([A-F])\s+([A-ZÄÖÜ][A-ZÄÖÜ ,/\-]+)$")
DOTS_RE = re.compile(r"^[.\s_…]+$")
UNIT_QTY_RE = re.compile(r"^(\S+)\s+(\d[\d'’.,]*)$")


def classify_page(page: int, rows: list[Row]) -> PageInfo:
    top = [r for r in rows if r.y < CONTENT_TOP]
    top_text = " ".join(r.text for r in top)
    info = PageInfo(page=page, kind="conditions")
    m = SYSTEM_RE.search(top_text)
    if m:
        info.header_system = m.group(1)
    head_rows = " ".join(r.text for r in rows[:6])
    if "Bauteilliste" in head_rows:
        info.kind = "component_list"
    elif info.header_system:
        info.kind = "lv"
        mass = sorted(s.x0 for r in top for s in r.segments if s.text.startswith("Mass-"))
        price = [s.x0 for r in top for s in r.segments if s.text.startswith("Einheits")]
        if len(mass) >= 2 and price:
            info.unit_x, info.qty_x, info.price_x = mass[0], mass[-1], price[0]
    elif re.search(r"Planliste|^9\.\s*Pl[äa]ne", head_rows):
        info.kind = "plans"
    return info


def parse_lots(rows: list[Row]) -> dict[str, str]:
    """Read 'LOS n' and '244.n' labels from the cost summary page (p.3)."""
    lots, current = {}, None
    for r in rows:
        for seg in r.segments:
            m = re.match(r"LOS\s+(\d)", seg.text)
            if m:
                current = m.group(1)
            m = re.match(r"244\.(\d)\b", seg.text)
            if m and current:
                lots[f"244.{int(m.group(1)):02d}"] = current
    return lots


def _split_row(row: Row, info: PageInfo) -> tuple[list, list]:
    unit_x = (info.unit_x or DEFAULT_COLUMNS[0]) - 12
    left = [s for s in row.segments if s.x0 < unit_x]
    right = [s for s in row.segments if s.x0 >= unit_x and not DOTS_RE.match(s.text)]
    return left, right


def _quantity(right, info: PageInfo):
    """Return (unit_raw, quantity, ok) for the right-hand columns of a row, or None."""
    price_x = (info.price_x or DEFAULT_COLUMNS[2]) - 2
    cols = [s for s in right if s.x0 < price_x]
    if not cols:
        return None
    texts = [s.text for s in cols]
    if len(texts) == 1:
        m = UNIT_QTY_RE.match(texts[0])
        if m and normalize_unit(m.group(1)):
            return m.group(1), parse_number(m.group(2))
        if normalize_unit(texts[0]):
            return texts[0], None
        return None
    unit_raw, qty_raw = texts[0], texts[1]
    if not normalize_unit(unit_raw):
        return None
    return unit_raw, parse_number(qty_raw)


def segment(rows_by_page: dict[int, list[Row]], use_bold: bool = True) -> ParsedTender:
    pages = [classify_page(p, rows_by_page[p]) for p in sorted(rows_by_page)]
    lots = parse_lots(rows_by_page.get(3, []))
    anomalies: list[Anomaly] = []
    lines: list[LVLine] = []
    component_rows: list[ComponentRow] = []
    systems: dict[str, dict] = {}
    counters: dict[tuple, int] = defaultdict(int)

    system = system_name = None
    section, section_name = "", ""
    header, header_page, header_bbox = "", None, None
    shared: list[str] = []
    local: list[str] = []
    item_has_qty = False
    last_row_y = None
    last_cols = None
    component_table = None

    subtable: list[str] = []

    def start_item(text, page, bbox):
        nonlocal header, header_page, header_bbox, shared, local, item_has_qty, subtable
        header, header_page, header_bbox = text, page, bbox
        shared, local, item_has_qty, subtable = [], [], False, []

    for info in pages:
        rows = rows_by_page[info.page]
        if info.kind == "lv":
            if info.unit_x is None and last_cols:
                info.unit_x, info.qty_x, info.price_x = last_cols
            last_cols = (info.unit_x, info.qty_x, info.price_x) if info.unit_x else last_cols
            code = info.header_system
            if system is None or code > system:
                if code != system:
                    system = code
                    name = SYSTEM_RE.search(" ".join(r.text for r in rows if r.y < CONTENT_TOP)).group(2)
                    system_name = re.sub(r"^LA\d+\s+", "", name).strip()
                    systems[system] = {"name": system_name, "lot": lots.get(system, "1"), "first_page": info.page}
                    section, section_name = "", ""
                    start_item("", None, None)
            elif code < system:
                anomalies.append(Anomaly(info.page, "header_system_mismatch",
                                         f"Page header says {code}, but document order places this page in {system}."))
            systems[system]["last_page"] = info.page
        elif info.kind == "component_list":
            if system:
                systems[system]["last_page"] = info.page
            for row in rows:
                text = row.text
                if "Auflistung der" in text:
                    t = text.lower()
                    component_table = ("ducts_rect" if "kanäle" in t else "fittings_rect" if "kanalformst" in t
                                       else "ducts_round" if "rohre" in t else "fittings_round" if "formstücke rund" in t else None)
                    continue
                m = re.match(r"^(\d+)\s+([A-Z][A-Z\-]*)\s+(.+)$", text)
                if component_table and m:
                    tokens = m.group(3).split()
                    dims = []
                    while tokens and re.fullmatch(r"\d+", tokens[-1]):
                        dims.insert(0, float(tokens.pop()))
                    component_rows.append(ComponentRow(info.page, system or "", component_table, float(m.group(1)),
                                                       m.group(2), " ".join(tokens), dims, row.bbox))
            continue
        else:
            continue

        for row in rows:
            if row.y < CONTENT_TOP or row.y > CONTENT_BOTTOM:
                continue
            text = row.text.strip()
            left, right = _split_row(row, info)
            left_text = " ".join(s.text for s in left).strip()
            gap = None if last_row_y is None else row.y - last_row_y
            last_row_y = row.y

            m = SECTION_RE.match(text)
            if m and row.segments[0].x0 < 80:
                section, section_name = m.group(1), m.group(2).title()
                start_item("", None, None)
                continue
            if text.startswith("Total") or SYSTEM_TITLE_RE.match(text):
                start_item("", None, None)
                continue

            qty = _quantity(right, info)
            if qty is None:
                if not left_text:
                    continue
                is_header = (row.bold and left[0].x0 < 100) if use_bold else (
                    (gap is None or gap > 30 or not header) and left[0].x0 < 100 and not item_has_qty and not shared
                ) or (not use_bold and item_has_qty and gap is not None and gap > 30)
                # Inline table header ("Mod. DN Vmin. Vmax.") and its unit row apply to every row below it.
                if left_text.startswith("Mod."):
                    subtable = [left_text]
                elif len(subtable) == 1 and re.match(r"^(cm|mm)\b", left_text):
                    subtable.append(left_text)
                if is_header:
                    # Two headers in a row: the first is a group heading ("Doppelwandige Blechkanäle …").
                    if header and not header.startswith("-") and not item_has_qty and not shared:
                        left_text = f"{header.split(' › ')[0]} › {left_text}"
                    start_item(left_text, info.page, row.bbox)
                elif item_has_qty:
                    local.append(left_text)
                else:
                    shared.append(left_text)
                continue

            unit_raw, quantity = qty
            if left_text:
                local.append(left_text)
            counters[(system, section)] += 1
            line_id = f"{system}-{section or 'X'}-{counters[(system, section)]:03d}"
            flags = []
            if quantity is None:
                flags.append("quantity_missing")
            shared_now = list(shared[:12]) + [t for t in subtable if t not in shared and t not in local]
            sizes = parse_sizes(" | ".join([header, *shared_now, *local]))
            for note in sizes.notes:
                if not any(a.code == "implausible_size" and note in a.message for a in anomalies):
                    anomalies.append(Anomaly(info.page, "implausible_size", f"{line_id}: {note}"))
            lines.append(LVLine(
                line_id=line_id, page=info.page, system=system, system_name=system_name,
                lot=systems[system]["lot"], section=section, section_name=section_name,
                header=header, shared_text=shared_now, local_text=list(local),
                quantity=quantity, unit_raw=unit_raw, unit=normalize_unit(unit_raw),
                row_bbox=row.bbox, header_page=header_page, header_bbox=header_bbox, flags=flags,
            ))
            local = []
            item_has_qty = True

    return ParsedTender(pages=pages, lines=lines, component_rows=component_rows, anomalies=anomalies, systems=systems)
