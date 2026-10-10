"""Deterministic pricing engine.

Pure functions only: no I/O, no AI. Every result carries a trace of the
formula steps and the reference rows it used, so the UI can explain any number.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from app.reference.models import ProjectParameters, ReferenceData

SITE_EFFICIENCY = "site_efficiency"
HEIGHT_PREFIX = "mounting_height_"


@dataclass(frozen=True)
class TraceStep:
    label: str
    formula: str
    value: float
    sources: tuple[str, ...] = ()


@dataclass(frozen=True)
class LineInput:
    line_id: str
    quantity: float
    unit: str
    product_id: str | None
    install_code: str | None
    # Mounting-height location: "default" keeps the rule's own factor; any other value selects
    # "mounting_height_<location>" when the parameters define it (e.g. "sports_hall").
    location: str = "default"
    unit_cost_override: float | None = None  # estimator input or supplier quote
    unit_cost_source: str | None = None


@dataclass(frozen=True)
class LineCost:
    line_id: str
    quantity: float
    unit: str
    product_id: str | None
    install_code: str | None
    net_unit_cost: float
    price_source: str  # catalog | supplier_package | estimator_input | quote | none
    material_cost: float
    factor: float
    adjusted_hours: float
    hourly_rate: float
    labour_role: str
    labour_cost: float
    direct_cost: float
    trace: tuple[TraceStep, ...] = field(default_factory=tuple)


def _fmt(x: float) -> str:
    return f"{x:,.2f}".replace(",", "'")


def factor_for(rule_keys: list[str], factors: dict[str, float], location: str) -> tuple[float, list[str]]:
    """Product of the rule's project factors; site_efficiency is applied as 1/x."""
    product, parts = 1.0, []
    for key in rule_keys:
        if key.startswith(HEIGHT_PREFIX) and location != "default" and f"{HEIGHT_PREFIX}{location}" in factors:
            key = f"{HEIGHT_PREFIX}{location}"
        value = factors[key]
        if key == SITE_EFFICIENCY:
            product /= value
            parts.append(f"1/{value:g} ({key})")
        else:
            product *= value
            parts.append(f"{value:g} ({key})")
    return product, parts


def price_line(line: LineInput, ref: ReferenceData, params: ProjectParameters | None = None) -> LineCost:
    params = params or ref.parameters
    waste = params.allowances.material_waste_pct / 100
    trace: list[TraceStep] = []

    item = ref.catalog.get(line.product_id) if line.product_id else None
    if line.unit_cost_override is not None:
        net_unit, price_source = line.unit_cost_override, line.unit_cost_source or "estimator_input"
        unit_src = (f"override:{price_source}",)
    elif item is not None:
        net_unit = item.net_cost_chf
        price_source = item.source_type
        unit_src = (f"catalog:{item.product_id}",)
    else:
        net_unit, price_source, unit_src = 0.0, "none", ()

    material = line.quantity * net_unit * (1 + waste)
    trace.append(TraceStep(
        "Material",
        f"{line.quantity:g} {line.unit} × CHF {_fmt(net_unit)} × (1 + {params.allowances.material_waste_pct:g}% waste)",
        material,
        unit_src + ("parameter:allowances.material_waste_pct",),
    ))

    install_code = line.install_code or (item.install_code if item else None)
    rule = ref.rules.get(install_code) if install_code else None
    if rule is not None and rule.base_hours_per_unit > 0:
        factor, parts = factor_for(rule.factor_keys, params.productivity_factors, line.location)
        hours = line.quantity * rule.base_hours_per_unit * factor
        rate, role = rule.default_hourly_rate_chf, rule.labour_role
        trace.append(TraceStep(
            "Installation hours",
            f"{line.quantity:g} × {rule.base_hours_per_unit:g} h × " + " × ".join(parts),
            hours,
            (f"rule:{rule.install_code}",) + tuple(f"parameter:productivity_factors.{p.split('(')[1][:-1]}" for p in parts),
        ))
    else:
        factor, hours, rate, role = 1.0, 0.0, 0.0, "none"

    labour = hours * rate
    trace.append(TraceStep("Labour", f"{hours:.2f} h × CHF {rate:g}/h ({role})", labour,
                           (f"rule:{install_code}",) if rule else ()))
    direct = material + labour
    trace.append(TraceStep("Direct cost", f"{_fmt(material)} + {_fmt(labour)}", direct))

    return LineCost(
        line_id=line.line_id, quantity=line.quantity, unit=line.unit, product_id=line.product_id,
        install_code=install_code, net_unit_cost=net_unit, price_source=price_source,
        material_cost=material, factor=factor, adjusted_hours=hours, hourly_rate=rate,
        labour_role=role, labour_cost=labour, direct_cost=direct, trace=tuple(trace),
    )


