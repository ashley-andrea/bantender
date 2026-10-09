"""PyMuPDF word layer: visual rows with exact boxes and bold flags."""

from __future__ import annotations

import re
from pathlib import Path

import pymupdf

from .models import Row, Segment

ROW_TOLERANCE = 3.0  # pt: spans whose vertical centres differ less than this share a row
SEGMENT_GAP = 6.0  # pt: horizontal gap that separates two segments on one row


def _is_bold(span: dict) -> bool:
    return bool(span["flags"] & 16) or "bold" in span["font"].lower()


PRIVATE_USE_RE = re.compile("[\ue000-\uf8ff]")


def clean_text(text: str) -> str:
    return PRIVATE_USE_RE.sub("", text)


def rows_from_spans(page_no: int, spans: list[tuple]) -> list[Row]:
    """Group (text, bbox, bold[, size]) spans into visual rows, then split rows into segments at column gaps.

    A span much smaller than its left neighbour (a superscript such as the 2 in m²) is joined without a space.
    """
    spans = sorted(spans, key=lambda s: ((s[1][1] + s[1][3]) / 2, s[1][0]))
    rows: list[list[tuple[str, tuple, bool]]] = []
    for span in spans:
        cy = (span[1][1] + span[1][3]) / 2
        if rows and abs(cy - (rows[-1][0][1][1] + rows[-1][0][1][3]) / 2) <= ROW_TOLERANCE:
            rows[-1].append(span)
        else:
            rows.append([span])

    out = []
    for group in rows:
        group.sort(key=lambda s: s[1][0])
        segments: list[Segment] = []
        last_size = None
        for span in group:
            text, bbox, bold = clean_text(span[0]), span[1], span[2]
            size = span[3] if len(span) > 3 else None
            superscript = size is not None and last_size is not None and size < 0.8 * last_size
            if segments and bbox[0] - segments[-1].bbox[2] < SEGMENT_GAP:
                last = segments[-1]
                sep = "" if superscript or text.startswith(" ") or last.text.endswith(" ") else " "
                last.text = (last.text + sep + text).strip()
                last.bbox = (last.bbox[0], min(last.bbox[1], bbox[1]), bbox[2], max(last.bbox[3], bbox[3]))
                last.bold = last.bold and bold
            else:
                segments.append(Segment(text.strip(), tuple(bbox), bold))
            if not superscript:
                last_size = size
        segments = [s for s in segments if s.text]
        if segments:
            y = min(s.bbox[1] for s in segments)
            out.append(Row(page=page_no, y=y, segments=segments))
    return out


def read_rows(pdf_path: Path) -> tuple[dict[int, list[Row]], dict[int, tuple[float, float]]]:
    """Return rows per 1-based page and page sizes (width, height)."""
    doc = pymupdf.open(pdf_path)
    rows, sizes = {}, {}
    for index, page in enumerate(doc):
        spans = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    if span["text"].strip():
                        spans.append((span["text"], tuple(span["bbox"]), _is_bold(span), span["size"]))
        rows[index + 1] = rows_from_spans(index + 1, spans)
        sizes[index + 1] = (page.rect.width, page.rect.height)
    return rows, sizes
