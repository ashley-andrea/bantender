"""Deterministic matching of LV lines to catalogue items, with explainable confidence and status.

No AI: category comes from the lexicon, the product from size filters on the catalogue,
confidence from checks a person can verify, the status from an ordered rule list.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.parsing.normalize import parse_sizes
from app.reference.models import CatalogItem, ReferenceData

from .lexicon import Rule, classify, fold, install_only_device
from .text import T

HIGH, MEDIUM = 0.85, 0.6
NEAREST_TOLERANCE = 0.25  # a "nearest size" substitute must be within ±25 % (diameter) or ~±56 % (area)
STATUSES = ("calculated", "supplier_quote_required", "assumption_applied", "review_required",
            "insufficient_information", "out_of_scope", "non_priceable")


@dataclass
class Check:
    key: str
    label: dict  # {"en", "de"}
    result: str  # pass | partial | fail
    score: float
    detail: str | dict = ""


@dataclass
class Alternative:
    product_id: str
    description: str
    net_cost_chf: float
    reason: str


@dataclass
class Decision:
    line_id: str
    rule_key: str | None
    title_en: str
    title_de: str
    product_id: str | None
    install_code: str | None
    quantity: float | None
    unit: str | None
    location: str
    status: str
    priced: bool
    confidence: float | None
    band: str | None  # high | medium | low
    checks: list[Check] = field(default_factory=list)
    reasons: list[dict] = field(default_factory=list)  # {"en", "de"}
    assumptions: list[dict] = field(default_factory=list)
    alternatives: list[Alternative] = field(default_factory=list)
    labour_only_possible: bool = False


# ---- catalogue sizes ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ItemSize:
    dn: float | None = None
    w: float | None = None
    h: float | None = None
    length: float | None = None
    airflow: float | None = None
    thickness: float | None = None


def item_size(item: CatalogItem) -> ItemSize:
    d = item.description
    dn = re.search(r"DN\s?(\d+)", d)
    rect = re.search(r"(\d+)x(\d+)(?:x(\d+))?\s*mm", d)
    air = re.search(r"(\d+)\s*m3/h", d)
    thick = re.search(r"(\d+)\s*mm\s+(?:mineral|external)", d)
    length = re.search(r"length\s+(\d+)\s*mm", d)
    return ItemSize(
        dn=float(dn.group(1)) if dn else None,
        w=float(rect.group(1)) if rect else None,
        h=float(rect.group(2)) if rect else None,
        length=float(rect.group(3)) if rect and rect.group(3) else (float(length.group(1)) if length else None),
        airflow=float(air.group(1)) if air else None,
        thickness=float(thick.group(1)) if thick else None,
    )


def candidates(ref: ReferenceData, rule: Rule, subcategory: str | None = None) -> list[CatalogItem]:
    sub = (subcategory or rule.subcategory or "").lower()
    return [i for i in ref.catalog.values()
            if i.install_code == rule.install_code and (not sub or sub in i.subcategory.lower())]


def _same_rect(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return sorted(a) == sorted(b)


# ---- decision ----------------------------------------------------------------------------------

def title_of(line: dict) -> str:
    return line.get("item_title") or line["header"] or (line["local_text"][0] if line["local_text"] else "")


def decide(line: dict, ref: ReferenceData, ahu_context: bool = False, extra_text: str = "", location: str = "default") -> Decision:
    title = title_of(line)
    device = install_only_device(line["description"], line["local_text"], line["section"])
    if device:
        return _install_only(line, device, location)
    rule = classify(title, line["description"], line["section"])
    d = Decision(line_id=line["line_id"], rule_key=rule.key if rule else None,
                 title_en=rule.en if rule else title, title_de=title,
                 product_id=None, install_code=rule.install_code if rule else None,
                 quantity=line["quantity"], unit=line["unit"], location=location,
                 status="review_required", priced=False, confidence=None, band=None)

    if rule is None and line.get("item_title") and line["header"]:
        parent = classify(line["header"], line["description"], line["section"])
        if parent is not None:
            # A sub-item (accessory / option) inside a known item's block.
            d.rule_key, d.title_en = "accessory", f"Accessory to {parent.en.lower()}"
            d.reasons.append(T(f"Accessory or option within the '{parent.en}' item; no catalogue item. Enter a unit price or exclude it.",
                               f"Zubehör oder Option zu «{parent.de}»; kein Katalogartikel. Einheitspreis eingeben oder ausschliessen."))
            if line["quantity"] is None:
                d.status = "insufficient_information"
            return d
    if rule is None:
        d.reasons.append(T("Not recognised by the classification rules. Classify or price it manually.", "Von den Klassifizierungsregeln nicht erkannt. Bitte manuell zuordnen oder bepreisen."))
        return d

    if rule.disposition == "non_priceable":
        d.status, d.reasons = "non_priceable", [T(rule.note, rule.note_de)]
        return d
    if rule.disposition == "covered":
        d.status, d.reasons = "out_of_scope", [T(rule.note, rule.note_de)]
        return d
    if ahu_context and rule.key not in ("ahu",) and line["section"] == "A" and rule.disposition is None and rule.size_mode == "none":
        d.status, d.reasons = "non_priceable", [T("Included in the air-handling unit package.", "Im Lüftungsgeräte-Paket enthalten.")]
        return d

    # Quantity
    QTY = T("Quantity and unit read from the tender", "Menge und Einheit aus der Ausschreibung gelesen")
    qty_check = Check("quantity", QTY, "pass", 1.0,
                      f"{line['quantity']:g} {line['unit_raw']}" if line["quantity"] is not None else "")
    if line["quantity"] is None:
        if rule.key == "ahu":
            d.quantity = 1.0
            d.assumptions.append(T("The tender leaves the quantity blank; one unit is assumed (one unit per numbered device).", "Die Menge ist in der Ausschreibung leer; ein Gerät angenommen (ein Gerät pro Gerätenummer)."))
            qty_check = Check("quantity", QTY, "partial", 0.7, T("blank in tender; 1 assumed", "leer in der Ausschreibung; 1 angenommen"))
        else:
            d.status = "insufficient_information"
            d.reasons.append(T("The tender gives no quantity for this line.", "Die Ausschreibung nennt keine Menge für diese Position."))
            d.checks.append(Check("quantity", QTY, "fail", 0.0, T("blank in tender", "leer in der Ausschreibung")))
            return d
    d.checks.append(qty_check)

    if rule.disposition == "no_catalogue":
        d.status = "review_required"
        d.reasons.append(T(f"No catalogue item for '{rule.en}'. Enter a unit price, choose a product, or price labour only.",
                            f"Kein Katalogartikel für «{rule.de}». Einheitspreis eingeben, Produkt wählen oder nur Montage kalkulieren."))
        d.labour_only_possible = bool(rule.install_code)
        return d

    sizes = parse_sizes(line["description"] + (" | " + extra_text if extra_text else ""))
    if rule.key == "silencer_compact" and sizes.dn_mm is None and "lange" in fold(line["description"]):
        m = re.match(r"^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s", (line["local_text"] or [""])[-1])
        if m:  # inline table: Länge (cm) | Ø innen (cm) | …
            sizes.length_mm, sizes.dn_mm = float(m.group(1)) * 10, float(m.group(2)) * 10
    product, size_check, assumption = _choose_product(rule, sizes, line, ref, d)
    if product is None and line["local_text"]:
        # The block header's rule found nothing: the line's own text may name a more specific item
        # ("… für Erdverlegung …" under "Rohreinlagen unter Bodenplatte").
        own = classify(" ".join(line["local_text"]), line["description"], line["section"])
        if own is not None and own.key != rule.key and own.size_mode == "fixed":
            rule = own
            d.rule_key, d.title_en, d.install_code = own.key, own.en, own.install_code
            product, size_check, assumption = _choose_product(own, sizes, line, ref, d)
    if product is None:
        d.status = "review_required"
        d.reasons.append(T(f"No catalogue item fits this {rule.en.lower()}.", f"Kein passender Katalogartikel für «{rule.de}»."))
        if size_check:
            d.checks.append(size_check)
        d.labour_only_possible = bool(rule.install_code)
        return d

    item = ref.catalog[product]
    d.product_id, d.install_code = product, item.install_code
    d.checks.append(Check("category", T("Item type matches the catalogue", "Artikeltyp passt zum Katalog"), "pass", 1.0, f"{rule.de} → {item.subcategory}"))
    if size_check:
        d.checks.append(size_check)
    unit_ok = d.unit == item.unit
    d.checks.append(Check("unit", T("Unit matches the catalogue", "Einheit passt zum Katalog"), "pass" if unit_ok else "fail", 1.0 if unit_ok else 0.5,
                          f"{d.unit} vs {item.unit}"))
    if rule.note:
        d.checks.append(Check("function", T("Function matches", "Funktion passt"), "partial", 0.7, T(rule.note, rule.note_de)))
    if assumption:
        d.assumptions.append(assumption)

    d.confidence = 1.0
    for c in d.checks:
        d.confidence *= c.score
    d.band = "high" if d.confidence >= HIGH else "medium" if d.confidence >= MEDIUM else "low"
    d.priced = True

    # Flags are kept for what genuinely needs the estimator: supplier quotes. Confidence is shown, not flagged.
    if item.supplier_quote_required:
        d.status = "supplier_quote_required"
        d.reasons.append(T("Supplier package: the catalogue price is a placeholder until a quote is received.",
                            "Lieferantenpaket: Der Katalogpreis ist ein Richtwert, bis eine Offerte vorliegt."))
    elif d.assumptions:
        d.status = "assumption_applied"
    else:
        d.status = "calculated"
    return d


def _install_only(line: dict, device: tuple[str, str], location: str) -> Decision:
    en, de = device
    d = Decision(line_id=line["line_id"], rule_key="field_device_install", title_en=f"{en} (install only)", title_de=de,
                 product_id=None, install_code="CONTROL_POINT", quantity=line["quantity"], unit=line["unit"],
                 location=location, status="calculated", priced=True, confidence=None, band=None)
    if line["quantity"] is None:
        d.status, d.priced = "insufficient_information", False
        d.reasons.append(T("The tender gives no quantity for this line.", "Die Ausschreibung nennt keine Menge für diese Position."))
        return d
    d.checks = [
        Check("quantity", T("Quantity and unit read from the tender", "Menge und Einheit aus der Ausschreibung gelesen"), "pass", 1.0,
              f"{line['quantity']:g} {line['unit_raw']}"),
        Check("scope", T("Scope stated in the tender", "Leistungsumfang gemäss Ausschreibung"), "pass", 1.0,
              T("'Einbau der folgenden Feldgeräte': install only", "«Einbau der folgenden Feldgeräte»: nur Montage")),
    ]
    d.confidence, d.band = 1.0, "high"
    d.reasons.append(T("Install only: the device itself comes with the separate controls tender. Labour is priced, material is not.",
                       "Nur Montage: Das Gerät wird mit der separaten MSRL-Ausschreibung geliefert. Kalkuliert wird nur die Montage."))
    return d


def _choose_product(rule: Rule, sizes, line: dict, ref: ReferenceData, d: Decision):
    """Return (product_id | None, size check | None, assumption text | None)."""
    mode = rule.size_mode
    if mode == "fixed":
        return rule.fixed_product, None, None

    if mode == "thickness":
        t = sizes.thickness_mm
        hit = next((i for i in ref.catalog.values() if i.category == "Insulation" and i.source_type == "catalog"
                    and item_size(i).thickness == t), None)
        if hit:
            return hit.product_id, Check("size", T("Insulation thickness matches", "Dämmstärke passt"), "pass", 1.0, f"{t:g} mm"), None
        return None, Check("size", T("Insulation thickness matches", "Dämmstärke passt"), "fail", 0.0,
                     T(f"{t:g} mm not in catalogue", f"{t:g} mm nicht im Katalog") if t else T("thickness not stated", "Dämmstärke nicht angegeben")), None

    if mode == "airflow":
        need = sizes.airflow_m3h
        items = sorted(candidates(ref, rule), key=lambda i: item_size(i).airflow or 0)
        if not need:
            return None, Check("size", T("Airflow stated", "Luftmenge angegeben"), "fail", 0.0, T("no airflow found", "keine Luftmenge gefunden")), None
        fit = next((i for i in items if (item_size(i).airflow or 0) >= need), items[-1] if items else None)
        if not fit:
            return None, None, None
        _alts(d, items, fit, "other unit size")
        return (fit.product_id, Check("size", T("Unit sized by airflow", "Gerät nach Luftmenge gewählt"), "pass", 1.0, f"{need:g} m³/h → {item_size(fit).airflow:g} m³/h"),
                T(f"Unit chosen as the smallest catalogue unit for {need:g} m³/h.", f"Kleinstes Katalog-Gerät für {need:g} m³/h gewählt."))

    if mode == "keyword":
        # One rule covers a family of components; the line's own text names which one (bend 45°, sleeve, pipe …).
        own = fold(" ".join(line["local_text"]) or line["description"])
        for pattern, pid in rule.extra["keywords"]:
            if re.search(pattern, own):
                item = ref.catalog[pid]
                check = Check("size", T("Component named in the tender text", "Bauteil im Ausschreibungstext genannt"), "pass", 1.0, item.description)
                m = re.search(r"lange\s*(\d+(?:[.,]\d+)?)\s*m\b", own)
                if item.unit == "m" and m:
                    length = float(m.group(1).replace(",", "."))
                    d.quantity, d.unit = (line["quantity"] or 0) * length, "m"
                    return pid, check, T(f"{line['quantity']:g} pieces × {length:g} m = {d.quantity:g} m of pipe.",
                                         f"{line['quantity']:g} Stück × {length:g} m = {d.quantity:g} m Rohr.")
                return pid, check, None
        return None, Check("size", T("Component named in the tender text", "Bauteil im Ausschreibungstext genannt"), "fail", 0.0, ""), None

    if mode == "duct_length":
        m = re.search(r"l[äa]nge\s*(\d+(?:[.,]\d+)?)\s*m\b", fold(line["description"]))
        dn = sizes.dn_mm
        item = next((i for i in candidates(ref, rule) if item_size(i).dn == dn), None)
        if not (m and item):
            return None, Check("size", T("Duct size and length stated", "Rohrgrösse und Länge angegeben"), "fail", 0.0, T("length or DN missing", "Länge oder DN fehlt")), None
        length = float(m.group(1).replace(",", "."))
        qty = (line["quantity"] or 0) * length
        d.quantity, d.unit = qty, "m"
        return (item.product_id, Check("size", T("Diameter matches", "Durchmesser passt"), "pass", 1.0, f"DN{dn:g}"),
                T(f"{line['quantity']:g} pieces × {length:g} m = {qty:g} m of duct.", f"{line['quantity']:g} Stück × {length:g} m = {qty:g} m Rohr."))

    if mode == "model_key":
        # The catalogue model carries the distinguishing size, e.g. "SWL-2x179", "EVS-W-3600x1300".
        text = re.sub(r"\s+", "", fold(line["description"]))
        for item in candidates(ref, rule):
            keys = re.findall(r"\d+x\d+", item.model.lower())
            if keys and all(k in text for k in keys):
                return item.product_id, Check("size", T("Model size found in the tender text", "Modellgrösse im Ausschreibungstext gefunden"),
                                              "pass", 1.0, item.model), None
        return None, Check("size", T("Model size found in the tender text", "Modellgrösse im Ausschreibungstext gefunden"), "fail", 0.0, ""), None

    if mode == "fire_insulation":
        title = fold(title_of(line))
        pid = ("P-INS-007" if "verkleidung" in title else "P-INS-006" if "ei60" in title and "100" in title
               else "P-INS-005" if "ei60" in title else "P-INS-004")
        item = ref.catalog[pid]
        return pid, Check("size", T("Fire class and thickness match", "Brandschutzklasse und Stärke passen"), "pass", 1.0, item.subcategory), None

    items = candidates(ref, rule)
    if mode == "dn_or_rect":
        mode = "rect" if sizes.width_mm and sizes.height_mm else "dn"
        items = [i for i in items if (item_size(i).w if mode == "rect" else item_size(i).dn)]
    if not items:
        return None, None, None

    if mode == "dn":
        dn = sizes.dn_mm
        if dn is None:
            return None, Check("size", T("Diameter stated", "Durchmesser angegeben"), "fail", 0.0, T("no diameter found", "kein Durchmesser gefunden")), None
        exact = [i for i in items if item_size(i).dn == dn]
        if exact:
            _alts(d, items, exact[0], "different diameter")
            return exact[0].product_id, Check("size", T("Diameter matches exactly", "Durchmesser passt genau"), "pass", 1.0, f"DN{dn:g}"), None
        near = min(items, key=lambda i: abs((item_size(i).dn or 1e9) - dn))
        if abs(item_size(near).dn - dn) / dn > NEAREST_TOLERANCE:
            return None, Check("size", T("Diameter matches", "Durchmesser passt"), "fail", 0.0,
                         T(f"DN{dn:g}: no catalogue size within ±25 %", f"DN{dn:g}: keine Kataloggrösse innerhalb ±25 %")), None
        _alts(d, items, near, "different diameter")
        return (near.product_id, Check("size", T("Diameter matches", "Durchmesser passt"), "partial", 0.6, f"DN{dn:g} → DN{item_size(near).dn:g}"),
                T(f"DN{dn:g} is not in the catalogue; priced as DN{item_size(near).dn:g}.", f"DN{dn:g} ist nicht im Katalog; als DN{item_size(near).dn:g} kalkuliert."))

    if mode in ("rect", "rect_len"):
        if not (sizes.width_mm and sizes.height_mm):
            return None, Check("size", T("Dimensions stated", "Abmessungen angegeben"), "fail", 0.0, T("no B×H found", "keine B×H gefunden")), None
        wh = (sizes.width_mm, sizes.height_mm)
        label = f"{wh[0]:g}×{wh[1]:g}" + (f"×{sizes.length_mm:g}" if mode == "rect_len" and sizes.length_mm else "")
        exact = [i for i in items if item_size(i).w and _same_rect(wh, (item_size(i).w, item_size(i).h))]
        if mode == "rect_len" and sizes.length_mm:
            exact_len = [i for i in exact if item_size(i).length == sizes.length_mm]
            exact = exact_len or exact
        if exact:
            _alts(d, items, exact[0], "different size")
            return exact[0].product_id, Check("size", T("Dimensions match exactly", "Abmessungen passen genau"), "pass", 1.0, f"{label} mm"), None
        sized = [i for i in items if item_size(i).w]
        if not sized:
            return None, None, None
        near = min(sized, key=lambda i: abs(item_size(i).w * item_size(i).h - wh[0] * wh[1]))
        ratio = item_size(near).w * item_size(near).h / (wh[0] * wh[1])
        if not 1 / (1 + NEAREST_TOLERANCE) ** 2 <= ratio <= (1 + NEAREST_TOLERANCE) ** 2:
            return None, Check("size", T("Dimensions match", "Abmessungen passen"), "fail", 0.0,
                         T(f"{label} mm: no catalogue size close enough", f"{label} mm: keine ähnliche Kataloggrösse")), None
        _alts(d, sized, near, "different size")
        ns = item_size(near)
        return (near.product_id, Check("size", T("Dimensions match", "Abmessungen passen"), "partial", 0.6, f"{label} → {ns.w:g}×{ns.h:g}"),
                T(f"{label} mm is not in the catalogue; priced as {ns.w:g}×{ns.h:g} mm.", f"{label} mm ist nicht im Katalog; als {ns.w:g}×{ns.h:g} mm kalkuliert."))

    return None, None, None


def _alts(d: Decision, items: list[CatalogItem], chosen: CatalogItem, reason: str) -> None:
    d.alternatives = [Alternative(i.product_id, i.description, i.net_cost_chf, reason)
                      for i in items if i.product_id != chosen.product_id][:3]


def decide_all(lines: list[dict], ref: ReferenceData, locations: dict[str, str] | None = None) -> list[Decision]:
    """Decide every line; lines inside an air-handling unit block are treated as part of that package."""
    out, in_ahu = [], False
    rules = [classify(title_of(l), l["description"], l["section"]) for l in lines]
    for i, (line, rule) in enumerate(zip(lines, rules)):
        if line["section"] != "A" or line["system"] != lines[i - 1]["system"]:
            in_ahu = False
        extra = ""
        # "wie vorbeschrieben, jedoch …" (as described above, but …): sizes come from the line above in the same item.
        if "wie vorbeschrieben" in fold(" ".join(line["local_text"])) and i and lines[i - 1]["header"] == line["header"]:
            extra = lines[i - 1]["description"]
        if rule and rule.key == "ahu":
            in_ahu = True
            # The unit's data (airflow etc.) is listed below its head row: read ahead within the block.
            block = []
            for nxt, nrule in zip(lines[i + 1:], rules[i + 1:]):
                if nxt["section"] != "A" or nxt["system"] != line["system"] or not (nrule and nrule.key == "ahu_part"):
                    break
                block.append(nxt["description"])
            extra = " | ".join(block)
        out.append(decide(line, ref, ahu_context=in_ahu and not (rule and rule.key == "ahu"), extra_text=extra,
                          location=(locations or {}).get(line["system"], "default")))
    return out
