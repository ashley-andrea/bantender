"""Deterministic normalisers for units, Swiss numbers and HVAC sizes."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

UNIT_MAP = {
    "stk": "pc", "stk.": "pc", "st.": "pc", "st": "pc", "stück": "pc", "stck": "pc",
    "m": "m", "lfm": "m", "m1": "m",
    "m2": "m2", "m²": "m2",
    "m3": "m3", "m³": "m3",
    "kg": "kg",
    "std.": "h", "std": "h", "h": "h",
    "tage": "day", "tag": "day",
    "ls": "LS", "psch": "LS", "psch.": "LS", "pauschal": "LS", "gl": "LS", "gl.": "LS",
    "satz": "set", "kpl": "set", "kpl.": "set",
}

THOUSANDS = "'’`´"  # Swiss thousands separators as they appear in tenders (10'000, 6`200)
NUMBER_RE = re.compile(r"^\d{1,3}(?:['’`´]\d{3})+(?:[.,]\d+)?$|^\d+(?:[.,]\d+)?$")


def normalize_unit(raw: str) -> str | None:
    return UNIT_MAP.get(raw.strip().lower())


def parse_number(raw: str) -> float | None:
    s = raw.strip()
    if not NUMBER_RE.match(s):
        return None
    return _num(s)


def fold(text: str) -> str:
    """Lowercase, strip accents/umlauts (ä→a), collapse spaces: for keyword matching."""
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", t)


@dataclass
class Sizes:
    dn_mm: float | None = None
    width_mm: float | None = None
    height_mm: float | None = None
    length_mm: float | None = None
    airflow_m3h: float | None = None
    thickness_mm: float | None = None
    fire_class: str | None = None
    notes: tuple[str, ...] = ()


_NUM = r"(\d+(?:['’`´]\d{3})*(?:[.,]\d+)?)"
DIAM_RE = re.compile(rf"(?:Ø|DN|NW)\s*{_NUM}\s*(cm|mm)?|{_NUM}\s*Ø\s*(cm|mm)?", re.I)
RECT_RE = re.compile(rf"{_NUM}\s*[xX×]\s*{_NUM}(?:\s*[xX×]\s*{_NUM})?\s*(cm|mm)?")
AIRFLOW_RE = re.compile(rf"{_NUM}\s*m\s?[3³]\s*/\s*h", re.I)
THICK_RE = re.compile(r"(?:aussend[äa]mmung|d[äa]mmung)\s+(\d{2,3})\s*/\s*\d+|\b(\d{2,3})\s*mm\s+mineralwoll", re.I)
FIRE_RE = re.compile(r"\bEI\s?(\d{2,3})(-S)?\b")
DIM_LABEL_RE = re.compile(r"B\s*x\s*H(?:\s*x\s*L)?\s*(?:\((mm|cm)\))?", re.I)
TYPE_DN_RE = re.compile(r"\b[A-Z]{2,6}\s?(\d{2,3})/(\d{3,4})\b")
INLINE_HEADER_RE = re.compile(r"^Mod\.?\s+(.*)$")


def _num(s: str) -> float:
    for ch in THOUSANDS:
        s = s.replace(ch, "")
    return float(s.replace(",", "."))


def _to_mm(value: float, unit: str | None, default_unit: str) -> float:
    # Without a unit, LV sizes are in cm; values above 125 can only be mm (Ø250 = 250 mm).
    if unit is None and default_unit == "cm" and value > 125:
        return value
    unit = (unit or default_unit).lower()
    return value * 10 if unit == "cm" else value


def parse_sizes(text: str, default_unit: str = "cm") -> Sizes:
    """Extract sizes from LV text. The LV states dimensions in cm unless a unit is given."""
    s = Sizes()
    notes: list[str] = []

    m = AIRFLOW_RE.search(text)
    if m:
        s.airflow_m3h = _num(m.group(1))

    m = FIRE_RE.search(text)
    if m:
        s.fire_class = f"EI{m.group(1)}" + ("-S" if m.group(2) else "")

    m = THICK_RE.search(text)
    if m:
        s.thickness_mm = float(m.group(1) or m.group(2))

    for m in DIAM_RE.finditer(text):
        raw, unit = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        value = _num(raw)
        explicit_dn = text[m.start():m.start() + 2].upper() in ("DN", "NW")
        mm = value if explicit_dn else _to_mm(value, unit, default_unit)
        if mm > 2000:
            notes.append(f"implausible diameter '{m.group(0).strip()}' (= {mm:g} mm)")
            continue
        s.dn_mm = mm
        break

    label = DIM_LABEL_RE.search(text)
    rect_start = label.end() if label else 0
    rect_default = (label.group(1) or default_unit) if label else default_unit
    matches = list(RECT_RE.finditer(text, rect_start)) or (list(RECT_RE.finditer(text)) if label else [])
    for m in matches:
        a, b, c, unit = m.group(1), m.group(2), m.group(3), m.group(4)
        dims = [_num(a), _num(b)] + ([_num(c)] if c else [])
        before = text[max(0, m.start() - 12):m.start()].lower()
        if "ø" in before or "flansch" in before:
            continue
        mm = [_to_mm(d, unit, rect_default if m.start() >= rect_start else default_unit) for d in dims]
        s.width_mm, s.height_mm = mm[0], mm[1]
        if len(mm) == 3:
            s.length_mm = mm[2]
        break

    if s.dn_mm is None and s.width_mm is None:
        s.dn_mm = inline_table_dn(text)
    if s.dn_mm is None:
        # Type codes such as "KOSD 100/900" give connection DN / length in mm.
        m = TYPE_DN_RE.search(text)
        if m:
            s.dn_mm = float(m.group(1))
            s.length_mm = s.length_mm or float(m.group(2))
    s.notes = tuple(notes[:1])
    return s


def inline_table_dn(text: str) -> float | None:
    """Read DN from a small inline table: 'Mod. DN Vmin. Vmax. P | cm m3/h … | TVR-D 16 120 400 150'."""
    parts = [p.strip() for p in text.split("|")]
    for i, part in enumerate(parts):
        m = INLINE_HEADER_RE.match(part)
        if not m:
            continue
        cols = m.group(1).split()
        if "DN" not in cols:
            continue
        idx = cols.index("DN")
        units = parts[i + 1].split() if i + 1 < len(parts) else []
        unit = units[idx] if idx < len(units) and units[idx] in ("cm", "mm") else "cm"
        for row in reversed(parts[i + 1:]):
            tokens = row.split()
            if len(tokens) > idx + 1 and re.fullmatch(r"[A-Z][\w-]*|\.{3,}", tokens[0]):
                try:
                    value = float(tokens[idx + 1])
                except ValueError:
                    continue
                return value * 10 if unit == "cm" else value
    return None


def same_rect(a: tuple[float, float], b: tuple[float, float]) -> bool:
    """Width × height compared regardless of orientation."""
    return sorted(a) == sorted(b)


def size_key(s: Sizes) -> str | None:
    if s.width_mm and s.height_mm:
        return f"{s.width_mm:g}x{s.height_mm:g}" + (f"x{s.length_mm:g}" if s.length_mm else "")
    if s.dn_mm:
        return f"DN{s.dn_mm:g}"
    return None
