"""German HVAC lexicon: deterministic classification of LV lines.

Each rule names the item in English (with the German term kept for reference), says how a
catalogue match is found, or why the line is not priced from the catalogue.
Rules are tried in order; the first whose pattern matches wins.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Rule:
    key: str
    en: str
    de: str
    patterns: tuple[str, ...]  # regex on the folded title (header or first own row)
    context: tuple[str, ...] = ()  # optional regex that must also match the folded full description
    sections: str = ""  # restrict to LV sections (e.g. "F"); empty = any
    install_code: str | None = None
    # How to choose the product: dn | rect | rect_len | airflow | thickness | fixed | none
    size_mode: str = "none"
    subcategory: str | None = None  # catalogue subcategory filter
    fixed_product: str | None = None
    disposition: str | None = None  # non_priceable | covered | out_of_scope | no_catalogue
    note: str = ""
    note_de: str = ""
    extra: dict = field(default_factory=dict)


R = Rule
RULES: tuple[Rule, ...] = (
    # Covered elsewhere or not priced per line
    R("hygiene", "Hygiene inspection (VDI 6022)", "Hygiene-Erstinspektion", (r".",), (r"laboranalysen|hygiene",),
      sections="E", disposition="covered", note="Covered by the project cost 'hygiene inspection'.", note_de="In den Projektkosten «Hygieneprüfung» enthalten."),
    R("commissioning", "Commissioning and balancing", "Einregulierung / Inbetriebnahme", (r"einregulierung|reven|ibn",),
      disposition="covered", note="Covered by the project cost 'commissioning'.", note_de="In den Projektkosten «Inbetriebnahme» enthalten."),
    R("installation_time", "Installation time (bidder to fill in)", "Montagezeit", (r"^montage$|montagezeit",),
      disposition="covered", note="Labour is calculated line by line from the productivity rules.", note_de="Die Montage wird pro Position aus den Leistungswerten berechnet."),
    R("installation_transport", "Installation and transport (lump sum)", "Montage und Transport", (r"montage und transport",), sections="E",
      disposition="covered", note="Calculated from the lines' labour plus the transport/equipment allowance.", note_de="Aus der Montage der Positionen plus Zuschlag Transport/Inventar berechnet."),
    R("ahu_part", "Part of the air-handling unit", "Geräteteil", (r"^\d+\s+.*teil\b|^zubehor|^bemerkungen|^fortluft \d|^\d+ satz kulissen|geratanschluss|gerateanschluss|wrg-system",),
      sections="A", disposition="non_priceable", note="Included in the air-handling unit package.", note_de="Im Lüftungsgeräte-Paket enthalten."),
    R("ahu", "Air-handling unit", "Lüftungsgerät", (r"(zu|ab)?luftgerat|luftungsgerat|gerat komplett|monoblock",),
      sections="A", install_code="AHU_LARGE", size_mode="airflow", subcategory="Air-handling unit"),
    # Air terminals
    R("supply_valve", "Supply air disc valve", "Zuluft-Tellerventil", (r"zuluft\s*[-–]?\s*tellerventil",),
      install_code="DIFFUSER", size_mode="dn", subcategory="Supply valve"),
    R("exhaust_valve", "Exhaust air disc valve", "Abluft-Tellerventil", (r"abluft\s*[-–]?\s*tellerventil",),
      install_code="DIFFUSER", size_mode="dn", subcategory="Exhaust valve"),
    R("grille", "Air grille", "Luftgitter", (r"(zu|ab)luftgitter",), install_code="DIFFUSER", disposition="no_catalogue"),
    R("swirl_diffuser", "Swirl diffuser", "Wirbelstrahlauslass", (r"wirbel",), install_code="DIFFUSER", disposition="no_catalogue"),
    R("nozzle_outlet", "Nozzle duct outlet", "Düsenrohrdurchlass", (r"dusenrohr",), install_code="DIFFUSER", disposition="no_catalogue"),
    R("transfer_unit", "Transfer air unit", "Überströmer", (r"uberstrom",), install_code="DIFFUSER", disposition="no_catalogue"),
    R("weather_louvre", "Weather louvre", "Wetterschutzgitter", (r"wetterschutzgitter",), disposition="no_catalogue"),
    R("louvre_hood", "Outdoor-air louvre hood", "Säulen-Lamellenhut", (r"lamellenhut",), disposition="no_catalogue"),
    R("rain_cap", "Rain cap", "Regenhut", (r"regenhut",), disposition="no_catalogue"),
    # Dampers, fire protection
    R("fire_damper", "Fire damper", "Brandschutzklappe", (r"brandschutzklappe",), install_code="FIRE_DAMPER", size_mode="dn", subcategory="Fire damper"),
    R("manual_damper", "Manual balancing damper", "Drosselklappe", (r"drosselklappe",), install_code="DAMPER", size_mode="dn", subcategory="Manual damper"),
    R("fire_seal_round", "Fire penetration seal, round duct", "Brandschutz-Durchdringung rund", (r"durchdringung",), sections="F",
      install_code="FIRE_SEAL_ROUND", size_mode="dn", subcategory="Circular seal"),
    R("fire_seal_rect", "Fire penetration seal, rectangular duct", "Brandschutz-Durchdringung eckig", (r"kanalverstarkungs",), sections="F",
      install_code="FIRE_SEAL_RECT", size_mode="rect", subcategory="Rectangular seal"),
    R("fire_access", "Inspection cover in fire insulation", "Revisionsdeckel BS-Dämmung", (r"revisi\w*deckel",), sections="F",
      install_code="FIRE_ACCESS", size_mode="rect", subcategory="Inspection cover"),
    R("support_set", "Connection-angle set", "Anschlusswinkel", (r"anschlusswink",), install_code="SUPPORT_SET", size_mode="fixed", fixed_product="P-SUP-001"),
    R("cleaning_cover", "Duct inspection / cleaning cover", "Kontroll- und Putzdeckel", (r"kontroll- und putzdeckel|putzdeckel",),
      install_code="FIRE_ACCESS", size_mode="rect", subcategory="Inspection cover",
      note="Closest catalogue item is the inspection cover for fire insulation; check the function.", note_de="Nächster Katalogartikel ist der Revisionsdeckel für Brandschutzdämmung; Funktion prüfen."),
    # Silencers, flow controllers
    R("silencer_compact", "Compact circular silencer", "Kompakt-/Rohrschalldämpfer", (r"kompaktschalldampfer|rohrschalldampfer",),
      install_code="SILENCER", size_mode="dn", subcategory="Compact"),
    R("silencer_rect", "Rectangular duct silencer", "Kanalschalldämpfer", (r"schalldampfer",), install_code="SILENCER", size_mode="rect_len",
      subcategory="Rectangular"),
    R("cav", "Constant air-volume controller", "Volumenstromregler konstant", (r"volumenstromregler.*konstant",),
      install_code="CAV_CONTROLLER", size_mode="dn", subcategory="CAV circular"),
    R("vav", "Variable air-volume controller", "Volumenstromregler variabel", (r"volumenstromregler",),
      install_code="VAV_CONTROLLER", size_mode="dn_or_rect", subcategory="VAV"),
    # Controls (section D)
    R("smoke_detector", "Duct smoke detector", "Kanalrauchmelder", (r".",), (r"rauchmelder",), sections="D", install_code="CONTROL_POINT", disposition="no_catalogue"),
    R("actuator", "Damper actuator 24 V", "Drehantrieb", (r".",), (r"drehantrieb|stellantrieb",), sections="D", install_code="CONTROL_POINT",
      size_mode="fixed", fixed_product="P-CTL-003"),
    R("pressure_switch", "Differential pressure switch", "Druckwächter", (r".",), (r"druckwachter|differenzdruck",), sections="D", install_code="CONTROL_POINT",
      size_mode="fixed", fixed_product="P-CTL-001", note="Catalogue item is a pressure transmitter; tender asks for a switch.", note_de="Katalogartikel ist ein Drucktransmitter; verlangt ist ein Druckwächter."),
    R("thermometer", "Dial thermometer", "Zeigerthermometer", (r"zeigerthermometer",), install_code="CONTROL_POINT", disposition="no_catalogue"),
    # Insulation (section F)
    R("insulation_weatherproof", "Weatherproof insulation with stainless cladding", "Wetterfeste Dämmung mit V2A-Ummantelung", (r".",),
      (r"wetterfest|ummantelung v2a",), sections="F", install_code="INSULATION_EXT", size_mode="fixed", fixed_product="P-INS-003"),
    R("insulation_fire", "Fire-rated duct insulation", "Brandschutzdämmung", (r"aussendammung ei|brandschutzverkleidung",), sections="F", disposition="no_catalogue"),
    R("insulation_thermal", "Thermal duct insulation", "Thermische Aussendämmung", (r"thermische aussendammung",), sections="F", size_mode="thickness"),
    R("insulation_wall", "Duct insulation at wall penetrations (15 mm)", "Kanal-Aussendämmung", (r"kanal-aussendammung",), sections="F", disposition="no_catalogue"),
    # Ductwork, services, misc
    R("cast_in_duct", "Cast-in round duct under floor slab", "Rohreinlagen unter Bodenplatte", (r"rohreinlagen",), install_code="DUCT_ROUND",
      size_mode="duct_length", subcategory="Circular duct"),
    R("leak_test", "Duct leakage test", "Kanaldichtheitsprüfung", (r"dichtheitsprufung",), disposition="no_catalogue"),
    R("labels", "Labelling plates", "Bezeichnungsschilder", (r"bezeichnungsschild",), disposition="no_catalogue"),
    R("flex_connector", "Flexible duct connector", "Dehnungsmanschette", (r"dehnungsmanschette",), disposition="no_catalogue"),
    R("ceiling_panel", "Ceiling air panel / perforated cladding", "Frontplatte / Lochblechverkleidung", (r"frontplatte|lochblechverkleidung",),
      disposition="no_catalogue"),
    R("roof_mounting", "Flat-roof mounting system", "Montagesystem Flachdach", (r"montagefusse|montageschiene|b \(mm\)",),
      disposition="no_catalogue"),
    R("kitchen_element", "Kitchen ventilation ceiling element", "Küchenlüftungsdecke (EVS)", (r"evs-w|abwascherei|kuche",), sections="A", disposition="no_catalogue"),
)



def fold(text: str) -> str:
    t = text.lower()
    for a, b in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("é", "e"), ("ß", "ss")):
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t).strip()


def classify(title: str, description: str, section: str) -> Rule | None:
    ft, fd = fold(title), fold(description)
    for rule in RULES:
        if rule.sections and section not in rule.sections:
            continue
        if not any(re.search(p, ft) for p in rule.patterns):
            continue
        if rule.context and not any(re.search(p, fd) for p in rule.context):
            continue
        return rule
    return None


# Section D: field devices. "Einbau" alone = install only (devices come with the separate controls tender);
# "Lieferung und Einbau" = supply and install.
FIELD_DEVICES = (
    (r"frostschutz", "Frost protection thermostat", "Frostschutzwächter"),
    (r"temperatur- und feuchte", "Duct temperature and humidity sensor", "Kanaltemperatur- und Feuchtefühler"),
    (r"kanaltemperatur", "Duct temperature sensor", "Kanaltemperaturfühler"),
    (r"druckdifferenz", "Differential pressure sensor", "Druckdifferenzfühler"),
    (r"druckwachter", "Pressure switch", "Druckwächter"),
)


def install_only_device(description: str, local_text: list[str], section: str) -> tuple[str, str] | None:
    if section != "D":
        return None
    fd = fold(description)
    if "einbau der folgenden feldgerate" not in fd or "lieferung und einbau" in fd:
        return None
    own = fold(" ".join(local_text))
    for pattern, en, de in FIELD_DEVICES:
        if re.search(pattern, own):
            return en, de
    return None
