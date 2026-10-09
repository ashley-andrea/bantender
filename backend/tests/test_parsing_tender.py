"""M3–M4: page classification, systems, LV segmentation and component lists on the real tender."""

from collections import Counter

import pytest

from app.parsing.evaluate import evaluate
from app.parsing.lv_segment import segment
from app.parsing.pdf_layer import read_rows

from .conftest import TENDER_PDF


@pytest.fixture(scope="module")
def tender():
    rows, _ = read_rows(TENDER_PDF)
    return segment(rows)


def test_page_kinds(tender):
    kinds = Counter(p.kind for p in tender.pages)
    assert len(tender.pages) == 202
    assert kinds["lv"] == 121 and kinds["component_list"] == 12


def test_systems_in_document_order(tender):
    ranges = {k: (v["first_page"], v["last_page"], v["lot"]) for k, v in tender.systems.items()}
    assert ranges == {
        "244.01": (67, 88, "1"), "244.02": (89, 118, "1"), "244.03": (119, 146, "1"),
        "244.04": (147, 173, "1"), "244.05": (174, 195, "2"), "244.06": (196, 199, "1"),
    }


def test_sports_hall_header_trap_is_detected(tender):
    flagged = {a.page for a in tender.anomalies if a.code == "header_system_mismatch"}
    assert {181, 190, 195} <= flagged
    assert all(l.system == "244.05" for l in tender.lines if 181 <= l.page <= 195)


def test_typo_on_page_78_is_flagged(tender):
    assert any(a.page == 78 and "1155 cm" in a.message for a in tender.anomalies)


def test_line_volume_and_traceability(tender):
    assert len(tender.lines) >= 240
    assert len({l.line_id for l in tender.lines}) == len(tender.lines)
    assert all(l.page and l.row_bbox for l in tender.lines)


def test_golden_examples(tender, examples):
    ev = evaluate(tender.lines, examples)
    assert ev["found"] == 22
    assert ev["size_ok"] == ev["size_checked"] == 20
    assert ev["system_ok"] == 22


def test_missing_quantity_is_kept_and_flagged(tender):
    blank = [l for l in tender.lines if l.page == 169 and l.quantity is None]
    assert blank and "quantity_missing" in blank[0].flags


def test_component_lists_hand_check(tender):
    la01 = {r.dims[0]: r.quantity for r in tender.component_rows if r.page == 76 and r.table == "ducts_round"}
    assert la01 == {100.0: 33860, 125.0: 18996, 160.0: 50419, 200.0: 7990}
    first_rect = next(r for r in tender.component_rows if r.page == 75 and r.table == "ducts_rect")
    assert (first_rect.quantity, first_rect.dims) == (3938, [150.0, 500.0])


@pytest.mark.skipif(not (TENDER_PDF.parents[2] / "cache" / "docling").exists(), reason="Docling cache not built (run make bench)")
def test_docling_cross_check_flags_disagreements():
    from app.parsing.pipeline import parse_tender

    tender, meta = parse_tender(TENDER_PDF, docling_tables=True, cache_dir=TENDER_PDF.parents[2] / "cache" / "docling")
    assert meta["component_reader"] == "pymupdf" and meta["cross_check"].startswith("docling")
    assert any(a.code == "reader_disagreement" for a in tender.anomalies)
    assert len(meta["figures"]) > 0
