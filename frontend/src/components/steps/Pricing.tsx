import { useEffect, useState } from 'react'
import { fmtChf, fmtNum, fmtPct, fmtUnit } from '../../format'
import { PARAM_LABELS, humanize, useI18n } from '../../i18n'
import type { Offer, Pricing, PricedLine, ReferenceParameters, Settings } from '../../types'
import type { EditField } from '../../api'
import { InlineNumber } from '../InlineNumber'
import { LineHeader } from './Extraction'

/** One position: material + installation = direct cost, × factor m = the price on the form. */
export function FormulaCard({ line, offer, onEdit, busy }: { line: PricedLine; offer: Offer | null; onEdit: (field: EditField, v: number | null) => void; busy: boolean }) {
  const { t, lang } = useI18n()
  const c = line.cost
  const o = offer?.lines[line.line_id]
  const m = offer?.factor ?? 1
  const hoursStep = c?.trace.find((s) => s.label === 'Installation hours')
  const materialStep = c?.trace.find((s) => s.label === 'Material')
  return (
    <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5">
      <LineHeader line={line} />
      {!c ? (
        <p className="mt-4 text-[13px] text-muted">{o?.kind === 'included' ? t('includedHere') : t('noProduct')}</p>
      ) : (
        <div className="mt-4 space-y-2.5">
          <Term
            label={t('material')}
            formula={materialStep?.formula ?? ''}
            value={c.material_cost}
            sub={line.decision.product_id ?? ''}
          />
          <Term
            label={t('labour')}
            formula={hoursStep ? `${hoursStep.formula} = ${fmtNum(Math.round(c.adjusted_hours * 100) / 100)} h  ×  CHF ${c.hourly_rate}/h` : '—'}
            value={c.labour_cost}
            sub={`${line.decision.install_code ?? ''} · ${humanize(c.labour_role)}`}
            extra={line.decision.install_code ? (
              <span className="inline-flex items-center gap-2 text-[12.5px]">
                <span className="text-muted">{t('hoursPerUnit')}</span>
                <InlineNumber value={c.base_hours} suffix={`h / ${fmtUnit(line.decision.unit)}`} edited={line.decision.overridden.includes('hours_per_unit')} busy={busy}
                  onSave={(v) => onEdit('hours_per_unit', v)} onReset={() => onEdit('hours_per_unit', null)} />
              </span>
            ) : null}
          />
          <div className="flex items-baseline justify-between border-t border-hair pt-2.5">
            <span className="text-[13px] font-semibold">{t('lineCost')}</span>
            <span className="num text-[15px] font-semibold">CHF {fmtChf(c.direct_cost, 2)}</span>
          </div>
          <div className="rounded-xl bg-ink text-white p-4 mt-2">
            <div className="text-[11px] uppercase tracking-wide text-[#a1a1a6]">{t('onTheForm')}</div>
            {o?.kind === 'priced' && o.raw != null ? (
              <>
                <div className="mt-2 space-y-1 text-[12.5px] num">
                  <Row label={t('material')} value={c.material_cost} />
                  {o.raw - c.material_cost - (o.includes_labour ? c.labour_cost : 0) > 0.005 && (
                    <Row label={c.price_source === 'supplier_package' ? `+ ${t('tContingency')}` : `+ ${t('tSmall')}`}
                      value={o.raw - c.material_cost - (o.includes_labour ? c.labour_cost : 0)} />
                  )}
                  {o.includes_labour && c.labour_cost > 0 && <Row label={`+ ${t('labour')}`} value={c.labour_cost} />}
                  <Row label={`× ${t('markup')} m = ${m.toFixed(4)}`} value={o.raw * m} strong />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 num border-t border-white/15 pt-3">
                  <Big label={lang === 'de' ? 'Menge' : 'Quantity'} value={`${fmtNum(o.quantity)} ${fmtUnit(line.decision.unit)}`} />
                  <Big label={t('unitPrice')} value={fmtChf(o.unit_price, 2)} />
                  <Big label={t('amount')} value={fmtChf(o.amount, 2)} accent />
                </div>
              </>
            ) : (
              <div className="mt-1 text-[14px]">
                {line.source === 'cad' ? t('cadOnForm') : o?.kind === 'included' ? 'inkl.' : '—'}
              </div>
            )}
            {o?.kind === 'priced' && !o.includes_labour && c.labour_cost > 0 && (
              <div className="mt-3 text-[12px] text-[#c7c7cc]">
                {t('labourInE')} <span className="num">(CHF {fmtChf(c.labour_cost * m, 2)})</span>
              </div>
            )}
          </div>
          <p className="text-[12px] text-muted">{t('markupWhy')}</p>
        </div>
      )}
    </div>
  )
}

