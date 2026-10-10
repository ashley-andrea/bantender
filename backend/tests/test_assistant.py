"""Assistant: retrieval finds the right page, and only statements whose quotes are printed in the cited source survive.

No OpenAI calls: the model is replaced by a scripted one. The live check against gpt-5.2 is benchmarks/assistant_eval.py.
"""

import json
from types import SimpleNamespace

import pytest

from app.assistant.agent import answer
from app.assistant.company_data import CompanyData
from app.assistant.grounding import NO_PROOF, ground
from app.assistant.index import TenderIndex
from app.assistant.tools import Toolbox

from .conftest import REFERENCE_DIR, TENDER_PDF

PRICING = {
    "project": {"selling_price": 2461000, "direct": 2143000, "margin_pct": 5.5, "trace": []},
    "summary": {},
    "lines": [{"line_id": "244.01-C-p79.3", "page": 79, "system": "244.01", "section": "C", "section_name": "Armaturen und Instrumente",
               "title_de": "Brandschutzklappen eingemauert", "title_en": "Fire damper", "tender_quantity": 4.0, "tender_unit": "pc",
               "status_key": "calculated", "decision": {"product_id": "P-FIR-001", "assumptions": []},
               "cost": {"net_unit_cost": 1487.5, "price_source": "catalog", "direct_cost": 9307.73, "trace": []}}],
}


@pytest.fixture(scope="module")
def index():
    return TenderIndex.build(TENDER_PDF)


@pytest.fixture
def toolbox(index):
    return Toolbox(index, lambda: PRICING, CompanyData(REFERENCE_DIR))


# ---- retrieval -----------------------------------------------------------------------------------

def test_index_covers_every_page(index):
    assert len(index.pages) == 202
    pages_with_text = {p for p, boxes in index.pages.items() if boxes}
    assert pages_with_text <= {c.page for c in index.chunks}


@pytest.mark.parametrize("query, page", [
    ("Zahlungsbedingungen Zahlungsfrist", 9),
    ("Frist Einreichung des Angebotes", 9),
    ("Zuschlagskriterien Preis Gewichtung", 9),
    ("Unternehmervarianten", 8),
    ("Garantie Dauer Jahre Mängel", 13),
    ("MWST", 2),
    ("Teuerung Festpreise", 17),
    ("Kran Baumeister", 20),
])
def test_search_finds_the_page(index, query, page):
    assert page in [c.page for c in index.search(query, k=3)]


def test_index_survives_storage(index):
    again = TenderIndex.from_dict(json.loads(json.dumps(index.to_dict())))
    assert [c.id for c in again.search("Skonto Zahlungsfrist")] == [c.id for c in index.search("Skonto Zahlungsfrist")]
    assert again.pages[9] == index.pages[9]


# ---- grounding -----------------------------------------------------------------------------------

def claim(text, source, quote):
    return {"text": text, "citations": [{"source": source, "quote": quote}]}


def test_printed_quotes_are_kept_and_located(toolbox):
    toolbox.read_tender_page(9)
    toolbox.read_tender_page(8)
    raw = {"status": "answered", "message": "", "claims": [
        claim("Payment within 45 days.", "p9", "Zahlungsfrist: 45 Tage"),
        claim("Read down the left column.", "p9", "Adresse und Frist für die Einreichung des Angebotes"),  # two-column page
        claim("Hyphenated across lines.", "p9", "linearen Interpolation berechnet"),  # "berech-\nnet"
        claim("No variants.", "p8", "Unternehmervarianten sind nicht zugelassen"),
    ]}
    out = ground(raw, toolbox.sources, "en")
    assert out["status"] == "answered" and out["unverified"] == 0
    assert [s["refs"] for s in out["statements"]] == [[1], [2], [3], [4]]
    first = out["citations"][0]
    assert first["page"] == 9 and len(first["bboxes"]) == 1
    x0, y0, x1, y1 = first["bboxes"][0]
    assert x0 > 200 and y1 - y0 < 20  # the right column's segment, one printed line


