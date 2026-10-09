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
from .normalize import parse_sizes, size_key
from .pdf_layer import read_rows

# Bump when parsing output changes: stored results with an older version are re-parsed on upload.
PARSER_VERSION = "2026.10.10-2"


def parse_tender(pdf_path: Path) -> tuple[ParsedTender, dict]:
    """Deterministic parse (~1 s). Returns the parsed tender plus run metadata."""
    rows, sizes = read_rows(pdf_path)
    tender = segment(rows, use_bold=True)
    meta = {"parser_version": PARSER_VERSION, "pages": len(rows), "lv_reader": "pymupdf", "component_reader": "pymupdf", "figures": [],
            "page_sizes": {p: s for p, s in sizes.items()}}
    return tender, meta


def docling_cross_check(pdf_path: Path, parsed: dict, mode: str = "tables_accurate", cache_dir: Path | None = None) -> dict:
    """Read the component lists again with Docling and compare row counts per page.

    Returns a separate result ({meta, anomalies}) that is stored next to the parse and merged on read,
    so a slow cross-check can never overwrite a newer parse. Requires the optional `docling` extra.
    """
    from . import docling_layer

    pages = [p["page"] for p in parsed["pages"] if p["kind"] in ("component_list", "lv")]
    doc = docling_layer.convert(pdf_path, mode, (min(pages), max(pages)), cache_dir)
    page_system = {r["page"]: r["system"] for r in parsed["component_rows"]}
    docling_rows = docling_layer.component_rows_from_doc(doc, page_system)
    mine = Counter(r["page"] for r in parsed["component_rows"])
    theirs = Counter(r.page for r in docling_rows)
    differ = [p for p in sorted(set(mine) | set(theirs)) if mine[p] != theirs[p]]
    anomalies = []
    if differ:
        detail = ", ".join(f"p.{p} {mine[p]} vs {theirs[p]}" for p in differ)
        anomalies.append({"page": differ[0], "code": "reader_disagreement",
                          "message": f"Component lists: PyMuPDF and Docling read different row counts on {len(differ)} page(s) "
                                     f"({detail}). PyMuPDF is used; check these pages."})
    return {
        "parser_version": parsed["meta"].get("parser_version"),
        "meta": {"cross_check": f"docling:{mode}", "figures": docling_layer.figures(doc)},
        "anomalies": anomalies,
    }


def tender_to_dict(tender: ParsedTender, meta: dict) -> dict:
    lines = []
    for line in tender.lines:
        d = asdict(line)
        d["description"] = line.description
        sizes = parse_sizes(line.description)
        d["sizes"] = {k: v for k, v in asdict(sizes).items() if v not in (None, ())}
        d["size_key"] = size_key(sizes)
        lines.append(d)
    return {
        "meta": meta,
        "systems": tender.systems,
        "pages": [asdict(p) for p in tender.pages],
        "lines": lines,
        "component_rows": [asdict(r) for r in tender.component_rows],
        "anomalies": [asdict(a) for a in tender.anomalies],
    }
