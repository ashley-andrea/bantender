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

GUIDE = """How the tool works (five steps, left to right at the top of the screen)
1. Extraction: the positions are read from the tender PDF. Each value is marked Read (printed in the tender), Derived (worked out from it), Assumed (an assumption the tool made) or Missing. Ductwork from the CAD component list is added per system.
2. Catalogue: each position is matched to a catalogue product; the table shows the product family with list price, discount and net price. Supplier-package items (air-handling units, silencers, kitchen modules ...) need a supplier quote: type the quoted net price and save it; Reset goes back to the catalogue placeholder.
3. Price: for each position, click the quantity or the hours per unit to correct it; the small undo arrow goes back to the computed value. The position shows its unit price and amount as they go on the offer form, and the steps from net price to unit price. The Parameters panel on the right has every coefficient (margin, overhead, risk, productivity factors, allowances, project costs, mounting height by system); change one with its slider, undo it with the arrow, or Reset all. The bar at the bottom shows direct cost + overhead and risk + margin = offer price.
4. Offer options: offers at different margins, each with its estimated chance of winning, learned from our past bids (Aggressive, Target, Conservative). Use this offer sets the margin. Tender inputs (what the model knows about the tender) can be corrected.
5. Export: the tender PDF with the unit prices, amounts and totals filled in. Discount and cash discount are entered in the conditions; Download PDF saves it. Left for you: company details, signatures, change-order rate sheets and make/model declarations.
Every change recomputes the whole offer at once and is recorded in the change log.
Esteban answers questions about the tender, our offer and our data; each answer cites its sources, and a click on a source number shows it."""


def _txt(v) -> str:
    return v.get("en", "") if isinstance(v, dict) else str(v)


def _chf(x: float, decimals: int = 0) -> str:
    return f"CHF {x:,.{decimals}f}"


Where = str | list[tuple[str, str]] | None  # "step#anchor", or (key, "step#anchor") pairs picked by the quote (grounding.target)


def _rows(rows: list[str | tuple[str, Where]]) -> tuple[str, dict[int, list[tuple[str, str]]]]:
    """Source text from rows, with the place in the tool where each row is shown."""
    lines, anchors = [], {}
    for row in rows:
        text, where = (row, None) if isinstance(row, str) else row
        if where:
            anchors[len(lines)] = [("", where)] if isinstance(where, str) else where
        lines += text.splitlines() or [""]
    return "\n".join(lines), anchors


# Project cost build-up step -> where the tool shows it (the offer bar or the parameter that sets it).
TRACE_ANCHOR = {
    "Line material": "price#direct-cost", "Line labour": "price#direct-cost",
    "Transport / equipment": "price#param:transport_equipment_pct", "Small material": "price#param:small_material_pct",
    "Supplier contingency": "price#param:supplier_package_contingency_pct", "Engineering": "price#param:engineering_hours",
    "Commissioning": "price#param:commissioning_hours", "Hygiene inspection": "price#param:hygiene_inspection_chf",
    "Documentation": "price#param:documentation_chf", "Risk / opportunities": "price#param:risk_allowance_chf",
    "Overhead": "price#overhead-risk", "Cost baseline": "price#overhead-risk", "Selling price": "price#offer-price",
}
CONDITION_ANCHORS = [("net incl", "export#cond:net"), ("cash discount", "export#cond:cash_discount"),
                     ("discount", "export#cond:discount"), ("deductions", "export#cond:deductions"),
                     ("VAT", "export#cond:vat"), ("gross", "export#cond:gross")]
GUIDE_STEPS = {"1.": "extract", "2.": "catalog", "3.": "price", "4.": "offers", "5.": "export"}

