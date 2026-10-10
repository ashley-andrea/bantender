"""Search index over the tender text: the parser's printed rows grouped into small chunks; every page keeps its boxes.

Retrieval is hybrid: BM25 on words (exact terms, numbers, article references) and, when an embedder is given,
cosine similarity on embeddings (meaning across German and English). The two rankings are merged by reciprocal rank.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from app.parsing.pdf_layer import read_rows

INDEX_VERSION = "2"
CHUNK_CHARS = 900  # rows are added to a chunk until it is about this long
OVERLAP_ROWS = 2  # the last rows of a chunk open the next one, so a fact on a boundary is whole in one of them


class Embed(Protocol):
    model: str

    def __call__(self, texts: list[str]) -> list[list[float]]: ...


@dataclass
class TextBox:
    """One printed segment of a row (the parser's Segment): rows of two-column pages hold one per column."""
    text: str
    bbox: tuple[float, float, float, float]
    row: int  # row number on the page


@dataclass
class Chunk:
    id: str  # "p<page>.<n>"
    page: int
    heading: str  # page header and the last bold row before the chunk: what the text is about
    text: str


def page_text(boxes: list[TextBox]) -> str:
    """The page as printed, one line per row."""
    lines: dict[int, list[str]] = {}
    for b in boxes:
        lines.setdefault(b.row, []).append(b.text)
    return "\n".join(" ".join(parts) for parts in lines.values())


WORD_RE = re.compile(r"\w+", re.UNICODE)
HYPHEN_BREAK_RE = re.compile(r"(\w)-\n(\w)")


def tokens(text: str) -> list[str]:
    """Words, lowercased, with line-break hyphens joined; long words also add a 6-letter stem (German inflection)."""
    words = WORD_RE.findall(HYPHEN_BREAK_RE.sub(r"\1\2", text).lower())
    return words + [w[:6] for w in words if len(w) > 6 and not w.isdigit()]


class TenderIndex:
    def __init__(self, chunks: list[Chunk], pages: dict[int, list[TextBox]], vectors: list[list[float]] | None = None,
                 embedding_model: str | None = None):
        self.chunks = chunks
        self.pages = pages
        self.vectors = vectors
        self.embedding_model = embedding_model
        self._docs = [tokens(f"{c.heading}\n{c.text}") for c in chunks]
        self._tf = [Counter(d) for d in self._docs]
        self._avg = sum(map(len, self._docs)) / max(1, len(self._docs))
        df = Counter(t for d in self._docs for t in set(d))
        n = len(self._docs)
        self._idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    # ---- build / store ------------------------------------------------------------------------

    @classmethod
    def build(cls, pdf_path: Path, embed: Embed | None = None) -> TenderIndex:
        rows_by_page, _ = read_rows(pdf_path)
        pages = {p: [TextBox(s.text, s.bbox, i) for i, row in enumerate(rows) for s in row.segments] for p, rows in rows_by_page.items()}
        chunks: list[Chunk] = []
        heading = ""
        for page, rows in rows_by_page.items():
            header = rows[0].text if rows else ""
            current: list[str] = []
            n, chunk_heading = 0, heading
            for row in rows:
                if row.bold and len(row.text) < 120:
                    heading = row.text
                current.append(row.text)
                if sum(len(t) + 1 for t in current) >= CHUNK_CHARS:
                    chunks.append(Chunk(f"p{page}.{n}", page, _heading(header, chunk_heading), "\n".join(current)))
                    n += 1
                    current = current[-OVERLAP_ROWS:]
                    chunk_heading = heading
            if current and (n == 0 or len(current) > OVERLAP_ROWS):
                chunks.append(Chunk(f"p{page}.{n}", page, _heading(header, chunk_heading), "\n".join(current)))
        index = cls(chunks, pages)
        if embed:
            index.vectors = _normalise(embed([f"{c.heading}\n{c.text}" for c in chunks]))
            index.embedding_model = embed.model
        return index

    def to_dict(self) -> dict:
        return {"version": INDEX_VERSION, "embedding_model": self.embedding_model,
                "chunks": [asdict(c) for c in self.chunks],
                "pages": {str(p): [asdict(b) for b in boxes] for p, boxes in self.pages.items()},
                "vectors": self.vectors}

    @classmethod
    def from_dict(cls, d: dict) -> TenderIndex:
        chunks = [Chunk(**c) for c in d["chunks"]]
        pages = {int(p): [TextBox(b["text"], tuple(b["bbox"]), b["row"]) for b in boxes] for p, boxes in d["pages"].items()}
        return cls(chunks, pages, d.get("vectors"), d.get("embedding_model"))

    # ---- search -------------------------------------------------------------------------------

    def bm25(self, query: str, k1: float = 1.4, b: float = 0.75) -> list[tuple[float, int]]:
        q = set(tokens(query))
        scores = []
        for i, (tf, doc) in enumerate(zip(self._tf, self._docs)):
            s = 0.0
            for t in q:
                f = tf.get(t)
                if f:
                    s += self._idf[t] * f * (k1 + 1) / (f + k1 * (1 - b + b * len(doc) / self._avg))
            if s > 0:
                scores.append((s, i))
        return sorted(scores, reverse=True)

    def dense(self, query_vector: list[float]) -> list[tuple[float, int]]:
        q = _normalise([query_vector])[0]
        return sorted(((sum(a * b for a, b in zip(q, v)), i) for i, v in enumerate(self.vectors or [])), reverse=True)

    def search(self, query: str, k: int = 6, embed: Embed | None = None, rrf_k: int = 60) -> list[Chunk]:
        rankings = [self.bm25(query)[:50]]
        if embed and self.vectors and embed.model == self.embedding_model:
            rankings.append(self.dense(embed([query])[0])[:50])
        fused: Counter = Counter()
        for ranking in rankings:
            for rank, (_, i) in enumerate(ranking):
                fused[i] += 1 / (rrf_k + rank)
        return [self.chunks[i] for i, _ in fused.most_common(k)]


def _heading(header: str, heading: str) -> str:
    return header if not heading or heading == header else f"{header} · {heading}"


def _normalise(vectors: list[list[float]]) -> list[list[float]]:
    out = []
    for v in vectors:
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        out.append([x / n for x in v])
    return out
