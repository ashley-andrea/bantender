"""Deterministic segmentation of a Messerli-style LV into priceable lines.

Works on visual rows (see pdf_layer / docling_layer), so different readers can be
compared on the same logic.
"""

from __future__ import annotations

import re
from collections import defaultdict

from .models import Anomaly, ComponentRow, LVLine, PageInfo, ParsedTender, Row, Segment
from .normalize import normalize_unit, parse_number, parse_sizes
from .tender_info import location_for, parse_award, parse_lots, parse_project

CONTENT_TOP = 60.0  # pt: above this are page header and LV column titles
CONTENT_BOTTOM = 785.0  # pt: below this is the file-path footer
DEFAULT_COLUMNS = (365.0, 405.0, 445.0)  # unit, quantity, unit-price column starts

# Page header of an LV page: "<project>  <BKP>.<nn> <system name>  Seite x / y" (any BKP code).
SYSTEM_RE = re.compile(r"\b(\d{3}\.\d{2})\s+(.+?)\s+Seite\s+\d+\s*/\s*\d+", re.I)
SYSTEM_TITLE_RE = re.compile(r"^\d{3}\.\d{2}\b")
SECTION_RE = re.compile(r"^([A-F])\s+([A-ZÄÖÜ][A-ZÄÖÜ ,/\-]+)$")
DOTS_RE = re.compile(r"^[.\s_…]+$")
PARA_GAP = 18.0  # pt: a vertical gap this large starts a new paragraph (rows inside a paragraph are ~12 pt apart)
UNIT_QTY_RE = re.compile(r"^(\S+)\s+(\d[\d'’.,]*)$")
# Rows that describe an item rather than name one (sizes, makes, materials, specs, model codes, references).
ATTRIBUTE_RE = re.compile(
    r"^(grösse|groesse|gr\.|b\s*x\s*h|ø|\d|\.{2,}|_|-|•|fabrikat\b|typ\b|modell?\b|material\b|farbe\b|luftmenge|luftvolumen|länge\b|anschluss\b|"
    r"nachweis\b|druckverlust|für\b|mit\b|aus\b|inkl\b|exkl\b|wie\b|kulissen|spaltbreite|dämpfung|verlängerung|offerte\b|qualitätsstufe|"
    r"ausführung|anzahl|abmessung|leistung|spannung|nenn|ansteuerung|laufzeit|drehmoment|stromabsenkung|konstante|mechanisch|"
    r"ac/dc|ip\d|mod\.|cm\b|mm\b|[A-Z0-9][A-Z0-9\-]*\s+\d)", re.I)


def is_name(text: str) -> bool:
    """A row that names an item: starts with a capital (German nouns do) and is not an attribute, spec or table row."""
    return bool(text) and text[0].isupper() and not ATTRIBUTE_RE.match(text)


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


