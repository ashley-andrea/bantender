"""M5: deterministic normalisers."""

import pytest

from app.parsing.normalize import normalize_unit, parse_number, parse_sizes, size_key


@pytest.mark.parametrize("raw,unit", [("Stk", "pc"), ("Stk.", "pc"), ("St.", "pc"), ("m2", "m2"), ("m²", "m2"),
                                      ("m", "m"), ("Std.", "h"), ("Tage", "day"), ("pauschal", "LS"), ("xyz", None)])
def test_units(raw, unit):
    assert normalize_unit(raw) == unit


@pytest.mark.parametrize("raw,value", [("5", 5), ("12.5", 12.5), ("10'000", 10000), ("1'250.50", 1250.5), ("6`200", 6200), ("4,5", 4.5), ("abc", None)])
def test_numbers(raw, value):
    assert parse_number(raw) == value


@pytest.mark.parametrize("text,key", [
    ("Grösse Ø 10 cm", "DN100"),
    ("Ø 12.5 cm", "DN125"),
    ("Grösse 16 Ø cm", "DN160"),
    ("Grösse 40 x 20 cm", "400x200"),
    ("B x H x L 40 x 30 x 125 cm", "400x300x1250"),
    ("Typ MS-F/300x400x1250 | B x H x L 40 x 30 x 125 cm", "400x300x1250"),  # labelled dims win over a type code
    ("Abmessungen B x H (mm) | 300 x 200", "300x200"),
    ("Anschluss Ø250", "DN250"),  # no unit and > 125 → mm
    ("Typ z.B. KOSD 100/900", "DN100"),
    ("Mod. DN Vmin. Vmax. P | cm m3 /h m3 /h Pa | TVR-D 16 120 400 150", "DN160"),
    ("Mod. DN V P | mm m3 /h Pa | ....... 250 100 150", "DN250"),
])
def test_sizes(text, key):
    assert size_key(parse_sizes(text)) == key


def test_backtick_thousands_in_airflow():
    assert parse_sizes("Luftmenge 6`200 m3/h").airflow_m3h == 6200


def test_airflow_fire_and_thickness():
    s = parse_sizes("Thermische Aussendämmung 60/10 | Luftmenge 10'000 m 3 /h | EI30")
    assert (s.airflow_m3h, s.thickness_mm, s.fire_class) == (10000, 60, "EI30")


def test_implausible_size_is_flagged_not_used():
    s = parse_sizes("Grösse Ø 1155 cm")
    assert s.dn_mm is None and s.notes and "11550 mm" in s.notes[0]


def test_tender_structure_is_not_tied_to_bkp_244():
    """Page classification, systems and lots work for any BKP code (synthetic heating tender)."""
    from app.parsing.lv_segment import classify_page, segment
    from app.parsing.models import Row, Segment

    def row(page, y, *cells):
        return Row(page, y, [Segment(t, (x, y, x + 40, y + 10), False) for x, t in cells])

    cover = [row(1, 100, (60, "LOS 1"), (200, "")), row(1, 120, (60, "242.1 WE01 Heizung")),
             row(1, 140, (60, "LOS 2")), row(1, 160, (60, "242.2 WE02 Turnhalle")),
             row(1, 200, (60, "Eingabesumme Los 1 Schulhaus brutto")), row(1, 220, (60, "Eingabesumme Los 2 Turnhalle brutto"))]

    def lv_page(p, code, name):
        return [row(p, 20, (57, "Projekt X"), (253, f"{code} {name}"), (507, "Seite 1 / 1")),
                row(p, 41, (60, "Pos."), (202, "Gegenstand"), (375, "Mass-"), (409, "Mass-"), (449, "Einheits-")),
                row(p, 86, (64, "A"), (85, "APPARATE")),
                Row(p, 110, [Segment("Heizkessel", (85, 110, 160, 120), True)]),
                row(p, 130, (85, "Grösse"), (380, "Stk"), (427, "2"))]

    t = segment({1: cover, 2: lv_page(2, "242.01", "WE01 Heizung"), 3: lv_page(3, "242.02", "WE02 Turnhalle")})
    assert classify_page(2, lv_page(2, "242.01", "WE01 Heizung")).kind == "lv"
    assert set(t.systems) == {"242.01", "242.02"} and t.project["bkp"] == "242" and t.project["trade_en"] == "Heat generation"
    assert t.systems["242.02"]["lot"] == "2" and t.lots["2"]["name"] == "Turnhalle"
    assert t.systems["242.02"]["location"] == "sports_hall" and len(t.lines) == 2 and t.award is None
