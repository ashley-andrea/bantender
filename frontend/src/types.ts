export type BBox = [number, number, number, number]
export type Text = string | { en: string; de: string }

export interface SourceRow {
  page: number
  bbox: BBox | null
  text: string
}

export type Level = 'read' | 'derived' | 'assumed' | 'missing' | 'n/a'

export interface Attribute {
  key: string
  label: Text
  value: Text | null
  sources: SourceRow[]
  level: Level
  why: Text
}

export interface ParsedLine {
  line_id: string
  page: number
  system: string
  system_name: string
  lot: string
  section: string
  section_name: string
  header: string
  item_title: string | null
  quantity: number | null
  unit_raw: string
  unit: string | null
  row_bbox: BBox
  description: string
  rows: { role: string; text: string; page: number; bbox: BBox }[]
}

export interface SystemInfo {
  name: string
  name_en?: string
  lot: string
  location?: string
  first_page: number
  last_page: number
}

export interface Anomaly {
  page: number
  code: string
  message: string
  message_de?: string
}

export interface TenderProject {
  name: string | null
  bkp: string | null
  trade_en: string | null
  trade_de: string | null
}

export interface Parsed {
  meta: { pages: number; filename?: string; page_sizes: Record<string, [number, number]>; parse_seconds?: number }
  project: TenderProject
  lots: Record<string, { name: string | null; name_en?: string | null; systems: string[] }>
  systems: Record<string, SystemInfo>
  pages: { page: number; kind: string }[]
  lines: ParsedLine[]
  anomalies: Anomaly[]
}

export interface TenderSummary {
  tender_id: string
  filename: string | null
  project?: TenderProject
  pages: number
  systems: Record<string, SystemInfo>
  lines: number
  anomalies: number
  parse_seconds?: number
}

export interface Check {
  key: string
  label: Text
  result: 'pass' | 'partial' | 'fail'
  score: number
  detail: Text
}

export interface TraceStep {
  label: string
  formula: string
  value: number
  sources: string[]
}

export interface Decision {
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
  checks: Check[]
  reasons: Text[]
  assumptions: Text[]
  overridden: string[]
}

export interface LineCost {
  net_unit_cost: number
  price_source: string
  material_cost: number
  factor: number
  adjusted_hours: number
  hourly_rate: number
  labour_role: string
  labour_cost: number
  direct_cost: number
  base_hours: number
  trace: TraceStep[]
}

export interface PricedLine {
  line_id: string
  source: 'lv' | 'cad'
  page: number
  system: string
  lot: string
  section: string
  section_name: string
  section_name_en: string
  title_en: string
  title_de: string
  decision: Decision
  cost: LineCost | null
  status_key: string
  evidence: { page: number; bbox: BBox }[] | null
  attributes: Attribute[]
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
  selling_price: number
  selling_price_exact?: number
  trace?: TraceStep[]
}

export interface Settings {
  factors: Record<string, number>
  allowances: Record<string, number>
  project_costs: Record<string, number>
  overhead_pct: number
  margin_pct: number
  target_margin_pct: number
  round_to_chf: number
  risk_allowance_chf: number
  include_cad_ductwork: boolean
  locations: Record<string, string>
  location_options: string[]
  discount_pct: number
  cash_discount_pct: number
}

export interface Pricing {
  lines: PricedLine[]
  project: ProjectCost
  settings: Settings
  summary: {
    tender: { lines: number; excluded: number; to_price: number; priced: number; unpriced: number; missing_info: number }
    cad: { lines: number; chf: number }
    by_system: Record<string, number>
  }
  tender: { project: TenderProject; lots: Record<string, { name: string | null; systems: string[] }>; systems: Record<string, SystemInfo> }
  anomalies: Anomaly[]
}

export interface CatalogItem {
  product_id: string
  category: string
  subcategory: string
  manufacturer: string
  model: string
  description: string
  unit: string
  list_price_chf: number
  discount_pct: number
  net_cost_chf: number
  install_code: string
  source_type: string
  supplier_quote_required: boolean
}

export interface ProductivityRule {
  install_code: string
  work_type: string
  unit: string
  base_hours_per_unit: number
  labour_role: string
  default_hourly_rate_chf: number
  factor_keys: string[]
}

export interface CatalogContext {
  item: CatalogItem
  family: CatalogItem[]
  rule: ProductivityRule | null
  reference_version: string
}

export interface OfferLine {
  kind: 'priced' | 'included' | 'empty'
  unit_price?: number
  amount?: number
  quantity?: number
  includes_labour?: boolean
  raw?: number
}

export interface Offer {
  factor: number
  selling_price: number
  brutto: number
  rounding_difference: number
  lines: Record<string, OfferLine>
  systems: Record<string, { sections: Record<string, number>; montage: number; services: number; hygiene: number; cad_material: number; labour_hours: number; total: number }>
  lots: Record<string, number>
  conditions: Record<string, number>
  fields: { page: number; bbox: BBox; text: string; kind: string; ref: string }[]
}

export interface ReferenceParameters {
  productivity_factors: Record<string, number>
  allowances: Record<string, number>
  project_costs: Record<string, number>
  commercial: { overhead_pct: number; target_margin_pct: number; round_to_chf: number }
}
