"""Tender-level facts read from the document itself (nothing tender-specific is hardcoded).

- project: name from the LV page headers, BKP code from the system codes, trade name from the Swiss BKP list
- lots: "LOS n" markers and the system codes listed under them, wherever the cost summary sits
- award: the price-scoring rule from the procedure conditions (weight, zero-points ratio), if stated
- location: which mounting-height factor a system uses, from its own name (overridable in settings)
"""

from __future__ import annotations

import re
from collections import Counter

from .models import PageInfo, Row

# Swiss BKP (Baukostenplan) building-services codes, for a readable trade name.
BKP_TRADES = {
    "240": ("Building services, general", "HLKK-Anlagen allgemein"),
    "241": ("Energy supply", "Zulieferung Energieträger"),
    "242": ("Heat generation", "Wärmeerzeugung"),
    "243": ("Heat distribution", "Wärmeverteilung"),
    "244": ("Ventilation", "Lüftungsanlagen"),
    "245": ("Air conditioning", "Klimaanlagen"),
    "246": ("Refrigeration", "Kälteanlagen"),
    "247": ("Special systems", "Spezialanlagen"),
    "248": ("HVAC insulation", "Dämmungen HLK"),
    "249": ("HVAC miscellaneous", "Übriges HLKK"),
    "250": ("Plumbing", "Sanitäranlagen"),
    "230": ("Electrical installations", "Elektroanlagen"),
}

# Mounting-height location by words in a system or lot name. Keys match the parameter
# names "mounting_height_<location>" in project_parameters.json.
LOCATION_WORDS = {"sports_hall": ("turnhalle", "sporthalle", "mehrzweckhalle", "gym")}

SYSTEM_CODE = r"(\d{3})\.(\d{1,2})"


def _page_text(rows: list[Row]) -> str:
    text = " ".join(r.text for r in rows)
    return re.sub(r"(\w)- (\w)", r"\1\2", text)  # join words hyphenated across lines


def parse_lots(rows_by_page: dict[int, list[Row]], pages: list[PageInfo], bkp: str | None) -> dict:
    """Find 'LOS n' blocks and the systems listed under each, plus each lot's name if given."""
    system_lot: dict[str, str] = {}
    names: dict[str, Counter] = {}
    source_page = None
    for info in pages:
        if info.kind not in ("conditions",):
            continue
        current = None
        for row in rows_by_page.get(info.page, []):
            for seg in row.segments:
                m = re.match(r"^LOS\s+(\d+)\b", seg.text, re.I)
                if m:
                    current = m.group(1)
                m = re.match(rf"^{SYSTEM_CODE}\b", seg.text)
                if m and current and (bkp is None or m.group(1) == bkp):
                    system_lot.setdefault(f"{m.group(1)}.{int(m.group(2)):02d}", current)
                    source_page = source_page or info.page
            for m in re.finditer(r"\bLos\s+(\d+)\s+([A-ZÄÖÜ][\wäöüÄÖÜ\-]+)", row.text):
                if m.group(2).lower() not in ("brutto", "netto", "total", "chf"):
                    names.setdefault(m.group(1), Counter())[m.group(2)] += 1
        if system_lot and source_page:
            break
    lots = {}
    for lot in sorted(set(system_lot.values()) | set(names), key=int):
        lots[lot] = {"name": names[lot].most_common(1)[0][0] if lot in names else None,
                     "systems": sorted(c for c, l in system_lot.items() if l == lot)}
    return {"lots": lots, "system_lot": system_lot, "page": source_page}


def parse_project(rows_by_page: dict[int, list[Row]], pages: list[PageInfo], system_codes: list[str]) -> dict:
    lv_pages = [p for p in pages if p.kind == "lv"]
    names = Counter()
    for info in lv_pages:
        top = [r for r in rows_by_page[info.page] if r.y < 35]
        if top and top[0].segments:
            names[top[0].segments[0].text.strip()] += 1
    prefixes = Counter(c.split(".")[0] for c in system_codes)
    bkp = prefixes.most_common(1)[0][0] if prefixes else None
    en, de = BKP_TRADES.get(bkp or "", (None, None))
    return {
        "name": names.most_common(1)[0][0] if names else None,
        "bkp": bkp,
        "trade_en": en,
        "trade_de": de,
        "lv_pages": [lv_pages[0].page, lv_pages[-1].page] if lv_pages else None,
    }


def parse_award(rows_by_page: dict[int, list[Row]], pages: list[PageInfo]) -> dict | None:
    """Price scoring rule, e.g. 'linear … 100 Punkten beim tiefsten Angebot … bei 150 % … 0 Punkte … Gewichtung 60 Pkt.'"""
    for info in pages:
        if info.kind != "conditions":
            continue
        text = _page_text(rows_by_page.get(info.page, []))
        zero = re.search(r"bei\s+(\d+(?:[.,]\d+)?)\s*%\s+des\s+tiefsten\s+Angebot\w*\s+0\s+Punkt", text, re.I)
        if not zero:
            continue
        weight = re.search(r"Gewichtung\s+(\d+(?:[.,]\d+)?)\s*(?:Pkt|Punkt|%)", text[zero.end():], re.I)
        total = re.search(r"maximal\s+(\d+)\s+Punkte|(\d+)-?er\s+Skala", " ".join(_page_text(rows_by_page.get(p.page, []))
                                                                                 for p in pages if p.kind == "conditions"), re.I)
        return {
            "zero_at_ratio": float(zero.group(1).replace(",", ".")) / 100,
            "weight": float(weight.group(1).replace(",", ".")) if weight else None,
            "total_points": float(next(g for g in total.groups() if g)) if total else 100.0,
            "page": info.page,
            "quote": text[max(0, zero.start() - 120): zero.end() + 20].strip(),
        }
    return None


def location_for(*names: str | None) -> str:
    text = " ".join(n for n in names if n).lower()
    for location, words in LOCATION_WORDS.items():
        if any(w in text for w in words):
            return location
    return "default"


def parse_conditions(rows_by_page: dict[int, list[Row]], pages: list[PageInfo]) -> dict | None:
    """Conditions scheme of the offer form ("Konditionen"): fixed rates printed by the client, e.g.
    'allg. Bauabzüge 1.30 %' and 'MWST 8.10 %'. Discount and cash discount are left blank for the bidder."""
    for info in pages:
        if info.kind != "conditions":
            continue
        rows = rows_by_page.get(info.page, [])
        text = " ".join(r.text for r in rows)
        if "Konditionen" not in text or "MWST" not in text:
            continue
        found = {"page": info.page}
        for key, pattern in (("deductions_pct", r"Bauabz\w+\s+(\d+(?:[.,]\d+)?)\s*%"), ("vat_pct", r"MWST\s+(\d+(?:[.,]\d+)?)\s*%")):
            m = re.search(pattern, text)
            if m:
                found[key] = float(m.group(1).replace(",", "."))
        return found
    return None