def test_fabricated_and_misattributed_quotes_are_dropped(toolbox):
    toolbox.read_tender_page(9)
    raw = {"status": "answered", "message": "", "claims": [
        claim("Payment within 45 days.", "p9", "Zahlungsfrist: 45 Tage"),
        claim("Payment within 30 days.", "p9", "Zahlungsfrist: 30 Tage"),  # altered figure
        claim("Wrong page.", "p10", "Zahlungsfrist: 45 Tage"),  # true text, wrong page
        claim("Unknown source.", "p999", "Zahlungsfrist: 45 Tage"),
        claim("Too short to prove anything.", "p9", "45"),
        {"text": "No citation at all.", "citations": []},
    ]}
    toolbox.page_source(10)
    out = ground(raw, toolbox.sources, "en")
    assert [s["text"] for s in out["statements"]] == ["Payment within 45 days."]
    assert out["unverified"] == 5 and len(out["citations"]) == 1


def test_answer_without_any_proof_says_so(toolbox):
    raw = {"status": "answered", "message": "", "claims": [claim("The penalty is CHF 1'000 per day.", "p15", "CHF 1'000 pro Tag")]}
    toolbox.page_source(15)
    out = ground(raw, toolbox.sources, "de")
    assert out == {"status": "not_found", "message": NO_PROOF["de"], "statements": [], "citations": [], "unverified": 1}


def test_replies_without_sources_carry_no_figures(toolbox):
    assert ground({"status": "chat", "message": "Hi! What do you want to know?", "claims": []}, {}, "en")["message"] == "Hi! What do you want to know?"
    assert ground({"status": "chat", "message": "Payment is due in 30 days.", "claims": []}, {}, "en")["message"] == NO_PROOF["en"]


def test_bid_and_company_data_quotes_are_checked_against_the_tool_output(toolbox):
    toolbox.bid_summary()
    toolbox.query_company_data("historical_bids.csv", where=[{"column": "bkp_trade", "op": "=", "value": "244"}], group_by=[],
                               metrics=[{"fn": "count", "column": None}])
    raw = {"status": "answered", "message": "", "claims": [
        claim("Our offer is CHF 2,461,000.", "bid", "Offer price (selling price): CHF 2,461,000"),
        claim("Our offer is CHF 2,300,000.", "bid", "Offer price (selling price): CHF 2,300,000"),
        claim("596 past ventilation bids.", "d1", "where bkp_trade = 244: 596 rows"),
    ]}
    out = ground(raw, toolbox.sources, "en")
    assert [s["text"] for s in out["statements"]] == ["Our offer is CHF 2,461,000.", "596 past ventilation bids."]
    assert [c["kind"] for c in out["citations"]] == ["bid", "data"]


# ---- company data --------------------------------------------------------------------------------

def test_company_data_covers_every_file_and_aggregates():
    data = CompanyData(REFERENCE_DIR)
    assert {"catalog.csv", "productivity.csv", "historical_bids.csv", "market_snapshots.csv"} <= set(data.tables)
    assert "project_parameters.json" in data.documents
    rows = [r for r in data.tables["historical_bids.csv"] if r["bkp_trade"] == "244" and r["building_type"] == "school"]
    _, text = data.query("historical_bids.csv", where=[{"column": "bkp_trade", "op": "=", "value": "244"}], group_by=["building_type"],
                         metrics=[{"fn": "count", "column": None}, {"fn": "mean", "column": "won"}])
    school = next(line for line in text.splitlines() if line.startswith("school,"))
    assert school == f"school,{len(rows)},{sum(int(r['won']) for r in rows) / len(rows):.4g}"
    with pytest.raises(ValueError, match="Unknown column"):
        data.query("catalog.csv", where=[{"column": "price", "op": ">", "value": "1"}])


# ---- the loop, with a scripted model ---------------------------------------------------------------

