"""Offer build and write-back into the original tender PDF."""

import re
import pymupdf
import pytest

from app.offer.build import build_offer
from app.offer.pdf_fill import fill_offer, fmt
from app.parsing.pipeline import parse_tender, tender_to_dict
from app.pricing.service import price_tender

from .conftest import TENDER_PDF


@pytest.fixture(scope="module")
def offer_and_pdf(ref):
    tender, meta = parse_tender(TENDER_PDF)
    parsed = tender_to_dict(tender, meta)
    pricing = price_tender(parsed, ref)
    offer = build_offer(parsed, pricing)
    data, fields = fill_offer(TENDER_PDF.read_bytes(), parsed, offer)
    return parsed, pricing, offer, pymupdf.open(stream=data, filetype="pdf"), fields


def test_form_adds_up_to_the_offer_price(offer_and_pdf):
    _, pricing, offer, _, _ = offer_and_pdf
    assert abs(offer["brutto"] - pricing["project"]["selling_price"]) < 5  # rounding to centimes over ~240 lines
    for code, s in offer["systems"].items():
        assert s["total"] == pytest.approx(sum(s["sections"].values()), abs=0.02)
    assert offer["brutto"] == pytest.approx(sum(offer["lots"].values()), abs=0.02)
    c = offer["conditions"]
    assert c["deductions_pct"] == 1.3 and c["vat_pct"] == 8.1
    assert c["netto"] == pytest.approx(c["sub3"] + c["vat"], abs=0.01)


def test_every_priced_line_is_written_where_the_tender_asks(offer_and_pdf):
    parsed, _, offer, doc, fields = offer_and_pdf
    written = {f["ref"] for f in fields if f["kind"] == "amount"}
    priced = {k for k, v in offer["lines"].items() if v["kind"] == "priced"}
    assert priced <= written | {k for k in priced if offer["lines"][k]["section"] == "E"}
    first = offer["lines"]["244.01-C-p78.6"]  # verified example LV0001
    text = doc[77].get_text()
    assert fmt(first["unit_price"]) in text and fmt(first["amount"]) in text


def test_summary_and_conditions_pages_are_filled(offer_and_pdf):
    _, _, offer, doc, _ = offer_and_pdf
    assert fmt(offer["brutto"]) in doc[2].get_text()  # p.3 Total Eingabesumme
    assert fmt(offer["conditions"]["netto"]) in doc[1].get_text()  # p.2 Netto
    assert fmt(offer["systems"]["244.01"]["montage"]) in doc[83].get_text()  # p.84 Total Montage und Transport


def test_original_text_is_not_changed(offer_and_pdf):
    """Only numbers are added; every original word except dotted placeholders is still there."""
    _, _, _, doc, _ = offer_and_pdf
    original = pymupdf.open(TENDER_PDF)
    for pno in (1, 2, 77, 83):
        before = [w for w in original[pno].get_text("words") if not set(w[4]) <= {"."}]
        after = {(round(w[0]), round(w[1]), w[4]) for w in doc[pno].get_text("words")}
        assert all((round(w[0]), round(w[1]), w[4]) in after for w in before)


def test_every_dotted_price_cell_of_the_lv_is_filled(offer_and_pdf):
    """Each system's own cost summary, group totals ("Total aller …"): no dotted price cell is left on LV pages."""
    parsed, _, offer, doc, fields = offer_and_pdf
    assert {f["ref"] for f in fields if f["kind"] == "system_total"} == set(parsed["systems"])
    totals = {f["ref"]: f["text"] for f in fields if f["kind"] == "system_total"}
    assert all(totals[c] == fmt(s["total"]) for c, s in offer["systems"].items())
    assert len([f for f in fields if f["kind"] == "group_total"]) == 2
    by_page: dict[int, list] = {}
    for f in fields:
        by_page.setdefault(f["page"], []).append(pymupdf.Rect(f["bbox"]))
    original = pymupdf.open(TENDER_PDF)
    for info in (p for p in parsed["pages"] if p["kind"] == "lv"):
        page = original[info["page"] - 1]
        for w in page.get_text("words"):
            if re.fullmatch(r"\.{8,}", w[4]) and w[0] > 440:  # unit-price and amount columns
                assert any(pymupdf.Rect(w[:4]).intersects(r) for r in by_page.get(info["page"], [])), (info["page"], w[:2])


def test_form_rounds_half_up_like_excel():
    from app.offer.build import per_unit, r2

    assert r2(2.675) == 2.68 and r2(1764.675) == 1764.68  # Python's round() gives 2.67 / 1764.67
    assert per_unit(1406.37, 6) == 234.40  # 1406.37 / 6 = 234.395 exactly; binary floats say 234.3949…
