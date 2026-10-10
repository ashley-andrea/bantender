"""Grounding: an answer is shown only as far as its quotes can be found, word for word, in the sources it cites.

The model returns statements, each with (source id, quote) pairs. Here, outside the model, every quote is looked up
in the source text. A statement with no quote that checks out is removed. The quotes that check out are located on
the page (segment boxes) so the viewer can outline them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .index import TextBox, page_text

MIN_QUOTE_CHARS = 4  # letters/digits; shorter quotes ("8", "inkl") prove nothing
CONTEXT_ROWS = 4  # rows above and below a quote that the support check reads with it
CONTEXT_CHARS = 3000


@dataclass
class Source:
    id: str  # "p9" (tender page), "bid", "pos:<line id>", "d1" (a company-data query result)
    kind: str  # tender | bid | position | data
    label: str
    text: str
    page: int | None = None
    boxes: list[TextBox] = field(default_factory=list)  # tender pages: the printed segments, for outlines
    line_id: str | None = None
    # Where the source is shown in the tool: the step ("price"), and for single lines (by index in `text`) the element
    # there, as (key, "step#anchor") pairs ("#anchor": on the step in view): the first pair whose key is in the quote wins; an empty key matches any quote.
    step: str | None = None
    anchors: dict[int, list[tuple[str, str]]] = field(default_factory=dict)


def skeleton(text: str) -> str:
    """Letters and digits only, lowercased: quotes match across line breaks, hyphenation, spacing and quote marks."""
    return re.sub(r"[\W_]+", "", text.lower())


COLUMN_GAP = 40.0  # pt: segments whose left edges are further apart than this are in different columns


def reading_orders(boxes: list[TextBox]) -> list[list[TextBox]]:
    """Row by row (as the model reads the page), then column by column (two-column condition pages)."""
    lefts = sorted({round(b.bbox[0]) for b in boxes})
    starts = [x for i, x in enumerate(lefts) if i == 0 or x - lefts[i - 1] > COLUMN_GAP]
    column = lambda b: sum(round(b.bbox[0]) >= s for s in starts)  # noqa: E731
    by_column = sorted(boxes, key=lambda b: (column(b), b.row, b.bbox[0]))
    return [boxes, by_column] if len(starts) > 1 else [boxes]


def find_quote(quote: str, source: Source) -> list[TextBox] | None:
    """The segments the quote spans if it is in the source (an empty list for sources without boxes), else None."""
    q = skeleton(quote)
    if len(q) < MIN_QUOTE_CHARS:
        return None
    if not source.boxes:
        return [] if q in skeleton(source.text) else None
    for order in reading_orders(source.boxes):
        starts, joined = [], ""
        for box in order:
            starts.append(len(joined))
            joined += skeleton(box.text)
        at = joined.find(q)
        if at >= 0:
            end = at + len(q)
            return [b for b, s, nxt in zip(order, starts, starts[1:] + [len(joined)]) if s < end and nxt > at]
    return None


def quote_lines(text: str, quote: str) -> list[int]:
    """Indexes of the lines of `text` that the quote spans (empty if it is not there)."""
    starts, joined = [], ""
    for line in text.splitlines():
        starts.append(len(joined))
        joined += skeleton(line)
    q = skeleton(quote)
    at = joined.find(q) if q else -1
    if at < 0:
        return []
    return [i for i, s in enumerate(starts) if s < at + len(q) and (starts[i + 1] if i + 1 < len(starts) else len(joined)) > at]


def target(source: Source, quote: str) -> tuple[str | None, str | None]:
    """The step and the element of the tool where the quoted line is shown (anchor None: the step only)."""
    q = skeleton(quote)
    for i in quote_lines(source.text, quote):
        for key, where in source.anchors.get(i, []):
            if skeleton(key) in q:
                step, _, anchor = where.partition("#")
                return step or source.step, anchor or None
    return source.step, None


def context(source: Source, boxes: list[TextBox], quote: str = "") -> str:
    """The quote with the rows around it (tender pages), or the source itself (bid, positions, data results);
    for a long source, its first lines and the lines around the quote."""
    if not boxes:
        if len(source.text) <= CONTEXT_CHARS:
            return source.text
        lines = source.text.splitlines()
        hit = quote_lines(source.text, quote)
        if not hit:
            return source.text[:CONTEXT_CHARS]
        lo, hi = max(0, hit[0] - CONTEXT_ROWS), hit[-1] + CONTEXT_ROWS + 1
        return "\n".join(lines[:2] + (["…"] if lo > 2 else []) + lines[max(lo, 2):hi])
    lo, hi = min(b.row for b in boxes) - CONTEXT_ROWS, max(b.row for b in boxes) + CONTEXT_ROWS
    return page_text([b for b in source.boxes if lo <= b.row <= hi])


NO_PROOF = {
    "en": "I could not find this in the tender or our data with a quote I can show you, so I won't guess.",
    "de": "Dazu finde ich in der Ausschreibung oder unseren Daten keine Stelle, die ich belegen kann. Ich rate nicht.",
}
DIGITS_RE = re.compile(r"\d")


def ground(raw: dict, sources: dict[str, Source], lang: str) -> dict:
    """Check every quote; keep statements with at least one verified quote; number the citations in order of use.

    Citations carry the passage around their quote ("context") for the support check; it is not sent to the browser.
    """
    citations: list[dict] = []
    keys: dict[tuple[str, str], int] = {}
    statements, dropped = [], []
    for claim in raw.get("claims", []):
        refs = []
        for c in claim.get("citations", []):
            source = sources.get(c.get("source", ""))
            quote = (c.get("quote") or "").strip()
            boxes = find_quote(quote, source) if source else None
            if boxes is None:
                continue
            key = (source.id, skeleton(quote))
            if key not in keys:
                keys[key] = len(citations) + 1
                step, anchor = target(source, quote)
                citations.append({
                    "n": keys[key], "kind": source.kind, "source": source.id, "label": source.label, "quote": quote,
                    "page": source.page, "line_id": source.line_id, "step": step, "anchor": anchor,
                    "bboxes": [list(b.bbox) for b in boxes], "context": context(source, boxes, quote),
                })
            if keys[key] not in refs:
                refs.append(keys[key])
        if refs:
            statements.append({"text": claim.get("text", "").strip(), "refs": refs})
        elif claim.get("text"):
            dropped.append(claim["text"])

    status = raw.get("status", "not_found")
    message = (raw.get("message") or "").strip()
    if status == "answered" and not statements:
        status, message = "not_found", NO_PROOF[lang]
    if status != "answered":
        statements, citations = [], []
        # A reply without sources may greet or ask back, never state facts: a figure there could not be checked.
        if not message or DIGITS_RE.search(message):
            message = NO_PROOF[lang]
    return {"status": status, "message": message, "statements": statements, "citations": citations,
            "unverified": len(dropped)}