class ScriptedModel:
    """Stands in for the OpenAI client: asks for one search, then gives the scripted answer; as the auditor of the
    support check, it supports every statement except those listed in `unsupported` (1-based)."""

    def __init__(self, final: dict, unsupported: tuple[int, ...] = ()):
        self.final = final
        self.unsupported = unsupported
        self.inputs = []
        self.audits = []
        self.responses = self

    def create(self, **kwargs):
        usage = SimpleNamespace(input_tokens=100, output_tokens=20)
        if kwargs["text"]["format"]["name"] == "verdicts":
            self.audits.append(kwargs["input"])
            n = kwargs["input"].count("Statement ")
            verdicts = [{"statement": i, "supported": i not in self.unsupported, "reason": "scripted"} for i in range(1, n + 1)]
            return SimpleNamespace(output=[], usage=usage, output_text=json.dumps({"verdicts": verdicts}))
        self.inputs.append(list(kwargs["input"]))
        if len(self.inputs) == 1:
            call = SimpleNamespace(type="function_call", call_id="c1", name="search_tender",
                                   arguments=json.dumps({"query": "Zahlungsbedingungen Zahlungsfrist"}))
            return SimpleNamespace(output=[call], usage=usage, output_text="")
        return SimpleNamespace(output=[SimpleNamespace(type="message")], usage=usage, output_text=json.dumps(self.final))


def test_loop_feeds_search_results_and_keeps_only_proven_statements(toolbox):
    model = ScriptedModel({"status": "answered", "message": "", "claims": [
        claim("Invoices are paid within 45 days.", "p9", "Zahlungsfrist: 45 Tage"),
        claim("A 2 % cash discount applies.", "p9", "Skonto 2 %"),
    ]})
    out, usage = answer(model, "gpt-5.2", "What are the payment terms?", toolbox, lang="en")
    tool_output = model.inputs[1][-1]
    assert tool_output["type"] == "function_call_output" and "[source: p9]" in tool_output["output"]
    assert usage.searches == ["Zahlungsbedingungen Zahlungsfrist"] and usage.input_tokens == 300  # 2 loop rounds + 1 audit
    assert [s["text"] for s in out["statements"]] == ["Invoices are paid within 45 days."]
    assert out["unverified"] == 1 and "context" not in out["citations"][0]
    # The auditor reads the quote with the rows around it.
    assert "Schlussrechnung: 60 Tage" in model.audits[0]


def test_support_check_removes_misread_statements_and_renumbers(toolbox):
    model = ScriptedModel({"status": "answered", "message": "", "claims": [
        claim("Offers are due on 11 August 2026.", "p65", "Eingabefrist Offerten 30 Tage Die 11.08.26"),  # a start date, misread
        claim("Offers are due by 22 September 2026, 10:00.", "p9", "bis zum 22. September 2026, 10.00 Uhr einzureichen"),
    ]}, unsupported=(1,))
    out, usage = answer(model, "gpt-5.2", "When is the submission deadline?", toolbox, lang="en")
    assert [s["text"] for s in out["statements"]] == ["Offers are due by 22 September 2026, 10:00."]
    assert out["statements"][0]["refs"] == [1] and [c["page"] for c in out["citations"]] == [9]
    assert out["unverified"] == 1 and usage.removed[0].startswith("Offers are due on 11 August 2026.")


def test_support_check_rejecting_everything_leaves_no_answer(toolbox):
    model = ScriptedModel({"status": "answered", "message": "", "claims": [
        claim("Offers are due on 11 August 2026.", "p65", "Eingabefrist Offerten 30 Tage Die 11.08.26")]}, unsupported=(1,))
    out, _ = answer(model, "gpt-5.2", "When is the submission deadline?", toolbox, lang="en")
    assert out["status"] == "not_found" and out["statements"] == [] and out["citations"] == []


def test_api_reports_the_assistant_off_without_a_key():
    from fastapi.testclient import TestClient

    import app.api.main as main
    client = TestClient(main.app)
    if main.assistant.enabled:
        pytest.skip("an OpenAI key is configured")
    assert client.get("/api/assistant").json()["enabled"] is False
