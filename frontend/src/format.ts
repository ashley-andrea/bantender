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

const chf0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 })
const chf2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtChf = (n: number | null | undefined, decimals = 0) =>
  n == null ? '—' : decimals === 0 ? chf0.format(n) : decimals === 2 ? chf2.format(n) : new Intl.NumberFormat('de-CH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n)
export const fmtPct = (n: number) => `${n.toLocaleString('de-CH', { maximumFractionDigits: 1 })} %`
