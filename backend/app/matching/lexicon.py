"""German HVAC lexicon: deterministic classification of LV lines.

Each rule names the item in English (with the German term kept for reference) and says how the
catalogue product is found, or why the line is covered elsewhere (project costs, a package).
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
    # How to choose the product: dn | rect | rect_len | dn_or_rect | airflow | thickness | fire_insulation | model_key | fixed
    size_mode: str = "none"
    subcategory: str | None = None  # catalogue subcategory filter
    fixed_product: str | None = None
    disposition: str | None = None  # non_priceable | covered
    note: str = ""
    note_de: str = ""
    extra: dict = field(default_factory=dict)


R = Rule
COVERED = "covered"
RULES: tuple[Rule, ...] = (
    # Covered by project costs or part of a package: not priced per line
    R("hygiene", "Hygiene inspection (VDI 6022)", "Hygiene-Erstinspektion", (r".",), (r"laboranalysen|hygiene",), sections="E",
      disposition=COVERED, note="Covered by the project cost 'hygiene inspection'.", note_de="In den Projektkosten «Hygieneprüfung» enthalten."),
    R("commissioning", "Commissioning and balancing", "Einregulierung / Inbetriebnahme", (r"einregulierung|reven|ibn",),
      disposition=COVERED, note="Covered by the project cost 'commissioning'.", note_de="In den Projektkosten «Inbetriebnahme» enthalten."),
    R("installation_time", "Installation time (bidder to fill in)", "Montagezeit", (r"^montage$|montagezeit",), disposition=COVERED,
      note="Labour is calculated line by line from the productivity rules.", note_de="Die Montage wird pro Position aus den Leistungswerten berechnet."),
    R("installation_transport", "Installation and transport (lump sum)", "Montage und Transport", (r"montage und transport",), sections="E",
      disposition=COVERED, note="Calculated from the lines' labour plus the transport/equipment allowance.",
      note_de="Aus der Montage der Positionen plus Zuschlag Transport/Inventar berechnet."),
    R("ahu_part", "Part of the air-handling unit", "Geräteteil",
      (r"^\d+\s+.*teil\b|^zubehor|^bemerkungen|^fortluft \d|^\d+ satz kulissen|geratanschluss|gerateanschluss|wrg-system",),
      sections="A", disposition="non_priceable", note="Included in the air-handling unit package.", note_de="Im Lüftungsgeräte-Paket enthalten."),
    R("ahu", "Air-handling unit", "Lüftungsgerät", (r"(zu|ab)?luftgerat|luftungsgerat|gerat komplett|monoblock",), sections="A",
      install_code="AHU_LARGE", size_mode="airflow", subcategory="Air-handling unit"),
    # Accessories and options named within a parent item's block
    R("colour_coating", "Colour coating (NCS)", "Farbbeschichtung nach NCS", (r"farbbeschichtung",), size_mode="fixed", fixed_product="P-ACC-NCS"),
    R("mounting_frame", "Mounting frame for insulated ducts", "Montagerahmen", (r"montagerahmen",), size_mode="fixed", fixed_product="P-ACC-FRAME"),
    R("direction_arrows", "Direction arrows", "Farbpfeile", (r"farbpfeil",), size_mode="fixed", fixed_product="P-LBL-002"),
    R("equipotential", "Equipotential bonding", "Potentialverbindung", (r"potentialverbindung|potentialausgleich$",), size_mode="fixed",
      fixed_product="P-ACC-EQP"),
    R("install_kit", "Installation kit for transfer unit", "Einbausatz Überströmelement", (r"einbausatz",), size_mode="fixed", fixed_product="P-TRF-KIT"),
    R("base_pipe", "Base pipe (stainless)", "Sockelrohr", (r"sockelrohr",), size_mode="fixed", fixed_product="P-ACC-BASE"),
    R("kitchen_luminaire", "Kitchen ceiling luminaire cassette", "Lampenkassette", (r"lampenkassette|leuchte",), sections="A",
      size_mode="fixed", fixed_product="P-KIT-LMP"),
    R("kitchen_cassette", "Kitchen ceiling cassette", "Deckenkassette", (r"kassette",), sections="A", size_mode="fixed", fixed_product="P-KIT-CAS"),
    R("kitchen_supply", "Kitchen supply-air element", "Zuluftelement DQA", (r"\bdqa\b",), sections="A", size_mode="fixed", fixed_product="P-KIT-DQA"),
    R("kitchen_profile", "Wall connection profile", "L-Profil Wandanschluss", (r"l-profil",), size_mode="fixed", fixed_product="P-KIT-LPR"),
    R("ceiling_substructure", "Additional ceiling substructure", "Zusätzliche Deckenunterkonstruktion", (r"deckenunterkonstruktion",),
      size_mode="fixed", fixed_product="P-KIT-SUB"),
    R("kitchen_module", "Kitchen ventilated ceiling module", "Küchenlüftungsdecke (EVS)", (r"evs-w|abwascherei|kuche",), sections="A",
      install_code="KITCHEN_MODULE", size_mode="model_key", subcategory="Ventilated ceiling module"),
    R("ground_duct", "Pre-insulated ground duct system", "Erdverlegtes Lüftungsrohrsystem", (r"rohreinlagen|erdverlegung",),
      size_mode="keyword", extra={"keywords": (
          (r"bogen\s*45", "P-DCT-G-B45"), (r"bogen\s*90", "P-DCT-G-B90"), (r"verbindungsmanschette", "P-DCT-G-CON"),
          (r"ringraumdichtung|epdm", "P-DCT-G-CLP"), (r"mauerkragen|drueckend|druckendes", "P-DCT-G-SLV"), (r"rohr.*lange\s*\d", "P-DCT-G-250"))}),
    R("structural_calc", "Structural calculation", "Statische Berechnung", (r"statische berechnung",), size_mode="fixed", fixed_product="P-SRV-STAT"),
    R("freight", "Freight and handling", "Fracht und Handling", (r"versandkosten|fracht",), size_mode="fixed", fixed_product="P-SRV-FRT"),
    R("foil_cleaning", "Remove protective foil and clean", "Folie abziehen und reinigen", (r"abziehen der folie",), size_mode="fixed",
      fixed_product="P-SRV-FOIL"),
    # Air terminals and outdoor-air elements
    R("supply_valve", "Supply air disc valve", "Zuluft-Tellerventil", (r"zuluft\s*[-–]?\s*tellerventil",), install_code="DIFFUSER", size_mode="dn",
      subcategory="Supply valve"),
    R("exhaust_valve", "Exhaust air disc valve", "Abluft-Tellerventil", (r"abluft\s*[-–]?\s*tellerventil",), install_code="DIFFUSER", size_mode="dn",
      subcategory="Exhaust valve"),
    R("grille", "Air grille", "Luftgitter", (r"(zu|ab)luftgitter",), install_code="GRILLE", size_mode="rect", subcategory="Grille"),
    R("swirl_diffuser", "Swirl diffuser", "Wirbelstrahlauslass", (r"wirbel",), install_code="SWIRL_DIFFUSER", size_mode="model_key",
      subcategory="Swirl diffuser"),
    R("nozzle_outlet", "Nozzle duct outlet", "Düsenrohrdurchlass", (r"dusenrohr",), size_mode="fixed", fixed_product="P-NOZ-001"),
    R("transfer_unit", "Transfer air unit", "Überströmer", (r"uberstrom",), size_mode="fixed", fixed_product="P-TRF-001"),
    R("weather_louvre", "Weather louvre", "Wetterschutzgitter", (r"wetterschutzgitter",), install_code="LOUVRE", size_mode="rect",
      subcategory="Weather louvre"),
    R("louvre_hood", "Outdoor-air louvre hood", "Säulen-Lamellenhut", (r"lamellenhut",), size_mode="fixed", fixed_product="P-LHD-001"),
    R("rain_cap", "Rain cap", "Regenhut", (r"regenhut",), install_code="LOUVRE", size_mode="rect", subcategory="Rain cap"),
    R("ceiling_panel", "Ceiling air panel", "Frontplatte mit Luftführung", (r"frontplatte",), size_mode="fixed", fixed_product="P-CPL-001"),
    R("perforated_cladding", "Perforated decorative cladding", "Dekorlochblechverkleidung", (r"lochblechverkleidung",), size_mode="fixed",
      fixed_product="P-CPL-002"),
    # Dampers, fire protection
    R("fire_damper", "Fire damper", "Brandschutzklappe", (r"brandschutzklappe",), install_code="FIRE_DAMPER", size_mode="dn", subcategory="Fire damper"),
    R("manual_damper", "Manual balancing damper", "Drosselklappe", (r"drosselklappe",), install_code="DAMPER", size_mode="dn", subcategory="Manual damper"),
    R("flex_connector", "Flexible duct connector", "Dehnungsmanschette", (r"dehnungsmanschette",), size_mode="fixed", fixed_product="P-FLX-100"),
    R("fire_seal_round", "Fire penetration seal, round duct", "Brandschutz-Durchdringung rund", (r"durchdringung",), sections="F",
      install_code="FIRE_SEAL_ROUND", size_mode="dn", subcategory="Circular seal"),
    R("fire_seal_rect", "Fire penetration seal, rectangular duct", "Brandschutz-Durchdringung eckig", (r"kanalverstarkungs",), sections="F",
      install_code="FIRE_SEAL_RECT", size_mode="rect", subcategory="Rectangular seal"),
    R("fire_access", "Inspection cover in fire insulation", "Revisionsdeckel BS-Dämmung", (r"revisi\w*deckel",), sections="F",
      install_code="FIRE_ACCESS", size_mode="rect", subcategory="Inspection cover"),
    R("support_set", "Connection-angle set", "Anschlusswinkel", (r"anschlusswink",), install_code="SUPPORT_SET", size_mode="fixed", fixed_product="P-SUP-001"),
    R("cleaning_cover", "Duct cleaning cover", "Kontroll- und Putzdeckel", (r"putzdeckel",), install_code="ACCESSORY_SMALL", size_mode="dn_or_rect",
      subcategory="Cleaning cover"),
    # Silencers, flow controllers
    R("silencer_compact", "Compact circular silencer", "Kompakt-/Rohrschalldämpfer", (r"kompaktschalldampfer|rohrschalldampfer",),
      install_code="SILENCER", size_mode="dn", subcategory="Compact"),
    R("silencer_rect", "Rectangular duct silencer", "Kanalschalldämpfer", (r"schalldampfer",), install_code="SILENCER", size_mode="rect_len",
      subcategory="Rectangular"),
    R("cav", "Constant air-volume controller", "Volumenstromregler konstant", (r"volumenstromregler.*konstant",),
      install_code="CAV_CONTROLLER", size_mode="dn", subcategory="CAV circular"),
    R("vav", "Variable air-volume controller", "Volumenstromregler variabel", (r"volumenstromregler",),
      install_code="VAV_CONTROLLER", size_mode="dn_or_rect", subcategory="VAV"),
    # Controls and instruments
    R("smoke_detector", "Duct smoke detector", "Kanalrauchmelder", (r".",), (r"rauchmelder",), sections="D", size_mode="fixed", fixed_product="P-CTL-005"),
    R("actuator", "Damper actuator 24 V", "Drehantrieb", (r".",), (r"drehantrieb|stellantrieb",), sections="D", install_code="CONTROL_POINT",
      size_mode="fixed", fixed_product="P-CTL-003"),
    R("pressure_switch", "Differential pressure switch", "Druckwächter", (r".",), (r"druckwachter|differenzdruck",), sections="D",
      install_code="CONTROL_POINT", size_mode="fixed", fixed_product="P-CTL-001"),
    R("thermometer", "Dial thermometer", "Zeigerthermometer", (r"zeigerthermometer",), size_mode="fixed", fixed_product="P-CTL-006"),
    # Insulation (section F)
    R("insulation_weatherproof", "Weatherproof insulation with stainless cladding", "Wetterfeste Dämmung mit V2A-Ummantelung", (r".",),
      (r"wetterfest|ummantelung v2a",), sections="F", install_code="INSULATION_EXT", size_mode="fixed", fixed_product="P-INS-003"),
    R("insulation_fire", "Fire-rated duct insulation", "Brandschutzdämmung", (r"aussendammung ei|brandschutzverkleidung",), sections="F",
      install_code="FIRE_INSULATION", size_mode="fire_insulation"),
    R("insulation_thermal", "Thermal duct insulation", "Thermische Aussendämmung", (r"thermische aussendammung",), sections="F", size_mode="thickness"),
    R("insulation_wall", "Duct insulation at wall penetrations (15 mm)", "Kanal-Aussendämmung", (r"kanal-aussendammung",), sections="F",
      size_mode="fixed", fixed_product="P-INS-009"),
    # Ductwork, services, labelling, roof mounting
    R("leak_test", "Duct leakage test", "Kanaldichtheitsprüfung", (r"dichtheitsprufung",), size_mode="fixed", fixed_product="P-SRV-LEAK"),
    R("labels", "Labelling plates", "Bezeichnungsschilder", (r"bezeichnungsschild",), size_mode="fixed", fixed_product="P-LBL-001"),
    R("roof_foot", "Flat-roof mounting foot", "Montagefuss Flachdach", (r"montagefusse|montagefuss",), size_mode="fixed", fixed_product="P-RMS-FOOT"),
    R("roof_rail", "Mounting rail", "Montageschiene", (r"montageschiene|b \(mm\)",), size_mode="fixed", fixed_product="P-RMS-RAIL"),
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
