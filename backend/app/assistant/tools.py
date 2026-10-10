"""What the model can look at. Each tool result is registered as a source, so the answer can only quote what it saw."""

from __future__ import annotations

import json
from typing import Callable

from .company_data import FUNCS, OPS, CompanyData
from .grounding import Source
from .index import Embed, TenderIndex, page_text

SEARCH_HITS = 6
MAX_CALLS = 10  # tool calls per question: enough to cross-check, short enough to answer in seconds
MAX_POSITIONS = 12


def _fn(name: str, description: str, properties: dict) -> dict:
    """A strict function tool: every property is required (optional ones allow null)."""
    return {"type": "function", "name": name, "description": description, "strict": True,
            "parameters": {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}}


NULLABLE_STR = {"type": ["string", "null"]}

DEFINITIONS = [
    _fn("search_tender", "Search the tender document (German, ~200 pages). Returns the best matching passages with their page source id. "
        "Search in German with the tender's own terms; search again with other words if the passages do not answer the question.",
        {"query": {"type": "string"}}),
    _fn("read_tender_page", "Read one whole tender page (e.g. to see a full table or the context around a passage).",
        {"page": {"type": "integer"}}),
    _fn("bid_summary", "Our current offer for this tender as calculated in the tool: offer price, cost build-up with formulas, "
        "positions priced and open, conditions.", {}),
    _fn("bid_positions", "Positions of our offer with quantity, catalogue product, costs and status. Pass a line id for one position "
        "with its full calculation, or words to find positions (title, product id).", {"query": {"type": "string"}}),
    _fn("query_company_data", "Query the company's own data files (listed in the instructions): filter rows, list columns, or group "
        "and aggregate (count, sum, mean, min, max). For a JSON file, only `file` is used and the whole document is returned.",
        {"file": {"type": "string"},
         "where": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["column", "op", "value"],
                   "properties": {"column": {"type": "string"}, "op": {"type": "string", "enum": list(OPS)}, "value": {"type": "string"}}}},
         "columns": {"type": "array", "items": {"type": "string"}},
         "group_by": {"type": "array", "items": {"type": "string"}},
         "metrics": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["fn", "column"],
                     "properties": {"fn": {"type": "string", "enum": list(FUNCS)}, "column": NULLABLE_STR}}},
         "sort_by": NULLABLE_STR, "descending": {"type": "boolean"}, "limit": {"type": "integer"}}),
]


