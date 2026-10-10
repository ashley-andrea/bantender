"""Tender parsing pipeline: PyMuPDF text layer → page classification → LV segmentation → normalisation.

Deterministic and about one second per tender. Why PyMuPDF only: see docs/parser-benchmark.md
(it found 22/22 verified examples and every component-list row; Docling's table model did not).
"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from .lv_segment import segment
from .models import ParsedTender, SrcText
from .normalize import parse_sizes, size_key
from .pdf_layer import read_rows

# Bump when parsing output changes: stored results with an older version are re-parsed on upload.
PARSER_VERSION = "2026.10.10-9"


def parse_tender(pdf_path: Path) -> tuple[ParsedTender, dict]:
    """Deterministic parse (~1 s). Returns the parsed tender plus run metadata."""
    rows, sizes = read_rows(pdf_path)
    tender = segment(rows, use_bold=True)
    meta = {"parser_version": PARSER_VERSION, "pages": len(rows),
            "page_sizes": {p: s for p, s in sizes.items()}}
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
                 "page": line.page, "bbox": line.row_bbox})
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
        lines.append(d)
    return {
        "meta": meta,
        "project": tender.project,
        "lots": tender.lots,
        "award": tender.award,
        "systems": tender.systems,
        "pages": [asdict(p) for p in tender.pages],
        "lines": lines,
        "component_rows": [asdict(r) for r in tender.component_rows],
        "anomalies": [asdict(a) for a in tender.anomalies],
    }
