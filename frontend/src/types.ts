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
