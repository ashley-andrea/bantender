import { useEffect, useRef, useState } from 'react'
import { fmtChf } from '../format'
import { useI18n, type Key } from '../i18n'
import type { WinPoint, WinScenario } from '../types'
import { CHART_MARGIN, chfCompact, nearestIndex, pct } from '../winFormat'

const GREEN = 'var(--color-green)' // chance of winning (line + band wash)
const NAVY = 'var(--color-navy)' // expected profit; current offer
const GRID = 'var(--color-hair)'
const RANGE = 'color-mix(in srgb, var(--color-mint) 35%, transparent)' // recommended range wash (light accent)

const M = CHART_MARGIN
const P = { top: 26, h: 190 } // chance plot
const E = { top: 26 + 190 + 28, h: 110 } // expected-profit plot
const AXIS = 40 // x-axis labels below the profit plot
const HEIGHT = E.top + E.h + AXIS

const SCENARIO_KEY: Record<WinScenario['name'], Key> = { Aggressive: 'aiAggressive', Target: 'aiTarget', Conservative: 'aiConservative' }

function niceCeil(v: number) {
  if (v <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(v))
  return ([1, 2, 2.5, 5, 10].find((s) => s * pow >= v) ?? 10) * pow
}

function useWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [w, setW] = useState(800)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(360, Math.round(e.contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return w
}

interface Props {
  points: WinPoint[]
  scenarios: WinScenario[]
  current: { offer: number; win_probability: number; expected_profit: number }
  selected: number
  onSelect: (i: number) => void
}

/**
 * Two plots on one offer axis (never two y-scales on one plot): chance of winning with its band, and the expected
 * profit it implies. The recommended range is shaded; the current offer and the slider position are marked.
 */
export function WinChart({ points, scenarios, current, selected, onSelect }: Props) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const [hover, setHover] = useState<number | null>(null)

  const x0 = points[0].offer
  const x1 = points[points.length - 1].offer
  const x = (v: number) => M.l + ((v - x0) / (x1 - x0)) * (width - M.l - M.r)
  const pMax = Math.min(1, Math.ceil(Math.max(...points.map((p) => p.p_high)) * 10) / 10)
  const yP = (p: number) => P.top + (1 - p / pMax) * P.h
  const eMax = niceCeil(Math.max(...points.map((p) => p.expected_profit)))
  const yE = (v: number) => E.top + (1 - v / eMax) * E.h

  const line = (f: (p: WinPoint) => number, y: (v: number) => number) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(p.offer).toFixed(1)},${y(f(p)).toFixed(1)}`).join('')
  const band =
    points.map((p, i) => `${i ? 'L' : 'M'}${x(p.offer).toFixed(1)},${yP(p.p_high).toFixed(1)}`).join('') +
    [...points].reverse().map((p) => `L${x(p.offer).toFixed(1)},${yP(p.p_low).toFixed(1)}`).join('') + 'Z'

  const agg = scenarios.find((s) => s.name === 'Aggressive')
  const con = scenarios.find((s) => s.name === 'Conservative')
  const xTicks = [0, 5, 10, 15, 20].map((m) => nearestIndex(points, points[0].offer / (1 - m / 100)))
  const tight = scenarios.length > 1 && Math.min(...scenarios.slice(1).map((s, i) => x(s.offer) - x(scenarios[i].offer))) < 84

  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const offer = x0 + ((e.clientX - r.left - M.l) / (width - M.l - M.r)) * (x1 - x0)
    return nearestIndex(points, Math.min(x1, Math.max(x0, offer)))
  }
  const h = hover != null ? points[hover] : null
  const sel = points[selected]

  return (
    <div ref={box} className="relative select-none">
      <svg width={width} height={HEIGHT} role="img" aria-label={t('winChance')} className="block touch-none"
        onPointerMove={(e) => setHover(pick(e))} onPointerLeave={() => setHover(null)} onPointerDown={(e) => onSelect(pick(e))}>
        {/* recommended range, across both plots */}
        {agg && con && <rect x={x(agg.offer)} y={P.top} width={Math.max(1, x(con.offer) - x(agg.offer))} height={E.top + E.h - P.top} fill={RANGE} />}

        {/* chance of winning */}
        <text x={M.l} y={12} className="fill-ink text-[12px] font-semibold">{t('winChance')}</text>
        {[0, pMax / 2, pMax].map((v) => (
          <g key={v}>
            <line x1={M.l} x2={width - M.r} y1={yP(v)} y2={yP(v)} stroke={GRID} />
            <text x={M.l - 8} y={yP(v) + 4} textAnchor="end" className="fill-muted text-[11px] num">{pct(v)}</text>
          </g>
        ))}
        <path d={band} fill={GREEN} fillOpacity={0.1} />
        <path d={line((p) => p.win_probability, yP)} fill="none" stroke={GREEN} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* expected profit */}
        <text x={M.l} y={E.top - 12} className="fill-ink text-[12px] font-semibold">
          {t('expectedProfit')} <tspan className="fill-muted font-normal">· {t('expectedProfitWhy')}</tspan>
        </text>
        {[0, eMax / 2, eMax].map((v) => (
          <g key={v}>
            <line x1={M.l} x2={width - M.r} y1={yE(v)} y2={yE(v)} stroke={GRID} />
            <text x={M.l - 8} y={yE(v) + 4} textAnchor="end" className="fill-muted text-[11px] num">{v ? chfCompact(v) : '0'}</text>
          </g>
        ))}
        <path d={line((p) => p.expected_profit, yE)} fill="none" stroke={NAVY} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* offer axis: offer in CHF, the margin it means underneath */}
        {xTicks.map((i) => (
          <g key={i}>
            <text x={x(points[i].offer)} y={E.top + E.h + 16} textAnchor="middle" className="fill-muted text-[11px] num">{chfCompact(points[i].offer)}</text>
            <text x={x(points[i].offer)} y={E.top + E.h + 30} textAnchor="middle" className="fill-faint text-[10.5px] num">{points[i].margin_pct.toFixed(0)} %</text>
          </g>
        ))}

        {/* scenarios: dots on both curves, names above the range */}
        {scenarios.map((s) => (
          <g key={s.name}>
            <line x1={x(s.offer)} x2={x(s.offer)} y1={P.top} y2={E.top + E.h} stroke={GREEN} strokeOpacity={0.35} />
            <circle cx={x(s.offer)} cy={yP(s.win_probability)} r={4.5} fill={GREEN} stroke="#fff" strokeWidth={2} />
            <circle cx={x(s.offer)} cy={yE(s.expected_profit)} r={4.5} fill={NAVY} stroke="#fff" strokeWidth={2} />
            <text x={x(s.offer)} y={P.top - 6} textAnchor="middle" className="fill-muted text-[11px] font-semibold">
              {tight ? t(SCENARIO_KEY[s.name]).slice(0, 1) : t(SCENARIO_KEY[s.name])}
            </text>
          </g>
        ))}

        {/* current offer */}
        <line x1={x(current.offer)} x2={x(current.offer)} y1={P.top} y2={E.top + E.h} stroke={NAVY} strokeWidth={1.5} />
        <circle cx={x(current.offer)} cy={yP(current.win_probability)} r={5} fill={NAVY} stroke="#fff" strokeWidth={2} />
        <text x={x(current.offer) + 6} y={P.top + P.h - 6} className="fill-ink text-[11px] font-semibold">{t('winCurrent')}</text>

        {/* slider position */}
        <line x1={x(sel.offer)} x2={x(sel.offer)} y1={P.top} y2={E.top + E.h} stroke="var(--color-ink)" strokeOpacity={0.55} />
        <circle cx={x(sel.offer)} cy={yP(sel.win_probability)} r={5} fill="#fff" stroke={GREEN} strokeWidth={2.5} />
        <circle cx={x(sel.offer)} cy={yE(sel.expected_profit)} r={5} fill="#fff" stroke={NAVY} strokeWidth={2.5} />

        {/* hover crosshair */}
        {h && (
          <g pointerEvents="none">
            <line x1={x(h.offer)} x2={x(h.offer)} y1={P.top} y2={E.top + E.h} stroke="var(--color-ink)" strokeOpacity={0.25} />
            <circle cx={x(h.offer)} cy={yP(h.win_probability)} r={4} fill={GREEN} stroke="#fff" strokeWidth={2} />
            <circle cx={x(h.offer)} cy={yE(h.expected_profit)} r={4} fill={NAVY} stroke="#fff" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute z-10 rounded-md bg-surface border border-hair shadow-sm px-2.5 py-2 text-[12px] num"
          style={{ left: Math.min(x(h.offer) + 12, width - 190), top: P.top + 8 }}>
          <div className="font-semibold">CHF {fmtChf(h.offer)}</div>
          <div className="text-muted">{h.margin_pct.toFixed(1)} % {t('margin').toLowerCase()}</div>
          <div className="mt-1 flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: GREEN }} />
            {t('winChance')} <b>{pct(h.win_probability)}</b> <span className="text-muted">({pct(h.p_low)}–{pct(h.p_high)})</span></div>
          <div className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: NAVY }} />
            {t('expectedProfit')} <b>{fmtChf(h.expected_profit)}</b></div>
        </div>
      )}
    </div>
  )
}

