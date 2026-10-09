"""Tender parsing pipeline.

PyMuPDF is the primary reader for LV lines and component lists: on the Oberglatt tender it finds
22/22 verified examples and 468 component rows (an independent pdftotext count gives 469), while
Docling's table model finds 396 (see benchmarks/results). Docling is an optional, separate
cross-check (`app.cli crosscheck`, own container): pages where the two readers disagree are flagged
and Docling's figures are kept for the viewer. It is also the route for scanned or unfamiliar layouts.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import asdict
from pathlib import Path

from .lv_segment import segment
from .models import ParsedTender
from .pdf_layer import read_rows


def parse_tender(pdf_path: Path) -> tuple[ParsedTender, dict]:
    """Deterministic parse (~1 s). Returns the parsed tender plus run metadata."""
    rows, sizes = read_rows(pdf_path)
    tender = segment(rows, use_bold=True)
    meta = {"pages": len(rows), "lv_reader": "pymupdf", "component_reader": "pymupdf", "figures": [],
            "page_sizes": {p: s for p, s in sizes.items()}}
    return tender, meta


def docling_cross_check(pdf_path: Path, parsed: dict, mode: str = "tables_accurate", cache_dir: Path | None = None) -> dict:
    """Compare component-list rows with Docling's reading; add disagreement flags and figures to `parsed`.

    Requires the optional `docling` extra.
    """
    from . import docling_layer

    pages = [p["page"] for p in parsed["pages"] if p["kind"] in ("component_list", "lv")]
    doc = docling_layer.convert(pdf_path, mode, (min(pages), max(pages)), cache_dir)
    page_system = {r["page"]: r["system"] for r in parsed["component_rows"]}
    docling_rows = docling_layer.component_rows_from_doc(doc, page_system)
    mine = Counter(r["page"] for r in parsed["component_rows"])
    theirs = Counter(r.page for r in docling_rows)
    parsed["anomalies"] = [a for a in parsed["anomalies"] if a["code"] != "reader_disagreement"]
    for page in sorted(set(mine) | set(theirs)):
        if mine[page] != theirs[page]:
            parsed["anomalies"].append({"page": page, "code": "reader_disagreement",
                                        "message": f"Component list: PyMuPDF read {mine[page]} rows, Docling {theirs[page]}. Check this page."})
    parsed["meta"]["cross_check"] = f"docling:{mode}"
    parsed["meta"]["figures"] = docling_layer.figures(doc)
    return parsed


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
