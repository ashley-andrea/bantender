import type { Step } from './route'

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
  group: LineGroup | null
}

/** Display structure from the backend: variants of one item share a virtual parent; parts hang off their item. */
export type LineGroup = { kind: 'variant'; id: string; index: number; count: number } | { kind: 'part'; parent: string }

export interface OfferChoice {
  scenario: string
  offer: number
  margin_pct: number
  win_probability: number | null
  at: string
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
  win_context?: Partial<WinContext>
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
  win_curve?: WinCurve
  choice?: OfferChoice | null
}

/** Inputs of the win-probability model for one tender (backend/app/winprob/schema.py::TenderContext). */
export interface WinContext {
  bkp_trade: string
  building_type: string
  canton: string
  client_type: string
  procedure: string
  market_reference_chf: number
  n_lots: number
  price_weight_pct: number | null
  zero_at_ratio: number | null
  n_bidders: number
  competitive_intensity: number
  strategic_appetite: number
  available_capacity_pct: number
  incumbent_present: number
  prior_wins_with_client: number
  technical_score_expected: number
}

export type WinSource = 'tender' | 'market_snapshot' | 'demo_fixture' | 'estimator' | 'target_margin_fallback' | 'default'

export interface WinPoint {
  margin_pct: number
  offer: number
  price_position: number
  win_probability: number
  p_low: number
  p_high: number
  expected_profit: number
}

export interface WinScenario {
  name: 'Aggressive' | 'Target' | 'Conservative'
  offer: number
  margin_pct: number
  win_probability: number
  expected_profit: number
}

/** The `win_curve` block of the pricing result (docs/win-probability-model.md §10.4). */
export interface WinCurve {
  model: 'ml' | 'placeholder' | 'unavailable' | 'error'
  reason: string | null
  model_version?: string
  baseline?: number
  market_reference_chf?: number
  market_reference_source?: WinSource
  context?: WinContext
  sources?: Record<keyof WinContext, WinSource>
  snapshot_date?: string | null
  parameters?: { margin_grid_pct: [number, number, number]; near_optimal_share: number; min_margin_pct: number; band: number; round_to_chf: number }
  points?: WinPoint[]
  scenarios?: WinScenario[]
  current?: { offer: number; margin_pct: number; win_probability: number; p_low: number; p_high: number; expected_profit: number }
  explanation?: { feature: string; value: string | number; pts: number }[]
}

export interface WinModelSummary {
  model: WinCurve['model']
  model_version: string | null
  reason: string | null
  rows: { train: number; test: number } | null
  date_range: [string, string] | null
  metrics: { ml: { auc: number; brier: number; log_loss: number } | null; placeholder: { auc: number; brier: number; log_loss: number } | null }
  importance: { feature: string; importance: number; effect: string }[] | null
  latest_snapshot: Record<string, string> | null
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

// ---- assistant ----------------------------------------------------------------------------------

export interface AssistantStatus {
  enabled: boolean
  model: string | null
}

/** A quote that was found, word for word, in its source; tender quotes carry their boxes on the page. */
export interface Citation {
  n: number
  kind: 'tender' | 'bid' | 'position' | 'data'
  source: string
  label: string
  quote: string
  page: number | null
  line_id: string | null
  bboxes: BBox[]
  step: Step | null // where the tool shows the quoted figure: the step, and the element there (data-cite)
  anchor: string | null
}

export interface AssistantAnswer {
  status: 'answered' | 'not_found' | 'chat'
  message: string
  statements: { text: string; refs: number[] }[]
  citations: Citation[]
  unverified: number // statements removed because their quotes were not found in the cited source
  searches: string[]
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantView {
  step: string
  page: number | null
  position: string | null
}