DEFINITIONS = [
    _fn("search_tender", "Search the tender document (German, ~200 pages). Returns the best matching passages with their page source id. "
        "Search in German with the tender's own terms; search again with other words if the passages do not answer the question.",
        {"query": {"type": "string"}}),
    _fn("read_tender_page", "Read one whole tender page (e.g. to see a full table or the context around a passage).",
        {"page": {"type": "integer"}}),
    _fn("bid_summary", "Our current offer for this tender as calculated in the tool: offer price, cost build-up with formulas, "
        "positions by status, direct cost by system, and the settings in use (margin, overhead, mounting heights ...).", {}),
    _fn("bid_positions", "Positions of our offer with quantity, catalogue product, costs and status, highest direct cost first. "
        "Pass a line id as query for one position with its full calculation, why it has its status, its assumptions and its "
        "line on the offer form. Or find positions by words (title, product id), by status (calculated, supplier_quote_required, "
        "assumption_applied, review_required, needs_price, insufficient_information, out_of_scope, non_priceable) and/or by "
        "system code (e.g. 244.02). Use an empty query to list by status or system only.",
        {"query": {"type": "string"}, "status": NULLABLE_STR, "system": NULLABLE_STR}),
    _fn("bid_offer_form", "How our offer is written into the tender's offer form: the factor m on every unit price, the totals per "
        "system and section (installation and services go to section E), per lot, and the conditions (discount, cash discount, "
        "deductions, VAT, net).", {}),
    _fn("win_probability", "The estimated chance of winning: at the current offer, at the Aggressive / Target / Conservative offers, "
        "which tender inputs raise or lower it, and where each input comes from.", {}),
    _fn("tool_guide", "How to use this tool: its steps, where to correct a quantity, enter a supplier quote, change a parameter, "
        "pick an offer, export the PDF.", {}),
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

    def __init__(self, index: TenderIndex, pricing: Callable[[], dict], data: CompanyData, embed: Embed | None = None,
                 offer: Callable[[dict], dict] | None = None):
        self.index = index
        self._pricing_fn = pricing
        self._pricing: dict | None = None
        self._offer_fn = offer  # pricing -> the numbers on the offer form
        self._offer: dict | None = None
        self.data = data
        self.embed = embed
        self.sources: dict[str, Source] = {}
        self.calls = 0

    @property
    def pricing(self) -> dict:
        if self._pricing is None:
            self._pricing = self._pricing_fn()
        return self._pricing

    @property
    def offer(self) -> dict | None:
        if self._offer is None and self._offer_fn is not None:
            self._offer = self._offer_fn(self.pricing)
        return self._offer

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
        lines: list[str | tuple[str, Where]] = [
            (f"Offer price (selling price): CHF {project['selling_price']:,.0f}", "price#offer-price"),
            (f"Direct cost: CHF {project['direct']:,.0f}", "price#direct-cost"),
            (f"Margin: {project['margin_pct']:.2f} %", "price#margin")]
        lines += [(f"{t['label']}: {t['formula']} = CHF {t['value']:,.0f}", TRACE_ANCHOR.get(t["label"])) for t in project.get("trace", [])]
        if t := summary.get("tender"):
            lines.append(f"Tender positions: {t['lines']} lines, {t['excluded']} excluded (out of scope or not priceable), "
                         f"{t['to_price']} to price, {t['priced']} priced ({t['coverage_pct']} % coverage), {t['calculated']} calculated "
                         f"without open question, {t['provisional']} provisional, {t['unpriced']} still without a price")
        if c := summary.get("cad"):
            lines.append(f"Ductwork from the CAD list: {c['lines']} lines, direct cost {_chf(c['chf'])}")
        if v := summary.get("value"):
            lines.append(f"Direct line cost: {_chf(v['total_chf'])}, of which calculated {_chf(v['calculated_chf'])} "
                         f"({v['calculated_pct']} %) and provisional {_chf(v['provisional_chf'])}")
        for status, b in sorted(summary.get("by_status", {}).items(), key=lambda kv: -kv[1]["chf"]):
            lines.append(f"Status {status}: {b['count']} positions ({b['lv']} tender, {b['cad']} CAD), direct cost {_chf(b['chf'])}")
        for system, chf in sorted(summary.get("by_system", {}).items()):
            lines.append(f"System {system}: direct line cost {_chf(chf)}")
        if s := p.get("settings"):
            lines.append((f"Settings in use: margin {s['margin_pct']:g} %, overhead {s['overhead_pct']:g} %, risk allowance "
                          f"{_chf(s['risk_allowance_chf'])}, rounded up to {_chf(s['round_to_chf'])}, discount {s['discount_pct']:g} %, "
                          f"cash discount {s['cash_discount_pct']:g} %",
                          [("cash discount", "export#cond:cash_discount"), ("discount", "export#cond:discount"),
                           ("rounded", "price#offer-price"), ("risk", "price#param:risk_allowance_chf"),
                           ("overhead", "price#param:overhead_pct"), ("margin", "price#param:margin_pct")]))
            lines.append("Included: " + ", ".join(f"{k.removeprefix('include_').replace('_', ' ')} {'yes' if s[k] else 'no'}"
                                                  for k in ("include_project_costs", "include_small_material",
                                                            "include_supplier_contingency", "include_cad_ductwork")))
            lines.append(("Productivity factors: " + ", ".join(f"{k} {v:g}" for k, v in s["factors"].items()),
                          [(k, f"price#param:{k}") for k in s["factors"]]))
            lines.append(("Mounting height by system: " + ", ".join(f"{k} {v}" for k, v in s["locations"].items()),
                          [(k, f"price#location:{k}") for k in s["locations"]]))
        tender = p.get("tender", {})
        if tender.get("award"):
            lines.append(f"Award: {json.dumps(tender['award'], ensure_ascii=False)}")
        text, anchors = _rows(lines)
        self.sources["bid"] = Source("bid", "bid", "Our offer (current calculation)", text, step="price", anchors=anchors)
        return f"[source: bid]\n{text}"

    def bid_positions(self, query: str, status: str | None = None, system: str | None = None) -> str:
        lines = self.pricing["lines"]
        exact = [l for l in lines if l["line_id"] == query.strip()]
        if exact:
            return self._position(exact[0], detailed=True)
        if status and status not in {l["status_key"] for l in lines}:
            return f"No position has status {status!r}. Statuses here: {', '.join(sorted({l['status_key'] for l in lines}))}."
        words = query.lower().split()
        if not (words or status or system):
            return "Give words, a status or a system."
        hits = [l for l in lines if (not status or l["status_key"] == status) and (not system or l["system"] == system)
                and all(w in " ".join([l["line_id"], l["title_en"], l["title_de"], l["decision"].get("product_id") or ""]).lower()
                        for w in words)]
        if not hits:
            return "No position matches. Try fewer or other words (English or German title, product id), or another status or system."
        hits.sort(key=lambda l: -((l.get("cost") or {}).get("direct_cost") or 0))
        where = ", ".join(filter(None, [query.strip() and f"words '{query.strip()}'", status and f"status {status}",
                                        system and f"system {system}"]))
        total = sum((l.get("cost") or {}).get("direct_cost") or 0 for l in hits)
        header = f"{len(hits)} positions with {where}; together direct cost {_chf(total)}; highest direct cost first"
        sid = f"q{sum(s.id.startswith('q') for s in self.sources.values()) + 1}"
        self.sources[sid] = Source(sid, "bid", "Our offer: positions", header, step="price")
        out = [f"[source: {sid}]\n{header}", *(self._position(l) for l in hits[:MAX_POSITIONS])]
        if len(hits) > MAX_POSITIONS:
            out.append(f"… {len(hits) - MAX_POSITIONS} more positions match; narrow the query.")
        return "\n\n".join(out)

    def _position(self, line: dict, detailed: bool = False) -> str:
        cost, d = line.get("cost") or {}, line["decision"]
        text, anchors = _rows([row for row in [
            (f"Position {line['line_id']} (tender page {line['page']}, system {line['system']}, section {line['section']} {line['section_name']})",
             "#pos:title"),
            (f"Title: {line['title_de']} / {line['title_en']}", "#pos:title"),
            (f"Tender quantity: {line['tender_quantity']} {line['tender_unit']}", "price#pos:quantity"),
            (f"Status: {line['status_key']}", "#pos:title"),
            (f"Catalogue product: {d.get('product_id') or 'none'}", "price#pos:product"),
            cost and (f"Net unit cost: CHF {cost.get('net_unit_cost') or 0:,.2f} ({cost.get('price_source')})", "price#pos:net"),
            cost and (f"Direct cost: CHF {cost.get('direct_cost') or 0:,.2f}", "price#pos:direct"),
            *(self._why(line) if detailed else []),
        ] if row])
        sid = f"pos:{line['line_id']}"
        self.sources[sid] = Source(sid, "position", f"Position {line['line_id']}", text, page=line["page"], line_id=line["line_id"],
                                   anchors=anchors)
        return f"[source: {sid}]\n{text}"

    def _why(self, line: dict) -> list[tuple[str, Where]]:
        """The calculation and the reasons behind one position, as the tool decided them (with where the tool shows them)."""
        cost, d = line.get("cost") or {}, line["decision"]
        out: list[tuple[str, Where]] = [
            (f"Calculation: {t['label']}: {t['formula']} = " + (f"{t['value']:,.2f} h" if t["label"] == "Installation hours" else _chf(t["value"], 2)),
             "price#pos:hours" if t["label"] == "Installation hours" else "price#pos:steps")
            for t in cost.get("trace", [])]
        if d.get("install_code"):
            out.append((f"Installation rule: {d['install_code']}; mounting height of the system: {d.get('location')}", "price#pos:hours"))
        if d.get("band"):
            out.append((f"Match confidence: {d['band']}", "catalog"))
        out += [(f"Why: {_txt(r)}", "catalog") for r in d.get("reasons", [])]
        out += [(f"Assumption: {_txt(a)}", "extract") for a in d.get("assumptions", [])]
        out += [(f"Other catalogue option: {a['product_id']} {a['description']} at CHF {a['net_cost_chf']:,.2f} ({a['reason']})", "catalog")
                for a in d.get("alternatives", [])[:3]]
        if d.get("overridden"):
            out.append((f"Changed by the estimator: {', '.join(d['overridden'])}" + (f" (note: {d['override_note']})" if d.get("override_note") else ""),
                        "price#pos:quantity"))
        form = (self.offer or {}).get("lines", {}).get(line["line_id"])
        if line.get("source") == "cad":
            out.append((f"On the offer form: CAD ductwork is not a tender position; its material goes to section B and its "
                        f"installation to section E of system {line['system']}", f"export#system:{line['system']}"))
        elif form and form["kind"] == "priced":
            out.append((f"On the offer form: unit price CHF {form['unit_price']:,.2f}, amount CHF {form['amount']:,.2f}",
                        [("amount", "price#pos:amount"), ("", "price#pos:unit_price")]))
            out.append(("On the offer form the unit price includes installation", "price#pos:unit_price") if form.get("includes_labour") else
                       (f"On the offer form the installation of this position goes to section E of system {line['system']}", "price#pos:steps"))
        elif form and form["kind"] == "included":
            out.append(("On the offer form: incl. (included in another position)", "price#pos:unit_price"))
        return out

    def bid_offer_form(self) -> str:
        o = self.offer
        if o is None:
            return "The offer form is not available."
        lines: list[str | tuple[str, Where]] = [
            f"Factor m = offer price ÷ direct cost = {_chf(o['selling_price'])} ÷ {_chf(self.pricing['project']['direct'])} = {o['factor']:.4f}",
            "Every cost component on the form is multiplied by the same factor m (SIA 118 Art. 39), so overhead, risk and margin "
            "are spread evenly over all unit prices and the form adds up to the offer price.",
            "Sections A–D carry the supply price of each item (material + small material or supplier contingency) × m. Section E "
            "carries installation and transport, the services (engineering, commissioning, documentation) and the hygiene "
            "inspection of each system. Section F (insulation) and install-only lines carry their installation in the unit price. "
            "Project costs are shared among systems by their share of direct line cost.",
        ]
        for code, s in o["systems"].items():
            sections = ", ".join(f"{k} {_chf(v, 2)}" for k, v in s["sections"].items())
            lines.append((f"System {code}: total {_chf(s['total'], 2)} ({sections}); share of direct cost {100 * s.get('share', 0):.1f} %; "
                          f"installation hours {s['labour_hours']:,.1f}", f"export#system:{code}"))
        lines += [f"Lot {k}: {_chf(v, 2)}" for k, v in o["lots"].items()]
        lines.append((f"Gross total of the form: {_chf(o['brutto'], 2)} (rounding difference to the offer price: {_chf(o['rounding_difference'], 2)})",
                      "export#cond:gross"))
        c = o["conditions"]
        lines.append((f"Conditions: gross {_chf(c['brutto'], 2)} − discount {c['discount_pct']:g} % {_chf(c['discount'], 2)} − cash discount "
                      f"{c['cash_discount_pct']:g} % {_chf(c['cash_discount'], 2)} − deductions {c['deductions_pct']:g} % {_chf(c['deductions'], 2)} "
                      f"+ VAT {c['vat_pct']:g} % {_chf(c['vat'], 2)} = net incl. VAT {_chf(c['netto'], 2)}", CONDITION_ANCHORS))
        text, anchors = _rows(lines)
        self.sources["form"] = Source("form", "bid", "Our offer: the offer form", text, step="export", anchors=anchors)
        return f"[source: form]\n{text}"

    def win_probability(self) -> str:
        w = self.pricing.get("win_curve")
        if not w or w.get("model") in ("unavailable", "error"):
            return f"No win probability for this tender: {(w or {}).get('reason') or 'model not available'}."
        cur = w["current"]
        lines: list[str | tuple[str, Where]] = [
            (f"Model: {'learned from our past bids' if w['model'] == 'ml' else 'fixed placeholder formula'} ({w.get('model_version')})", "offers#model"),
            (f"Current offer {_chf(cur['offer'])} at margin {cur['margin_pct']:.1f} %: chance of winning {100 * cur['win_probability']:.0f} % "
             f"(range {100 * cur['p_low']:.0f}–{100 * cur['p_high']:.0f} %), expected profit {_chf(cur['expected_profit'])}", "offers#win:current"),
            ("Expected profit = chance of winning × (offer − cost baseline)", "offers#win:current"),
            (f"Cost baseline {_chf(w['baseline'])}; market reference {_chf(w['market_reference_chf'])} (source: {w['market_reference_source']})",
             [("market reference", "offers#input:market_reference_chf")]),
        ]
        lines += [(f"{s['name']} offer {_chf(s['offer'])} at margin {s['margin_pct']:.1f} %: chance {100 * s['win_probability']:.0f} %, "
                   f"expected profit {_chf(s['expected_profit'])}", f"offers#win:{s['name']}") for s in w.get("scenarios", [])]
        lines += [(f"At the Target offer, {e['feature']} = {e['value']} changes the chance by {e['pts']:+.1f} points vs an average past tender",
                   f"offers#why:{e['feature']}") for e in w.get("explanation", [])]
        lines += [(f"Tender input {k} = {v} (from {w['sources'].get(k, 'default')})", f"offers#input:{k}") for k, v in w.get("context", {}).items()]
        text, anchors = _rows(lines)
        self.sources["win"] = Source("win", "bid", "Our offer: chance of winning", text, step="offers", anchors=anchors)
        return f"[source: win]\n{text}"

    def tool_guide(self) -> str:
        text, anchors = _rows([(line, GUIDE_STEPS.get(line[:2])) for line in GUIDE.splitlines()])
        self.sources["guide"] = Source("guide", "data", "Guide (how the tool works)", text, anchors=anchors)
        return f"[source: guide]\n{GUIDE}"

    # ---- company data -------------------------------------------------------------------------

    def query_company_data(self, file: str, where=None, columns=None, group_by=None, metrics=None, sort_by=None,
                           descending=False, limit=20) -> str:
        label, text = self.data.query(file, where, columns, group_by, metrics, sort_by, descending, limit)
        sid = f"d{sum(s.kind == 'data' for s in self.sources.values()) + 1}"
        self.sources[sid] = Source(sid, "data", label, text)
        return f"[source: {sid}]\n{text}"
