const n0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 })
const n2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nAny = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 2 })

export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : nAny.format(n))
export const fmtChf = (n: number | null | undefined, decimals: 0 | 2 = 0) => (n == null ? '—' : (decimals ? n2 : n0).format(n))
export const fmtPct = (n: number) => `${n.toLocaleString('de-CH', { maximumFractionDigits: 2 })} %`

export const UNIT_LABEL: Record<string, string> = { pc: 'Stk', m: 'm', m2: 'm²', m3: 'm³', h: 'h', day: 'Tage', LS: 'pauschal', set: 'Satz', kg: 'kg' }
export const fmtUnit = (u: string | null | undefined) => (u ? (UNIT_LABEL[u] ?? u) : '')

/** Certainty bands, used for graph nodes and PDF boxes alike. */
export function certaintyColor(c: number) {
  return c >= 0.95 ? '#0ecb81' : c >= 0.75 ? '#ff9f0a' : '#f6465d'
}
