"""Docling layer: layout regions, table structure and figures.

Docling runs locally (no API cost). Conversions are cached as DoclingDocument JSON
keyed by file hash + options, so a tender is converted once.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from .models import ComponentRow, Row
from .pdf_layer import rows_from_spans

MODES = {
    # name: (do_table_structure, tableformer_mode, do_ocr)
    "text": (False, None, False),
    "tables_fast": (True, "fast", False),
    "tables_accurate": (True, "accurate", False),
    "tables_accurate_ocr": (True, "accurate", True),
}


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def convert(pdf_path: Path, mode: str = "tables_accurate", page_range: tuple[int, int] | None = None,
            cache_dir: Path | None = None):
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.types.doc import DoclingDocument

    cache = None
    if cache_dir:
        pr = f"{page_range[0]}-{page_range[1]}" if page_range else "all"
        cache = cache_dir / f"{file_hash(pdf_path)}_{mode}_{pr}.json"
        if cache.exists():
            return DoclingDocument.model_validate(json.loads(cache.read_text()))

    tables, tf_mode, ocr = MODES[mode]
    opts = PdfPipelineOptions(do_ocr=ocr, do_table_structure=tables)
    if tables:
        opts.table_structure_options.mode = TableFormerMode.ACCURATE if tf_mode == "accurate" else TableFormerMode.FAST
    converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
    kwargs = {"page_range": page_range} if page_range else {}
    doc = converter.convert(str(pdf_path), **kwargs).document
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(doc.export_to_dict()))
    return doc


def _top_left(prov, doc) -> tuple[float, float, float, float]:
    height = doc.pages[prov.page_no].size.height
    b = prov.bbox.to_top_left_origin(page_height=height)
    return (b.l, b.t, b.r, b.b)


def rows_from_doc(doc) -> dict[int, list[Row]]:
    """Docling text items → visual rows. Bold is approximated by Docling's section-header label."""
    from docling_core.types.doc import ContentLayer

    spans: dict[int, list] = {}
    layers = {ContentLayer.BODY, ContentLayer.FURNITURE}  # page headers carry the system code
    for item, _level in doc.iterate_items(included_content_layers=layers):
        if not getattr(item, "prov", None):
            continue
        label = str(getattr(item, "label", ""))
        if label.endswith("picture"):
            continue
        if label.endswith("table"):
            # Text the table model captured: one span per cell, with the cell's own box.
            page = item.prov[0].page_no
            height = doc.pages[page].size.height
            for cell in item.data.table_cells:
                if cell.bbox is not None and cell.text.strip():
                    b = cell.bbox.to_top_left_origin(page_height=height)
                    spans.setdefault(page, []).append((cell.text, (b.l, b.t, b.r, b.b), False))
            continue
        text = getattr(item, "text", "")
        if not text.strip():
            continue
        bold = str(item.label).endswith("section_header") or str(item.label).endswith("title")
        for prov in item.prov:
            spans.setdefault(prov.page_no, []).append((text, _top_left(prov, doc), bold))
    return {page: rows_from_spans(page, s) for page, s in spans.items()}


TABLE_TITLES = {
    "kanäle": "ducts_rect", "kanalformst": "fittings_rect", "rohre": "ducts_round", "formstücke rund": "fittings_round",
}


def component_rows_from_doc(doc, page_system: dict[int, str]) -> list[ComponentRow]:
    """Parse component-list tables (Bauteilliste) from Docling's table structure."""
    out = []
    for item, _level in doc.iterate_items():
        if str(getattr(item, "label", "")) not in ("table", "DocItemLabel.TABLE") or not item.prov:
            continue
        page = item.prov[0].page_no
        if page not in page_system:
            continue
        df = item.export_to_dataframe(doc)
        header = " ".join(str(c) for c in df.columns).lower()
        table = next((v for k, v in TABLE_TITLES.items() if k in header), None)
        if table is None:
            continue
        for _, values in df.iterrows():
            text = " ".join(str(v) for v in values if str(v).strip() and str(v) != "nan")
            m = re.match(r"^(\d+)\s+([A-Z][A-Z\-]*)\s+(.+)$", text)
            if not m:
                continue
            tokens = m.group(3).split()
            dims = []
            while tokens and re.fullmatch(r"\d+", tokens[-1]):
                dims.insert(0, float(tokens.pop()))
            out.append(ComponentRow(page, page_system[page], table, float(m.group(1)), m.group(2), " ".join(tokens), dims))
    return out


def figures(doc) -> list[dict]:
    """Pictures / vector drawings with page and box, for the viewer (never priced)."""
    out = []
    for item, _level in doc.iterate_items():
        if str(getattr(item, "label", "")).endswith("picture") and item.prov:
            out.append({"page": item.prov[0].page_no, "bbox": _top_left(item.prov[0], doc)})
    return out
