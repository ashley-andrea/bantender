import type { WinPoint } from './types'

/** Plot margins of the win chart; the slider under it uses the same insets so it lines up with the offer axis. */
export const CHART_MARGIN = { l: 52, r: 18 }

export const pct = (p: number) => `${Math.round(p * 100)} %`
export const chfCompact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)} M` : `${Math.round(v / 1e3)}k`)

/** Index of the point whose offer is closest to `offer` (offers rise with the index). */
export function nearestIndex(points: WinPoint[], offer: number) {
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].offer < offer) lo = mid
    else hi = mid
  }
  return Math.abs(points[lo].offer - offer) <= Math.abs(points[hi].offer - offer) ? lo : hi
}
