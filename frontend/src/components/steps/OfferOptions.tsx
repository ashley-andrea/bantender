import { Loader2, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { fmtChf, fmtNum, fmtPct } from '../../format'
import { WIN_FEATURE_LABEL, WIN_SOURCE_LABEL, WIN_VALUE_LABEL, humanize, useI18n, type Key } from '../../i18n'
import type { Pricing, WinContext, WinCurve, WinModelSummary, WinScenario, WinSource } from '../../types'
import { InlineNumber } from '../InlineNumber'
import { CHART_MARGIN, chfCompact, nearestIndex, pct } from '../../winFormat'
import { WinChart } from '../WinChart'

const POS = '#008163' // raises the chance
const NEG = '#e3a33a' // lowers it (always shown with its signed value)

const SCENARIO: Record<WinScenario['name'], { label: Key; hint: Key }> = {
  Aggressive: { label: 'aiAggressive', hint: 'aiAggressiveHint' },
  Target: { label: 'aiTarget', hint: 'aiTargetHint' },
  Conservative: { label: 'aiConservative', hint: 'aiConservativeHint' },
}

const roundUp = (v: number, step: number) => Math.ceil(v / step - 1e-9) * step

interface Props {
  pricing: Pricing
  busy: boolean
  onSettings: (patch: Record<string, unknown>) => void
}

/** Step 4: offers from the win-probability model (backend `win_curve`): three options, the full curve with a slider, inputs, why. */
export function OfferOptions({ pricing, busy, onSettings }: Props) {
  const { t } = useI18n()
  const wc = pricing.win_curve
  const [summary, setSummary] = useState<WinModelSummary | null>(null)
  useEffect(() => {
    api.winModel().then(setSummary).catch(() => setSummary(null))
  }, [])

  if (!wc || !wc.points || !wc.scenarios || !wc.current || !wc.context || !wc.sources || !wc.parameters) {
    return (
      <div className="h-full grid place-items-center">
        <div className="panel p-6 max-w-md text-center">
          <div className="text-[15px] font-semibold">{t('unavailable')}</div>
          {wc?.reason && <p className="mt-1 text-[12.5px] text-muted">{wc.reason}</p>}
        </div>
      </div>
    )
  }
  return <Options key={wc.current.offer} wc={wc as Required<WinCurve>} pricing={pricing} summary={summary} busy={busy} onSettings={onSettings} />
}

function Options({ wc, pricing, summary, busy, onSettings }: { wc: Required<WinCurve>; pricing: Pricing; summary: WinModelSummary | null } & Omit<Props, 'pricing'>) {
  const { t } = useI18n()
  const step = wc.parameters.round_to_chf
  const applyMargin = (margin: number) => onSettings({ margin_pct: Math.round(margin * 1e6) / 1e6 })
  const currentIdx = nearestIndex(wc.points, wc.current.offer)
  const [selected, setSelected] = useState(currentIdx) // remounted (key) when the current offer changes
  const sel = wc.points[selected]
  const selOffer = roundUp(sel.offer, step)
  const isCurrent = (offer: number) => Math.abs(offer - wc.current.offer) < 0.5

  const overrides = pricing.settings.win_context ?? {}
  const setInput = (key: keyof WinContext, value: string | number | null) => {
    const next: Record<string, unknown> = { ...overrides }
    if (value == null) delete next[key]
    else next[key] = value
    onSettings({ win_context: next })
  }

  return (
    <div className={`h-full flex gap-3 ${busy ? 'opacity-90' : ''}`}>
      <div className="flex-1 min-w-0 h-full overflow-auto scroll-thin flex flex-col gap-3">
        <div className="panel px-5 py-4">
          <div className="flex items-baseline gap-3">
            <span className="text-[17px] font-semibold">{t('aiTitle')}</span>
            {busy && <Loader2 className="size-4 animate-spin text-muted self-center" />}
            {wc.model !== 'ml' && <span className="ml-auto rounded bg-canvas px-2 py-0.5 text-[12px] text-muted">{t('placeholderNote')}</span>}
          </div>
          <p className="mt-1 text-[13px] text-muted">{t('winBody').replace('{share}', pct(wc.parameters.near_optimal_share))}</p>
          {wc.market_reference_source === 'target_margin_fallback' && <p className="mt-1 text-[12.5px] text-warn">{t('marketFallback')}</p>}
        </div>

        <div className="grid grid-cols-4 gap-3">
          <OptionCard dark label={t('winCurrent')} offer={wc.current.offer} margin={wc.current.margin_pct}
            chance={wc.current.win_probability} profit={wc.current.expected_profit} />
          {wc.scenarios.map((s) => (
            <OptionCard key={s.name} label={t(SCENARIO[s.name].label)} hint={t(SCENARIO[s.name].hint)} accent={s.name === 'Target'}
              offer={s.offer} margin={s.margin_pct} chance={s.win_probability} profit={s.expected_profit}
              inUse={isCurrent(s.offer)} busy={busy} onUse={() => applyMargin(s.margin_pct)} />
          ))}
        </div>

        <div className="panel p-4">
          <WinChart points={wc.points} scenarios={wc.scenarios} current={wc.current} selected={selected} onSelect={setSelected} />
          <div style={{ paddingLeft: CHART_MARGIN.l, paddingRight: CHART_MARGIN.r }}>
            <div className="mt-1 text-[11.5px] font-semibold text-muted">{t('explore')}</div>
            <input type="range" aria-label={t('explore')} min={0} max={wc.points.length - 1} step={1} value={selected}
              style={{ '--p': `${(selected / (wc.points.length - 1)) * 100}%` } as React.CSSProperties}
              onChange={(e) => setSelected(Number(e.target.value))} className="range mt-2" />
            <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2 text-[13px]">
              <Stat label={t('offerPrice')} value={`CHF ${fmtChf(selOffer)}`} strong />
              <Stat label={t('margin')} value={fmtPct(Math.round(sel.margin_pct * 10) / 10)} />
              <Stat label={t('winChance')} value={pct(sel.win_probability)} sub={`${pct(sel.p_low)}–${pct(sel.p_high)}`} />
              <Stat label={t('expectedProfit')} value={fmtChf(sel.expected_profit)} />
              <button disabled={busy || isCurrent(selOffer)} onClick={() => applyMargin(sel.margin_pct)}
                className="ml-auto rounded-md bg-green px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:bg-canvas disabled:text-faint">
                {isCurrent(selOffer) ? t('inUse') : t('useOffer')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-[360px] shrink-0 h-full overflow-auto scroll-thin flex flex-col gap-3">
        <Inputs wc={wc} busy={busy} onSet={setInput} />
        {wc.explanation.length > 0 && <Why wc={wc} />}
        <ModelCard summary={summary} />
      </div>
    </div>
  )
}

function OptionCard({ label, hint, offer, margin, chance, profit, dark, accent, inUse, busy, onUse }: {
  label: string; hint?: string; offer: number; margin: number; chance: number; profit: number
  dark?: boolean; accent?: boolean; inUse?: boolean; busy?: boolean; onUse?: () => void
}) {
  const { t } = useI18n()
  const muted = dark ? 'text-white/65' : 'text-muted'
  return (
    <div className={`rounded-[var(--radius-card)] p-4 flex flex-col ${dark ? 'bg-navy text-white' : `panel ${accent ? 'ring-2 ring-green/60' : ''}`}`}>
      <div className="text-[13px] font-semibold">{label}</div>
      <div className={`text-[11.5px] ${muted} min-h-4`}>{hint}</div>
      <div className="mt-2 text-[20px] font-semibold">CHF {fmtChf(offer)}</div>
      <div className={`text-[12px] ${muted} num`}>{t('margin')} {fmtPct(Math.round(margin * 10) / 10)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <div><div className={muted}>{t('winChance')}</div><div className="text-[16px] font-semibold">{pct(chance)}</div></div>
        <div><div className={muted}>{t('expectedProfit')}</div><div className="text-[16px] font-semibold">{chfCompact(profit)}</div></div>
      </div>
      {onUse && (
        <button disabled={busy || inUse} onClick={onUse}
          className="mt-3 rounded-md border border-green px-3 py-1.5 text-[12.5px] font-semibold text-green hover:bg-green/5 disabled:border-hair disabled:text-faint disabled:hover:bg-transparent">
          {inUse ? t('inUse') : t('useOffer')}
        </button>
      )}
    </div>
  )
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`num ${strong ? 'text-[16px] font-semibold text-navy' : 'font-semibold'}`}>
        {value} {sub && <span className="text-[11.5px] font-normal text-muted">({sub})</span>}
      </div>
    </div>
  )
}

// ---- inputs --------------------------------------------------------------------------------------

type Kind = { select: (string | number)[] } | { number: string }
const INPUTS: [keyof WinContext, Kind][] = [
  ['market_reference_chf', { number: 'CHF' }],
  ['n_bidders', { number: '' }],
  ['price_weight_pct', { number: 'pts' }],
  ['zero_at_ratio', { number: '×' }],
  ['bkp_trade', { select: ['242', '243', '244', '245', '246', '250'] }],
  ['building_type', { select: ['school', 'hospital', 'office', 'residential', 'industrial', 'public_building'] }],
  ['client_type', { select: ['municipality', 'canton', 'federal', 'private'] }],
  ['procedure', { select: ['open', 'invited'] }],
  ['canton', { select: ['ZH', 'BE', 'AG', 'VD', 'SG', 'LU', 'BS', 'GE', 'TG'] }],
  ['n_lots', { number: '' }],
  ['competitive_intensity', { number: '' }],
  ['strategic_appetite', { number: '' }],
  ['available_capacity_pct', { number: '%' }],
  ['incumbent_present', { select: [0, 1] }],
  ['prior_wins_with_client', { number: '' }],
  ['technical_score_expected', { number: '' }],
]

function Inputs({ wc, busy, onSet }: { wc: Required<WinCurve>; busy: boolean; onSet: (k: keyof WinContext, v: string | number | null) => void }) {
  const { t, lang } = useI18n()
  const label = (v: string | number) => WIN_VALUE_LABEL[String(v)]?.[lang] ?? String(v)
  return (
    <div className="panel p-4">
      <div className="text-[13px] font-semibold">{t('inputsTitle')}</div>
      <p className="mt-0.5 text-[12px] text-muted">{t('inputsBody')}</p>
      <div className="mt-2">
        {INPUTS.map(([key, kind]) => {
          const value = wc.context[key]
          const source: WinSource = wc.sources[key] ?? 'default'
          const edited = source === 'estimator'
          return (
            <div key={key} className="flex items-center gap-2 py-1 text-[12.5px] border-b border-hair/60 last:border-0">
              <span className="truncate">{WIN_FEATURE_LABEL[key]?.[lang] ?? humanize(key)}</span>
              <span className="ml-auto inline-flex items-center gap-1.5">
                {'select' in kind ? (
                  <>
                    {edited && (
                      <button type="button" disabled={busy} onClick={() => onSet(key, null)} title={t('reset')} className="text-muted hover:text-green">
                        <RotateCcw className="size-3.5" />
                      </button>
                    )}
                    <select value={String(value)} disabled={busy}
                      onChange={(e) => onSet(key, typeof kind.select[0] === 'number' ? Number(e.target.value) : e.target.value)}
                      className={`rounded border border-hair bg-surface px-1.5 py-0.5 text-[12.5px] ${edited ? 'text-green font-semibold' : ''}`}>
                      {kind.select.map((o) => <option key={o} value={String(o)}>{key === 'incumbent_present' ? (o ? t('yes') : t('no')) : label(o)}</option>)}
                    </select>
                  </>
                ) : value == null ? (
                  <span className="text-muted">{t('noRule')}</span>
                ) : (
                  <InlineNumber value={Number(value)} suffix={kind.number} edited={edited} busy={busy}
                    onSave={(v) => onSet(key, v)} onReset={() => onSet(key, null)} />
                )}
                <SourceChip source={source} />
              </span>
            </div>
          )
        })}
      </div>
      {wc.snapshot_date && <p className="mt-2 text-[11.5px] text-faint">{WIN_SOURCE_LABEL.market_snapshot[lang]}: {wc.snapshot_date}</p>}
    </div>
  )
}

function SourceChip({ source }: { source: WinSource }) {
  const { lang } = useI18n()
  const style = source === 'estimator' ? 'border-green/50 text-green' : source === 'demo_fixture' || source === 'target_margin_fallback' ? 'border-dashed border-faint text-muted' : 'border-hair text-muted'
  return <span className={`w-[74px] shrink-0 text-center rounded border px-1 text-[10.5px] ${style}`}>{WIN_SOURCE_LABEL[source]?.[lang] ?? source}</span>
}

// ---- why -----------------------------------------------------------------------------------------

function Why({ wc }: { wc: Required<WinCurve> }) {
  const { t, lang } = useI18n()
  const [all, setAll] = useState(false)
  const target = wc.scenarios.find((s) => s.name === 'Target')
  const rows = all ? wc.explanation : wc.explanation.slice(0, 8)
  const max = Math.max(...wc.explanation.map((r) => Math.abs(r.pts)), 1)
  const c = wc.context

  const shown = (feature: string, value: string | number): string => {
    switch (feature) {
      case 'price_position':
      case 'price_position_x_sensitivity':
        return target ? `${pct(target.offer / c.market_reference_chf)}` : ''
      case 'price_sensitivity':
        return c.price_weight_pct == null ? t('noRule') : `${fmtNum(c.price_weight_pct)} · ${fmtNum(c.zero_at_ratio)}×`
      case 'log_market_reference':
        return `CHF ${chfCompact(c.market_reference_chf)}`
      case 'log_n_bidders':
        return String(c.n_bidders)
      case 'prior_wins_capped':
        return String(c.prior_wins_with_client)
      case 'incumbent_present':
        return value ? t('yes') : t('no')
      case 'available_capacity_pct':
        return `${fmtNum(Number(value))} %`
      default:
        return typeof value === 'number' ? fmtNum(value) : WIN_VALUE_LABEL[value]?.[lang] ?? value
    }
  }

  return (
    <div className="panel p-4">
      <div className="text-[13px] font-semibold">{t('whyTitle')}</div>
      <p className="mt-0.5 text-[12px] text-muted">{t('whyBody')}</p>
      <table className="mt-2 w-full text-[12px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.feature} className="border-b border-hair/60 last:border-0">
              <td className="py-1 pr-2">
                <div className="truncate max-w-[150px]">{WIN_FEATURE_LABEL[r.feature]?.[lang] ?? humanize(r.feature)}</div>
                <div className="text-[11px] text-muted truncate max-w-[150px] num">{shown(r.feature, r.value)}</div>
              </td>
              <td className="py-1 w-[110px]">
                <div className="relative h-2.5">
                  <div className="absolute left-1/2 top-[-3px] bottom-[-3px] w-px bg-hair" />
                  <div className="absolute top-0 h-full rounded-[2px]"
                    style={{ background: r.pts >= 0 ? POS : NEG, width: `${(Math.abs(r.pts) / max) * 50}%`, left: r.pts >= 0 ? '50%' : `${50 - (Math.abs(r.pts) / max) * 50}%` }} />
                </div>
              </td>
              <td className="py-1 pl-2 text-right num font-semibold w-[52px]">{r.pts >= 0 ? '+' : '−'}{Math.abs(r.pts).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {wc.explanation.length > 8 && (
        <button onClick={() => setAll((v) => !v)} className="mt-1 text-[12px] font-semibold text-green">{all ? t('showLess') : t('showAll')}</button>
      )}
    </div>
  )
}

// ---- model card ----------------------------------------------------------------------------------

function ModelCard({ summary }: { summary: WinModelSummary | null }) {
  const { t, lang } = useI18n()
  if (!summary) return null
  const ml = summary.metrics.ml
  const ph = summary.metrics.placeholder
  const n = summary.rows ? summary.rows.train + summary.rows.test : null
  const drivers = (summary.importance ?? []).filter((d) => d.importance > 0.001).slice(0, 6)
  const top = Math.max(...drivers.map((d) => d.importance), 1e-9)
  return (
    <div className="panel p-4">
      <div className="text-[13px] font-semibold">{t('modelTitle')}</div>
      {summary.model !== 'ml' ? (
        <p className="mt-0.5 text-[12px] text-muted">{t('placeholderNote')}{summary.reason ? `: ${summary.reason}` : ''}</p>
      ) : (
        <>
          {n != null && <p className="mt-0.5 text-[12px] text-muted">{t('modelLearned').replace('{n}', fmtNum(n))}{summary.date_range ? ` (${summary.date_range[0]} – ${summary.date_range[1]})` : ''}.</p>}
          {ml && ph && <p className="mt-1 text-[12px] text-muted">{t('modelScore').replace('{auc}', pct(ml.auc)).replace('{ph}', pct(ph.auc))}</p>}
          {drivers.length > 0 && (
            <>
              <div className="mt-3 text-[11.5px] font-semibold text-muted">{t('modelDrivers')}</div>
              {drivers.map((d) => (
                <div key={d.feature} className="mt-1 flex items-center gap-2 text-[12px]">
                  <span className="w-[150px] truncate">{WIN_FEATURE_LABEL[d.feature]?.[lang] ?? humanize(d.feature)}</span>
                  <div className="flex-1 h-2 rounded-[2px] bg-canvas">
                    <div className="h-full rounded-[2px] bg-green" style={{ width: `${(d.importance / top) * 100}%` }} />
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}