function Term({ label, formula, value, sub, extra }: { label: string; formula: string; value: number; sub: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-canvas px-3.5 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="num text-[14px] font-semibold">CHF {fmtChf(value, 2)}</span>
      </div>
      <div className="mt-0.5 font-mono text-[11.5px] text-muted break-words">{formula}</div>
      {sub && <div className="text-[11px] text-faint mt-0.5">{sub}</div>}
      {extra && <div className="mt-1.5">{extra}</div>}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between ${strong ? 'font-semibold text-white' : 'text-[#c7c7cc]'}`}>
      <span>{label}</span>
      <span>{fmtChf(value, 2)}</span>
    </div>
  )
}

function Big({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-[#a1a1a6]">{label}</div>
      <div className={`text-[17px] font-semibold ${accent ? 'text-brand' : ''}`}>{value}</div>
    </div>
  )
}

/** Positions → direct cost → overhead → margin → offer price, each with its formula. */
export function BuildUp({ pricing }: { pricing: Pricing }) {
  const { t } = useI18n()
  const trace = pricing.project.trace ?? []
  const strong = new Set(['Cost baseline', 'Selling price'])
  return (
    <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5">
      <div className="text-[13px] font-semibold">{t('buildUp')}</div>
      <table className="mt-2 w-full text-[12.5px]">
        <tbody>
          {trace.map((s, i) => (
            <tr key={i} className={`border-b border-hair/60 ${strong.has(s.label) ? 'font-semibold' : ''}`}>
              <td className="py-1.5 pr-2">{tLabel(s.label, t)}</td>
              <td className="py-1.5 pr-2 font-mono text-[11px] text-muted">{s.formula}</td>
              <td className={`py-1.5 text-right num ${s.label === 'Selling price' ? 'text-[15px]' : ''}`}>{fmtChf(s.value, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const TRACE_KEYS: Record<string, Parameters<ReturnType<typeof useI18n>['t']>[0]> = {
  'Line material': 'tLineMaterial', 'Line labour': 'tLineLabour', 'Transport / equipment': 'tTransport', 'Small material': 'tSmall',
  'Supplier contingency': 'tContingency', Engineering: 'tEngineering', Commissioning: 'tCommissioning', 'Hygiene inspection': 'tHygiene',
  Documentation: 'tDocumentation', 'Risk / opportunities': 'tRisk', Overhead: 'tOverhead', 'Cost baseline': 'tBaseline', 'Selling price': 'offerPrice',
}
function tLabel(label: string, t: ReturnType<typeof useI18n>['t']) {
  const k = TRACE_KEYS[label]
  return k ? t(k) : label
}

interface ParamSpec {
  path: [string, string] | [string]
  min: number
  max: number
  step: number
  unit: '×' | '%' | 'h' | 'CHF' | 'CHF/h'
}

const FACTOR_SPEC = { min: 0.5, max: 1.6, step: 0.01, unit: '×' as const }
const PCT = (max: number, step = 0.1) => ({ min: 0, max, step, unit: '%' as const })

function specs(s: Settings): { group: 'gFactors' | 'gAllowances' | 'gProject' | 'gCommercial'; items: ParamSpec[] }[] {
  return [
    { group: 'gFactors', items: Object.keys(s.factors).map((k) => ({ path: ['factors', k] as [string, string], ...FACTOR_SPEC })) },
    { group: 'gAllowances', items: Object.keys(s.allowances).map((k) => ({ path: ['allowances', k] as [string, string], ...PCT(15) })) },
    {
      group: 'gProject',
      items: Object.keys(s.project_costs).map((k) => ({
        path: ['project_costs', k] as [string, string],
        ...(k.endsWith('_hours') ? { min: 0, max: 2000, step: 10, unit: 'h' as const }
          : k.includes('rate') ? { min: 60, max: 250, step: 1, unit: 'CHF/h' as const }
          : { min: 0, max: 100000, step: 500, unit: 'CHF' as const }),
      })),
    },
    {
      group: 'gCommercial',
      items: [
        { path: ['overhead_pct'], ...PCT(25) },
        { path: ['margin_pct'], ...PCT(20) },
        { path: ['risk_allowance_chf'], min: 0, max: 200000, step: 1000, unit: 'CHF' },
      ],
    },
  ]
}

function read(s: Settings, path: ParamSpec['path']): number {
  const v = path.length === 1 ? (s as unknown as Record<string, number>)[path[0]] : (s as unknown as Record<string, Record<string, number>>)[path[0]][path[1]]
  return Number(v ?? 0)
}

const LABEL_EXTRA: Record<string, { en: string; de: string }> = {
  engineering_rate_chf_per_h: { en: 'Engineering rate', de: 'Ansatz Engineering' },
  commissioning_rate_chf_per_h: { en: 'Commissioning rate', de: 'Ansatz Inbetriebnahme' },
}

/** Every coefficient from project_parameters.json, editable; the server recomputes on release. */
export function ParameterPanel({ settings, defaults, onChange, busy }: { settings: Settings; defaults: ReferenceParameters | null; onChange: (patch: Record<string, unknown>) => void; busy: boolean }) {
  const { t, lang } = useI18n()
  const [draft, setDraft] = useState(settings)
  useEffect(() => setDraft(settings), [settings])

  // The company's values from project_parameters.json, as a settings patch.
  const base = defaults && {
    factors: defaults.productivity_factors,
    allowances: defaults.allowances,
    project_costs: defaults.project_costs,
    overhead_pct: defaults.commercial.overhead_pct,
    margin_pct: defaults.commercial.target_margin_pct,
    risk_allowance_chf: 0,
  }
  const baseValue = (path: ParamSpec['path']) => {
    if (!base) return undefined
    const v = path.length === 1 ? (base as Record<string, unknown>)[path[0]] : ((base as unknown as Record<string, Record<string, number>>)[path[0]] ?? {})[path[1]]
    return typeof v === 'number' ? v : undefined
  }
  const modified = specs(settings).flatMap((g) => g.items).filter((p) => {
    const b = baseValue(p.path)
    return b !== undefined && Math.abs(b - read(settings, p.path)) > 1e-9
  }).length

  const commit = (path: ParamSpec['path'], v: number) => {
    if (path.length === 1) onChange({ [path[0]]: v })
    else onChange({ [path[0]]: { ...(settings as unknown as Record<string, Record<string, number>>)[path[0]], [path[1]]: v } })
  }
  const setLocal = (path: ParamSpec['path'], v: number) =>
    setDraft((d) => (path.length === 1 ? { ...d, [path[0]]: v } : { ...d, [path[0]]: { ...(d as unknown as Record<string, Record<string, number>>)[path[0]], [path[1]]: v } }))

  return (
    <div className={`rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5 transition-opacity ${busy ? 'opacity-70' : ''}`}>
      <div className="flex items-baseline">
        <div className="text-[13px] font-semibold">{t('parameters')}</div>
        <div className="ml-auto text-[11px] text-muted">project_parameters.json</div>
      </div>
      {modified > 0 && base && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-sel/8 px-2.5 py-1.5 text-[12px]">
          <span className="size-1.5 rounded-full bg-sel" />
          <span>{modified} {t('paramsChanged')}</span>
          <button disabled={busy} onClick={() => onChange(base)} className="ml-auto shrink-0 whitespace-nowrap font-semibold text-sel">{t('resetAll')}</button>
        </div>
      )}
      {specs(draft).map((g) => (
        <div key={g.group} className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">{t(g.group)}</div>
          {g.items.map((p) => {
            const key = p.path[p.path.length - 1]
            const label = PARAM_LABELS[key]?.[lang] ?? LABEL_EXTRA[key]?.[lang] ?? humanize(key)
            const v = read(draft, p.path)
            const original = read(settings, p.path)
            const b = baseValue(p.path)
            return (
              <Slider key={key} label={label} value={v} spec={p} changed={b !== undefined && Math.abs(v - b) > 1e-9} base={b}
                onInput={(x) => setLocal(p.path, x)} onCommit={(x) => x !== original && commit(p.path, x)} />
            )
          })}
        </div>
      ))}
      {Object.keys(settings.locations).length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">{t('gLocations')}</div>
          {Object.entries(settings.locations).map(([sys, loc]) => (
            <div key={sys} className="flex items-center gap-2 py-1 text-[12.5px]">
              <span className="num w-14 text-muted">{sys}</span>
              <div className="ml-auto inline-flex rounded-[8px] bg-canvas p-0.5">
                {['default', ...settings.location_options].map((o) => (
                  <button key={o} onClick={() => o !== loc && onChange({ locations: { ...settings.locations, [sys]: o } })}
                    className={`px-2 py-0.5 rounded-[6px] text-[11.5px] ${o === loc ? 'bg-surface shadow-sm font-semibold' : 'text-muted'}`}>
                    {o === 'default' ? '—' : humanize(o)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Slider({ label, value, spec, changed, base, onInput, onCommit }: { label: string; value: number; spec: ParamSpec; changed: boolean; base?: number; onInput: (v: number) => void; onCommit: (v: number) => void }) {
  const max = Math.max(spec.max, value)
  const shown = fmt(value, spec)
  return (
    <label className="block py-1.5">
      <div className="flex items-baseline text-[12.5px]">
        <span>{label}</span>
        {changed && base !== undefined && <span className="ml-auto mr-2 num text-[11px] text-faint line-through">{fmt(base, spec)}</span>}
        <span className={`${changed ? '' : 'ml-auto'} num font-semibold ${changed ? 'text-sel' : ''}`}>{shown}</span>
      </div>
      <input type="range" min={spec.min} max={max} step={spec.step} value={value}
        style={{ '--p': `${((value - spec.min) / (max - spec.min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => onInput(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="range mt-1.5" />
    </label>
  )
}

function fmt(value: number, spec: ParamSpec) {
  return spec.unit === '×' ? value.toFixed(2) : spec.unit === '%' ? fmtPct(value) : spec.unit === 'h' ? `${fmtNum(value)} h` : spec.unit === 'CHF/h' ? `${fmtNum(value)}/h` : fmtChf(value)
}
