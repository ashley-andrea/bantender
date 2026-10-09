const ch = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 2 })

export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : ch.format(n))

export const UNIT_LABEL: Record<string, string> = { pc: 'Stk', m: 'm', m2: 'm²', m3: 'm³', h: 'h', day: 'Tage', LS: 'pauschal', set: 'Satz', kg: 'kg' }

export const fmtUnit = (u: string | null, raw: string) => (u ? (UNIT_LABEL[u] ?? u) : raw)

export function sizeChips(s: { dn_mm?: number; width_mm?: number; height_mm?: number; length_mm?: number; airflow_m3h?: number; thickness_mm?: number; fire_class?: string }) {
  const chips: string[] = []
  if (s.dn_mm) chips.push(`DN${s.dn_mm}`)
  if (s.width_mm && s.height_mm) chips.push(`${s.width_mm}×${s.height_mm}${s.length_mm ? `×${s.length_mm}` : ''} mm`)
  if (s.thickness_mm) chips.push(`${s.thickness_mm} mm insulation`)
  if (s.airflow_m3h) chips.push(`${ch.format(s.airflow_m3h)} m³/h`)
  if (s.fire_class) chips.push(s.fire_class)
  return chips
}

export const SECTION_NAMES: Record<string, string> = {
  A: 'Apparate',
  B: 'Kanäle',
  C: 'Armaturen',
  D: 'Regulierung',
  E: 'Montage',
  F: 'Dämmungen',
}

export const FLAG_LABEL: Record<string, string> = {
  header_system_mismatch: 'Page header mislabelled',
  implausible_size: 'Implausible size',
  reader_disagreement: 'Readers disagree',
  quantity_missing: 'Quantity missing',
}
