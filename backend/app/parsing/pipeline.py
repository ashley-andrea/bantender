"""Tender parsing pipeline: PyMuPDF text layer → page classification → LV segmentation → normalisation.

Deterministic and about one second per tender. Why PyMuPDF only: see docs/parser-benchmark.md
(it found 22/22 verified examples and every component-list row; Docling's table model did not).
"""

from __future__ import annotations

import time
from dataclasses import asdict
from pathlib import Path

from app.matching.text import translate

from .lv_segment import segment
from .models import ParsedTender, SrcText
from .normalize import parse_sizes, size_key
from .pdf_layer import read_rows

# Bump when parsing output changes: stored results with an older version are re-parsed on upload.
PARSER_VERSION = "2026.10.10-11"


def parse_tender(pdf_path: Path) -> tuple[ParsedTender, dict]:
    """Deterministic parse (~1 s). Returns the parsed tender plus run metadata."""
    started = time.perf_counter()
    rows, sizes = read_rows(pdf_path)
    tender = segment(rows, use_bold=True)
    meta = {"parser_version": PARSER_VERSION, "pages": len(rows),
            "page_sizes": {p: s for p, s in sizes.items()}, "parse_seconds": round(time.perf_counter() - started, 2)}
    return tender, meta


def source_rows(line) -> list[dict]:
    """Every printed row that makes up a line, with its role, page and box (for highlighting in the viewer)."""
    rows = []
    if line.header and line.header_bbox:
        rows.append({"role": "header", "text": line.header, "page": line.header_page, "bbox": line.header_bbox})
    for role, texts in (("attribute", line.shared_text), ("own", line.local_text), ("detail", line.trailing_text)):
        for t in texts:
            if isinstance(t, SrcText):
                rows.append({"role": role, "text": str(t), "page": t.page, "bbox": t.bbox})
    rows.append({"role": "quantity", "text": f"{line.unit_raw} {'' if line.quantity is None else f'{line.quantity:g}'}".strip(),
                 "page": line.page, "bbox": line.qty_bbox or line.row_bbox})
    for role, src in (("system", line.system_src), ("section", line.section_src)):
        if src:
            rows.append({"role": role, **src})
    return rows


def tender_to_dict(tender: ParsedTender, meta: dict) -> dict:
    lines = []
    for line in tender.lines:
        rows = source_rows(line)
        d = asdict(line)
        d["rows"] = rows
        d["description"] = line.description
        sizes = parse_sizes(line.description)
        d["sizes"] = {k: v for k, v in asdict(sizes).items() if v not in (None, ())}
        d["size_key"] = size_key(sizes)
        d["section_name_en"] = translate(line.section_name) if line.section_name else ""
        lines.append(d)
    systems = {code: {**info, "name_en": translate(info["name"])} for code, info in tender.systems.items()}
    lots = {n: {**lot, "name_en": translate(lot["name"]) if lot.get("name") else None} for n, lot in tender.lots.items()}
    return {
        "meta": meta,
        "project": tender.project,
        "lots": lots,
        "award": tender.award,
        "conditions": tender.conditions,
        "systems": systems,
        "pages": [asdict(p) for p in tender.pages],
        "lines": lines,
        "component_rows": [asdict(r) for r in tender.component_rows],
        "anomalies": [asdict(a) for a in tender.anomalies],
    }
