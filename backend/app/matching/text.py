"""Bilingual user-facing text. Every reason, check and assumption is returned in English and German."""

import re


def T(en: str, de: str) -> dict:
    return {"en": en, "de": de}


def chf(value: float) -> str:
    return f"{value:,.2f}".replace(",", "'")


# Building and HVAC words as they appear in LV system, section and lot names. Translated word by word so a new
# tender with other room names still reads in English as far as the glossary goes; unknown words stay as printed.
GLOSSARY = {
    "nebenräume": "ancillary rooms", "essenräume": "dining rooms", "küche": "kitchen", "abwaschen": "dishwashing",
    "schulzimmer": "classrooms", "turnhalle": "sports hall", "montagesystem": "mounting system", "flachdach": "flat roof",
    "schulhaus": "school building", "eg": "ground floor", "og": "upper floor", "ug": "basement", "dg": "attic",
    "apparate": "equipment", "kanäle": "ductwork", "armaturen": "fittings", "instrumente": "instruments",
    "regulierung": "controls", "montage": "installation", "dienstleistungen": "services", "dämmungen": "insulation",
    "und": "and", "lüftung": "ventilation", "lüftungsanlagen": "ventilation", "zuluft": "supply air", "abluft": "exhaust air",
    "aula": "assembly hall", "garderoben": "changing rooms", "duschen": "showers", "toiletten": "toilets", "wc": "toilets",
    "büro": "office", "büros": "offices", "lehrerzimmer": "staff room", "bibliothek": "library", "keller": "basement",
    "technik": "plant room", "technikraum": "plant room", "werkraum": "workshop", "mensa": "canteen", "halle": "hall",
}


def translate(name: str) -> str:
    """English for a German heading, word by word; unknown words are kept."""
    out = []
    for word in re.split(r"(\W+)", name):
        en = GLOSSARY.get(word.lower())
        out.append(en if en else word)
    text = "".join(out).replace("/", " / ")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:1].upper() + text[1:]


def system_label(code: str, name: str) -> tuple[str, str]:
    return f"{code} {translate(name)}", f"{code} {name}"


def section_label(letter: str, name: str) -> tuple[str, str]:
    return f"{letter} {translate(name)}", f"{letter} {name}"
