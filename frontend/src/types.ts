export type BBox = [number, number, number, number]

export interface Sizes {
  dn_mm?: number
  width_mm?: number
  height_mm?: number
  length_mm?: number
  airflow_m3h?: number
  thickness_mm?: number
  fire_class?: string
  notes?: string[]
}

export interface Line {
  line_id: string
  page: number
  system: string
  system_name: string
  lot: string
  section: string
  section_name: string
  header: string
  shared_text: string[]
  local_text: string[]
  quantity: number | null
  unit_raw: string
  unit: string | null
  row_bbox: BBox
  header_page: number | null
  header_bbox: BBox | null
  flags: string[]
  description: string
  sizes: Sizes
  size_key: string | null
}

export interface Anomaly {
  page: number
  code: string
  message: string
}

export interface SystemInfo {
  name: string
  lot: string
  first_page: number
  last_page: number
}

export interface Parsed {
  meta: {
    pages: number
    filename?: string
    parser_version?: string
    lv_reader: string
    component_reader: string
    cross_check?: string
    page_sizes: Record<string, [number, number]>
  }
  systems: Record<string, SystemInfo>
  lines: Line[]
  anomalies: Anomaly[]
  component_rows: { page: number; system: string; table: string; quantity: number; code: string; name: string; dims: number[] }[]
}

export interface TenderSummary {
  tender_id: string
  filename: string | null
  pages: number
  systems: Record<string, SystemInfo>
  lines: number
  anomalies: number
}

export interface Check {
  key: string
  label: string
  result: 'pass' | 'partial' | 'fail'
  score: number
  detail: string
}

export interface TraceStep {
  label: string
  formula: string
  value: number
  sources: string[]
}

export interface Decision {
  line_id: string
  rule_key: string | null
  title_en: string
  title_de: string
  product_id: string | null
  install_code: string | null
  quantity: number | null
  unit: string | null
  location: string
  status: string
  priced: boolean
  confidence: number | null
  band: 'high' | 'medium' | 'low' | null
  checks: Check[]
  reasons: string[]
  assumptions: string[]
  alternatives: { product_id: string; description: string; net_cost_chf: number; reason: string }[]
  labour_only_possible: boolean
  overridden: string[]
  override_note: string | null
}

export interface LineCost {
  net_unit_cost: number
  price_source: string
  material_cost: number
  adjusted_hours: number
  hourly_rate: number
  labour_role: string
  labour_cost: number
  direct_cost: number
  trace: TraceStep[]
}

export interface PricedLine {
  line_id: string
  source: 'lv' | 'cad'
  page: number
  system: string
  lot: string
  section: string
  title_en: string
  title_de: string
  tender_quantity: number | null
  tender_unit: string | null
  decision: Decision
  cost: LineCost | null
  evidence: { page: number; bbox: BBox }[] | null
  pages: number[] | null
}

export interface ProjectCost {
  material: number
  supplier_material: number
  labour: number
  lines_direct: number
  transport: number
  small_material: number
  supplier_contingency: number
  engineering: number
  commissioning: number
  hygiene: number
  documentation: number
  direct: number
  risk: number
  overhead: number
  baseline: number
  margin_pct: number
  selling_price_exact: number
  selling_price: number
  trace: TraceStep[]
}

export interface Scenario {
  name: string
  margin_pct: number
  bid_price: number
  win_probability: number
  expected_contribution: number
}

export interface Pricing {
  lines: PricedLine[]
  project: ProjectCost
  scenarios: Scenario[]
  summary: {
    lv_lines: number
    cad_lines: number
    actionable_lines: number
    priced_lines: number
    coverage_pct: number
    value_confirmed_pct: number
    needs_price: number
    by_status: Record<string, { count: number; chf: number }>
    by_system: Record<string, number>
    by_lot: Record<string, number>
  }
  settings: {
    factors: Record<string, number>
    margin_pct: number
    risk_allowance_chf: number
    include_project_costs: boolean
    include_cad_ductwork: boolean
    overhead_pct: number
  }
  anomalies: Anomaly[]
}

export interface Override {
  quantity?: number
  product_id?: string
  unit_price?: number
  unit_price_source?: string
  labour_only?: boolean
  status?: string
  confirmed?: boolean
  note?: string
}
