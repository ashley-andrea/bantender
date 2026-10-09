"""Company reference data: catalogue, productivity rules, project parameters.

These are internal company assets. They are loaded server-side from a versioned
directory and never uploaded by the estimator.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class CatalogItem(BaseModel):
    product_id: str
    category: str
    subcategory: str
    manufacturer: str
    model: str
    description: str
    unit: str
    list_price_chf: float
    discount_pct: float
    net_cost_chf: float
    install_code: str
    source_type: str  # "catalog" | "supplier_package"
    supplier_quote_required: bool


class ProductivityRule(BaseModel):
    install_code: str
    work_type: str
    unit: str
    base_hours_per_unit: float
    labour_role: str
    default_hourly_rate_chf: float
    factor_keys: list[str] = Field(default_factory=list)


class Allowances(BaseModel):
    material_waste_pct: float
    small_material_pct: float
    transport_equipment_pct: float
    supplier_package_contingency_pct: float


class ProjectCosts(BaseModel):
    engineering_hours: float
    engineering_rate_chf_per_h: float
    commissioning_hours: float
    commissioning_rate_chf_per_h: float
    hygiene_inspection_chf: float
    documentation_chf: float


class Commercial(BaseModel):
    overhead_pct: float
    target_margin_pct: float
    round_to_chf: float


class BidOptimization(BaseModel):
    enabled: bool = True
    output_name: str = "Recommended Bid Range"
    scenario_names: list[str]
    reference_win_probability: float
    price_sensitivity_probability_points_per_1pct_price: float
    strategic_appetite_adjustment: float
    competition_adjustment: float
    minimum_probability: float
    maximum_probability: float
    scenario_margins_pct: dict[str, float]
    model_inputs: list[str] = Field(default_factory=list)


class ProjectParameters(BaseModel):
    schema_version: str
    productivity_factors: dict[str, float]
    allowances: Allowances
    project_costs: ProjectCosts
    commercial: Commercial
    stretch_bid_optimization: BidOptimization


class ReferenceData(BaseModel):
    version: str
    catalog: dict[str, CatalogItem]
    rules: dict[str, ProductivityRule]
    parameters: ProjectParameters
