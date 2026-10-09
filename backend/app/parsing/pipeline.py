"""Tender parsing pipeline.

PyMuPDF is the primary reader for LV lines and component lists: on the Oberglatt tender it finds
22/22 verified examples and 468 component rows (an independent pdftotext count gives 469), while
Docling's table model finds 396 (see benchmarks/results). Docling runs as an independent cross-check:
pages where the two readers disagree are flagged, and Docling's figures are kept for the viewer.
It is also the route for scanned or unfamiliar layouts.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from .lv_segment import segment
from .models import Anomaly, ParsedTender
from .pdf_layer import read_rows

log = logging.getLogger(__name__)


def parse_tender(pdf_path: Path, *, docling_tables: bool = False, docling_mode: str = "tables_accurate",
                 cache_dir: Path | None = None) -> tuple[ParsedTender, dict]:
    """Return the parsed tender plus run metadata (which readers were used, figures found)."""
    rows, sizes = read_rows(pdf_path)
    tender = segment(rows, use_bold=True)
    meta = {"pages": len(rows), "lv_reader": "pymupdf", "component_reader": "pymupdf", "figures": []}

    if docling_tables:
        try:
            from . import docling_layer

            pages = [p.page for p in tender.pages if p.kind in ("component_list", "lv")]
            doc = docling_layer.convert(pdf_path, docling_mode, (min(pages), max(pages)), cache_dir)
            page_system = {r.page: r.system for r in tender.component_rows}
            docling_rows = docling_layer.component_rows_from_doc(doc, page_system)
            mine, theirs = Counter(r.page for r in tender.component_rows), Counter(r.page for r in docling_rows)
            for page in sorted(set(mine) | set(theirs)):
                if mine[page] != theirs[page]:
                    tender.anomalies.append(Anomaly(page, "reader_disagreement",
                        f"Component list: PyMuPDF read {mine[page]} rows, Docling {theirs[page]}. Check this page."))
            meta["cross_check"] = f"docling:{docling_mode}"
            meta["figures"] = docling_layer.figures(doc)
        except Exception:  # Docling is an enhancement; the deterministic path always works.
            log.exception("Docling conversion failed; using PyMuPDF component lists")

    meta["page_sizes"] = {p: s for p, s in sizes.items()}
    return tender, meta


def tender_to_dict(tender: ParsedTender, meta: dict) -> dict:
    lines = []
    for line in tender.lines:
        d = asdict(line)
        d["description"] = line.description
        lines.append(d)
    return {
        "meta": meta,
        "systems": tender.systems,
        "pages": [asdict(p) for p in tender.pages],
        "lines": lines,
        "component_rows": [asdict(r) for r in tender.component_rows],
        "anomalies": [asdict(a) for a in tender.anomalies],
    }