class Toolbox:
    """Runs tool calls for one question and keeps every source shown to the model."""

    def __init__(self, index: TenderIndex, pricing: Callable[[], dict], data: CompanyData, embed: Embed | None = None):
        self.index = index
        self._pricing_fn = pricing
        self._pricing: dict | None = None
        self.data = data
        self.embed = embed
        self.sources: dict[str, Source] = {}
        self.calls = 0

    @property
    def pricing(self) -> dict:
        if self._pricing is None:
            self._pricing = self._pricing_fn()
        return self._pricing

    def call(self, name: str, args: dict) -> str:
        self.calls += 1
        if self.calls > MAX_CALLS:
            return "Limit of look-ups for this question reached: answer now with what the sources above show."
        try:
            return getattr(self, name)(**args)
        except (TypeError, ValueError, KeyError) as e:
            return f"Error: {e}"

    def source_for(self, source_id: str) -> Source | None:
        """Sources the model saw; any tender page can be cited (the quote is checked against the whole page)."""
        if source_id in self.sources:
            return self.sources[source_id]
        if source_id.startswith("p") and source_id[1:].isdigit():
            return self.page_source(int(source_id[1:]))
        return None

    # ---- tender -------------------------------------------------------------------------------

    def page_source(self, page: int) -> Source | None:
        boxes = self.index.pages.get(page)
        if boxes is None:
            return None
        sid = f"p{page}"
        self.sources.setdefault(sid, Source(sid, "tender", f"Tender p. {page}", page_text(boxes), page=page, boxes=boxes))
        return self.sources[sid]

    def search_tender(self, query: str) -> str:
        parts = []
        for chunk in self.index.search(query, k=SEARCH_HITS, embed=self.embed):
            source = self.page_source(chunk.page)
            parts.append(f"[source: {source.id}] page {chunk.page} · {chunk.heading}\n{chunk.text}")
        return "\n\n".join(parts) or "No passage matches."

    def read_tender_page(self, page: int) -> str:
        source = self.page_source(page)
        if not source:
            return f"No page {page}: the tender has pages 1–{len(self.index.pages)}."
        return f"[source: {source.id}] page {page}\n{source.text}"

    # ---- our offer ----------------------------------------------------------------------------

    def bid_summary(self) -> str:
        p = self.pricing
        project, summary = p["project"], p.get("summary", {})
        lines = [f"Offer price (selling price): CHF {project['selling_price']:,.0f}",
                 f"Direct cost: CHF {project['direct']:,.0f}", f"Margin: {project['margin_pct']:.2f} %"]
        lines += [f"{t['label']}: {t['formula']} = CHF {t['value']:,.0f}" for t in project.get("trace", [])]
        lines += [f"{k.replace('_', ' ')}: {v}" for k, v in summary.items() if isinstance(v, (int, float, str))]
        tender = p.get("tender", {})
        if tender.get("award"):
            lines.append(f"Award: {json.dumps(tender['award'], ensure_ascii=False)}")
        text = "\n".join(lines)
        self.sources["bid"] = Source("bid", "bid", "Our offer (current calculation)", text)
        return f"[source: bid]\n{text}"

    def bid_positions(self, query: str) -> str:
        lines = self.pricing["lines"]
        exact = [l for l in lines if l["line_id"] == query.strip()]
        if exact:
            return self._position(exact[0], detailed=True)
        words = query.lower().split()
        hits = [l for l in lines if all(w in " ".join([l["line_id"], l["title_en"], l["title_de"], l["decision"].get("product_id") or ""]).lower()
                                         for w in words)]
        if not hits:
            return "No position matches. Try fewer or other words (English or German title, product id)."
        out = [self._position(l) for l in hits[:MAX_POSITIONS]]
        if len(hits) > MAX_POSITIONS:
            out.append(f"… {len(hits) - MAX_POSITIONS} more positions match; narrow the query.")
        return "\n\n".join(out)

    def _position(self, line: dict, detailed: bool = False) -> str:
        cost, d = line.get("cost") or {}, line["decision"]
        text = "\n".join(filter(None, [
            f"Position {line['line_id']} (tender page {line['page']}, system {line['system']}, section {line['section']} {line['section_name']})",
            f"Title: {line['title_de']} / {line['title_en']}",
            f"Tender quantity: {line['tender_quantity']} {line['tender_unit']}",
            f"Status: {line['status_key']}",
            f"Catalogue product: {d.get('product_id') or 'none'}",
            cost and f"Net unit cost: CHF {cost.get('net_unit_cost') or 0:,.2f} ({cost.get('price_source')})",
            cost and f"Direct cost: CHF {cost.get('direct_cost') or 0:,.2f}",
            *([f"{t['label']}: {t['formula']} = CHF {t['value']:,.2f}" for t in cost.get("trace", [])] if detailed else []),
            *([f"Assumption: {a}" for a in d.get("assumptions", [])] if detailed else []),
        ]))
        sid = f"pos:{line['line_id']}"
        self.sources[sid] = Source(sid, "position", f"Position {line['line_id']}", text, page=line["page"], line_id=line["line_id"])
        return f"[source: {sid}]\n{text}"

    # ---- company data -------------------------------------------------------------------------

    def query_company_data(self, file: str, where=None, columns=None, group_by=None, metrics=None, sort_by=None,
                           descending=False, limit=20) -> str:
        label, text = self.data.query(file, where, columns, group_by, metrics, sort_by, descending, limit)
        sid = f"d{sum(s.kind == 'data' for s in self.sources.values()) + 1}"
        self.sources[sid] = Source(sid, "data", label, text)
        return f"[source: {sid}]\n{text}"
