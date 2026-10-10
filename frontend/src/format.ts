import type { Level } from './types'

const n0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 })
const n2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nAny = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 2 })

export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : nAny.format(n))
export const fmtChf = (n: number | null | undefined, decimals: 0 | 2 = 0) => (n == null ? '—' : (decimals ? n2 : n0).format(n))
export const fmtPct = (n: number) => `${n.toLocaleString('de-CH', { maximumFractionDigits: 2 })} %`

const UNIT: Record<string, { en: string; de: string }> = {
  pc: { en: 'pc', de: 'Stk' }, m: { en: 'm', de: 'm' }, m2: { en: 'm²', de: 'm²' }, m3: { en: 'm³', de: 'm³' }, h: { en: 'h', de: 'h' },
  day: { en: 'days', de: 'Tage' }, LS: { en: 'lump sum', de: 'pauschal' }, set: { en: 'set', de: 'Satz' }, kg: { en: 'kg', de: 'kg' },
}
export const fmtUnit = (u: string | null | undefined, lang: 'en' | 'de' = 'en') => (u ? (UNIT[u]?.[lang] ?? u) : '')

/** How a value was obtained (see backend/app/matching/attributes.py). */
export const LEVEL_COLOR: Record<Level, string> = {
  read: '#2e9e6a',
  derived: '#e39a12',
  assumed: '#d6453d',
  missing: '#d6453d',
  'n/a': '#98a3ab',
}
export const LEVEL_RANK: Record<Level, number> = { read: 0, 'n/a': 0, derived: 1, assumed: 2, missing: 3 }