def _split_row(row: Row, info: PageInfo) -> tuple[list, list]:
    unit_x = (info.unit_x or DEFAULT_COLUMNS[0]) - 12
    segments = []
    for seg in row.segments:
        # A unit printed right after long description text is glued onto it ("… nicht m2", "… Architekten  Stk").
        words = seg.text.rsplit(None, 1)
        if seg.x0 < unit_x < seg.bbox[2] and len(words) == 2 and normalize_unit(words[1]):
            width = seg.bbox[2] - seg.bbox[0]
            cut = seg.bbox[0] + width * len(words[0]) / len(seg.text)
            segments.append(Segment(words[0], (seg.bbox[0], seg.bbox[1], cut, seg.bbox[3]), seg.bold))
            segments.append(Segment(words[1], (max(cut, unit_x), seg.bbox[1], seg.bbox[2], seg.bbox[3]), seg.bold))
        else:
            segments.append(seg)
    left = [s for s in segments if s.x0 < unit_x]
    right = [s for s in segments if s.x0 >= unit_x and not DOTS_RE.match(s.text)]
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
    header_codes = [p.header_system for p in pages if p.header_system]
    project = parse_project(rows_by_page, pages, header_codes)
    lot_info = parse_lots(rows_by_page, pages, project["bkp"])
    lots = lot_info["system_lot"]
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
    local_starts: list[bool] = []  # per local row: does it start a paragraph?
    item_has_qty = False
    last_row_y = None
    last_cols = None
    component_table = None

    subtable: list[str] = []

    def start_item(text, page, bbox):
        nonlocal local_starts, header, header_page, header_bbox, shared, local, item_has_qty, subtable
        if item_has_qty and local and lines:
            lines[-1].trailing_text.extend(local[:40])  # rows after the last quantity row belong to that line
        header, header_page, header_bbox = text, page, bbox
        shared, local, item_has_qty, subtable = [], [], False, []
        local_starts.clear()

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
                    lot = lots.get(system, "1")
                    lot_name = lot_info["lots"].get(lot, {}).get("name")
                    systems[system] = {"name": system_name, "lot": lot, "location": location_for(system_name, lot_name),
                                       "first_page": info.page}
                    section, section_name = "", ""
                    start_item("", None, None)
            elif code < system:
                anomalies.append(Anomaly(info.page, "header_system_mismatch",
                                         f"Page header says {code}, but document order places this page in {system}.",
                                         f"Seitenkopf nennt {code}, gemäss Reihenfolge gehört die Seite zu {system}."))
            systems[system]["last_page"] = info.page
        elif info.kind == "component_list":
            if system:
                systems[system]["last_page"] = info.page
            for row in rows:
                if row.y < CONTENT_TOP:  # page header ("5549 SH Erlenstrasse …") is not a data row
                    continue
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
                section, section_name = m.group(1), m.group(2).title().replace(" Und ", " und ")
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
                # Inside an item that already has quantities, a bold spec line ("AC/DC 24 V, …") is not a new item.
                if is_header and item_has_qty and ATTRIBUTE_RE.match(left_text):
                    is_header = False
                if is_header:
                    # Two headers in a row: the first is a group heading ("Doppelwandige Blechkanäle …").
                    if header and not header.startswith("-") and not item_has_qty and not shared:
                        left_text = f"{header.split(' › ')[0]} › {left_text}"
                    start_item(left_text, info.page, row.bbox)
                elif item_has_qty:
                    local.append(left_text)
                    local_starts.append(gap is None or gap >= PARA_GAP)
                else:
                    shared.append(left_text)
                continue

            unit_raw, quantity = qty
            # Which item does this quantity row price? Two layouts exist:
            #  - attributes first, then a quantity row that is itself an attribute ("Grösse Ø 10 cm  Stk 5");
            #  - a quantity row that names the item ("Kanalrauchmelder  Stk 1"), its specs printed below it.
            # In the second layout the rows since the previous quantity row are that row's specs (trailing text).
            item_title = None
            own_is_name = is_name(left_text)
            starts_paragraph = gap is None or gap >= PARA_GAP
            if item_has_qty:
                if starts_paragraph and own_is_name:
                    # Device layout: a new paragraph opens with the item's name on the quantity row;
                    # the rows since the previous quantity row are that row's specs.
                    if local:
                        lines[-1].trailing_text.extend(local[:40])
                    local = []
                    item_title = left_text
                else:
                    # Attribute layout: the rows of the last paragraph describe this quantity row; rows before that
                    # paragraph still belong to the previous line. The first row that is a name titles the sub-item.
                    start = max((i for i, st in enumerate(local_starts) if st), default=None)
                    if start:
                        lines[-1].trailing_text.extend(local[:start])
                        local = local[start:]
                    item_title = next((r for r in local + [left_text] if is_name(r)), None)
            elif own_is_name and starts_paragraph:
                item_title = left_text
            if left_text:
                local.append(left_text)
            counters[(system, section)] += 1
            line_id = f"{system}-{section or 'X'}-{counters[(system, section)]:03d}"
            flags = []
            if quantity is None:
                flags.append("quantity_missing")
            shared_now = list(shared[:80]) + [t for t in subtable if t not in shared and t not in local]
            sizes = parse_sizes(" | ".join([header, *shared_now, *local]))
            for note in sizes.notes:
                if not any(a.code == "implausible_size" and note in a.message for a in anomalies):
                    anomalies.append(Anomaly(info.page, "implausible_size", f"{line_id}: {note}",
                                             f"{line_id}: " + note.replace("implausible diameter", "unplausibler Durchmesser")))
            lines.append(LVLine(
                line_id=line_id, page=info.page, system=system, system_name=system_name,
                lot=systems[system]["lot"], section=section, section_name=section_name,
                header=header, shared_text=shared_now, local_text=list(local),
                quantity=quantity, unit_raw=unit_raw, unit=normalize_unit(unit_raw),
                row_bbox=row.bbox, header_page=header_page, header_bbox=header_bbox, flags=flags,
                item_title=item_title,
            ))
            local = []
            local_starts.clear()
            item_has_qty = True

    lot_table = lot_info["lots"] or {"1": {"name": None, "systems": []}}
    for code, info_ in systems.items():
        lot_table.setdefault(info_["lot"], {"name": None, "systems": []})
        if code not in lot_table[info_["lot"]]["systems"]:
            lot_table[info_["lot"]]["systems"].append(code)
    return ParsedTender(pages=pages, lines=lines, component_rows=component_rows,
                        anomalies=_merge_header_flags(anomalies, systems), systems=systems,
                        project=project, lots=lot_table, award=parse_award(rows_by_page, pages))


def _merge_header_flags(anomalies: list[Anomaly], systems: dict) -> list[Anomaly]:
    """Collapse per-page header mismatches into one flag per run of pages."""
    pages = sorted(a.page for a in anomalies if a.code == "header_system_mismatch")
    others = [a for a in anomalies if a.code != "header_system_mismatch"]
    if not pages:
        return others
    by_page = {a.page: a for a in anomalies if a.code == "header_system_mismatch"}
    merged, start = [], pages[0]
    for prev, cur in zip(pages, pages[1:] + [None]):
        if cur is not None and cur - prev <= 3:  # component-list pages in between keep the run together
            continue
        said, actual = re.findall(r"\d{3}\.\d{2}", by_page[start].message)[:2]
        name = systems.get(actual, {}).get("name", "")
        merged.append(Anomaly(start, "header_system_mismatch",
                              f"Pages {start}–{prev}: page headers say {said}, but document order places them in {actual} {name}. "
                              f"Lines are assigned to {actual}.",
                              f"Seiten {start}–{prev}: Seitenkopf nennt {said}, gemäss Reihenfolge gehören sie zu {actual} {name}. "
                              f"Die Positionen werden {actual} zugeordnet."))
        if cur is not None:
            start = cur
    return merged + others
