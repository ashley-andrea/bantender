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

/** How a value was obtained (see backend/app/matching/attributes.py): one highlighter colour each. */
export const LEVEL_COLOR: Record<Level, string> = {
  read: '#2e9e6a',
  derived: '#d9a400',
  assumed: '#e0457b',
  missing: '#8b959c',
  'n/a': '#8b959c',
}
/** The same meaning as a translucent highlighter (PDF marks). */
export const LEVEL_MARKER: Record<Level, string> = {
  read: 'rgb(127 211 160 / 0.55)',
  derived: 'rgb(255 225 77 / 0.7)',
  assumed: 'rgb(255 143 176 / 0.6)',
  missing: 'rgb(199 205 210 / 0.7)',
  'n/a': 'rgb(199 205 210 / 0.7)',
}
export const LEVEL_RANK: Record<Level, number> = { read: 0, 'n/a': 0, derived: 1, assumed: 2, missing: 3 }
