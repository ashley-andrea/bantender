"""M5: deterministic normalisers."""

import pytest

from app.parsing.normalize import normalize_unit, parse_number, parse_sizes, size_key


@pytest.mark.parametrize("raw,unit", [("Stk", "pc"), ("Stk.", "pc"), ("St.", "pc"), ("m2", "m2"), ("m²", "m2"),
                                      ("m", "m"), ("Std.", "h"), ("Tage", "day"), ("pauschal", "LS"), ("xyz", None)])
def test_units(raw, unit):
    assert normalize_unit(raw) == unit


@pytest.mark.parametrize("raw,value", [("5", 5), ("12.5", 12.5), ("10'000", 10000), ("1'250.50", 1250.5), ("4,5", 4.5), ("abc", None)])
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


def test_airflow_fire_and_thickness():
    s = parse_sizes("Thermische Aussendämmung 60/10 | Luftmenge 10'000 m 3 /h | EI30")
    assert (s.airflow_m3h, s.thickness_mm, s.fire_class) == (10000, 60, "EI30")


def test_implausible_size_is_flagged_not_used():
    s = parse_sizes("Grösse Ø 1155 cm")
    assert s.dn_mm is None and s.notes and "11550 mm" in s.notes[0]