@dataclass(frozen=True)
class BuildUpOptions:
    """Switches for project-level terms. The golden subset uses transport + overhead only."""
    include_project_costs: bool = True
    include_small_material: bool = True
    include_supplier_contingency: bool = True
    risk_allowance_chf: float = 0.0
    margin_pct: float | None = None  # defaults to commercial.target_margin_pct


@dataclass(frozen=True)
class ProjectCost:
    material: float
    supplier_material: float
    labour: float
    lines_direct: float
    transport: float
    small_material: float
    supplier_contingency: float
    engineering: float
    commissioning: float
    hygiene: float
    documentation: float
    direct: float
    risk: float
    overhead: float
    baseline: float
    margin_pct: float
    selling_price_exact: float
    selling_price: float
    trace: tuple[TraceStep, ...]


def round_up(value: float, step: float) -> float:
    return math.ceil(value / step - 1e-9) * step if step else value


def build_project(lines: list[LineCost], params: ProjectParameters, opts: BuildUpOptions = BuildUpOptions()) -> ProjectCost:
    a, pc, cm = params.allowances, params.project_costs, params.commercial
    supplier_material = sum(l.material_cost for l in lines if l.price_source == "supplier_package")
    material = sum(l.material_cost for l in lines)
    catalog_material = material - supplier_material
    labour = sum(l.labour_cost for l in lines)
    lines_direct = material + labour

    transport = lines_direct * a.transport_equipment_pct / 100
    small = catalog_material * a.small_material_pct / 100 if opts.include_small_material else 0.0
    contingency = supplier_material * a.supplier_package_contingency_pct / 100 if opts.include_supplier_contingency else 0.0
    if opts.include_project_costs:
        eng = pc.engineering_hours * pc.engineering_rate_chf_per_h
        com = pc.commissioning_hours * pc.commissioning_rate_chf_per_h
        hyg, doc = pc.hygiene_inspection_chf, pc.documentation_chf
    else:
        eng = com = hyg = doc = 0.0

    direct = lines_direct + transport + small + contingency + eng + com + hyg + doc
    risk = opts.risk_allowance_chf
    overhead = (direct + risk) * cm.overhead_pct / 100
    baseline = direct + risk + overhead
    margin = cm.target_margin_pct if opts.margin_pct is None else opts.margin_pct
    exact = baseline / (1 - margin / 100)
    price = round_up(exact, cm.round_to_chf)

    trace = (
        TraceStep("Line material", "Σ line material", material),
        TraceStep("Line labour", "Σ line labour", labour),
        TraceStep("Transport / equipment", f"{a.transport_equipment_pct:g}% × line direct", transport, ("parameter:allowances.transport_equipment_pct",)),
        TraceStep("Small material", f"{a.small_material_pct:g}% × catalogue material", small, ("parameter:allowances.small_material_pct",)),
        TraceStep("Supplier contingency", f"{a.supplier_package_contingency_pct:g}% × supplier-package material", contingency, ("parameter:allowances.supplier_package_contingency_pct",)),
        TraceStep("Engineering", f"{pc.engineering_hours:g} h × CHF {pc.engineering_rate_chf_per_h:g}", eng, ("parameter:project_costs",)),
        TraceStep("Commissioning", f"{pc.commissioning_hours:g} h × CHF {pc.commissioning_rate_chf_per_h:g}", com, ("parameter:project_costs",)),
        TraceStep("Hygiene inspection", "fixed", hyg, ("parameter:project_costs.hygiene_inspection_chf",)),
        TraceStep("Documentation", "fixed", doc, ("parameter:project_costs.documentation_chf",)),
        TraceStep("Risk / opportunities", "estimator input", risk),
        TraceStep("Overhead", f"{cm.overhead_pct:g}% × (direct + risk)", overhead, ("parameter:commercial.overhead_pct",)),
        TraceStep("Cost baseline", "direct + risk + overhead", baseline),
        TraceStep("Selling price", f"baseline ÷ (1 − {margin:g}%), rounded up to CHF {cm.round_to_chf:g}", price, ("parameter:commercial",)),
    )
    return ProjectCost(
        material=material, supplier_material=supplier_material, labour=labour, lines_direct=lines_direct,
        transport=transport, small_material=small, supplier_contingency=contingency, engineering=eng,
        commissioning=com, hygiene=hyg, documentation=doc, direct=direct, risk=risk, overhead=overhead,
        baseline=baseline, margin_pct=margin, selling_price_exact=exact, selling_price=price, trace=trace,
    )
