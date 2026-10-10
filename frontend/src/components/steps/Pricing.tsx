import { useEffect, useState } from 'react'
import type { EditField } from '../../api'
import { fmtChf, fmtNum, fmtPct, fmtUnit } from '../../format'
import { LOCATION_LABEL, PARAM_LABELS, humanize, systemName, useI18n } from '../../i18n'
import type { Offer, Parsed, Pricing, PricedLine, ReferenceParameters, Settings } from '../../types'
import { InlineNumber } from '../InlineNumber'
import { LineHeader } from './Extraction'

/** The selected position as it goes on the form; quantity and hours per unit can be corrected here. */
export function LineStrip({ line, systems, offer, onEdit, busy }: {
  line: PricedLine; systems: Parsed['systems']; offer: Offer | null; onEdit: (field: EditField, v: number | null) => void; busy: boolean
}) {
  const { t, lang } = useI18n()
  const o = offer?.lines[line.line_id]
  const unit = fmtUnit(line.decision.unit, lang)
  return (
    <div className="panel p-4">
      <LineHeader line={line} systems={systems} />
      <div className="mt-3 grid grid-cols-4 gap-4 text-[13px]">
        <Cell label={t('quantity')}>
          {line.source === 'lv' ? (
            <InlineNumber value={line.decision.quantity} suffix={unit} edited={line.decision.overridden.includes('quantity')} busy={busy}
              onSave={(v) => onEdit('quantity', v)} onReset={() => onEdit('quantity', null)} />
          ) : `${fmtNum(line.decision.quantity)} ${unit}`}
        </Cell>
        <Cell label={t('hoursPerUnit')}>
          {line.cost && line.decision.install_code ? (
            <InlineNumber value={line.cost.base_hours} suffix="h" edited={line.decision.overridden.includes('hours_per_unit')} busy={busy}
              onSave={(v) => onEdit('hours_per_unit', v)} onReset={() => onEdit('hours_per_unit', null)} />
          ) : '—'}
        </Cell>
        {o?.kind === 'priced' ? (
          <>
            <Cell label={t('unitPrice')}><span className="num font-semibold">{fmtChf(o.unit_price, 2)}</span></Cell>
            <Cell label={t('amount')}><span className="num font-semibold text-green">{fmtChf(o.amount, 2)}</span></Cell>
          </>
        ) : (
          <div className="col-span-2 self-end text-muted">
            {line.source === 'cad' ? t('cadNote') : o?.kind === 'included' ? t('includedNote') : '—'}
          </div>
        )}
      </div>
    </div>
  )
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

interface ParamSpec {
  path: [string, string] | [string]
  min: number
  max: number
  step: number
  unit: '×' | '%' | 'h' | 'CHF' | 'CHF/h'
}

const PCT = (max: number, step = 0.1) => ({ min: 0, max, step, unit: '%' as const })
type Group = 'gFactors' | 'gAllowances' | 'gProject' | 'gCommercial'

function specs(s: Settings): { group: Group; items: ParamSpec[] }[] {
  return [
    { group: 'gCommercial', items: [
      { path: ['margin_pct'], ...PCT(20) },
      { path: ['overhead_pct'], ...PCT(25) },
      { path: ['risk_allowance_chf'], min: 0, max: 200000, step: 1000, unit: 'CHF' },
    ] },
    { group: 'gFactors', items: Object.keys(s.factors).map((k) => ({ path: ['factors', k] as [string, string], min: 0.5, max: 1.6, step: 0.01, unit: '×' as const })) },
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
  ]
}

type Nested = Record<string, Record<string, number>>
const read = (s: unknown, path: ParamSpec['path']): number =>
  Number(path.length === 1 ? (s as Record<string, number>)[path[0]] : ((s as Nested)[path[0]] ?? {})[path[1]]) || 0

function fmt(value: number, spec: ParamSpec) {
  return spec.unit === '×' ? value.toFixed(2) : spec.unit === '%' ? fmtPct(value) : spec.unit === 'h' ? `${fmtNum(value)} h` : spec.unit === 'CHF/h' ? `${fmtNum(value)}/h` : fmtChf(value)
}

/** Offer price at the top, then every coefficient from the company parameters; the server recomputes on release. */
export function ParameterPanel({ pricing, systems, defaults, onChange, busy }: {
  pricing: Pricing; systems: Parsed['systems']; defaults: ReferenceParameters | null; onChange: (patch: Record<string, unknown>) => void; busy: boolean
}) {
  const { t, lang } = useI18n()
  const settings = pricing.settings
  const p = pricing.project
  const [draft, setDraft] = useState(settings)
  useEffect(() => setDraft(settings), [settings])

  const base = defaults && {
    factors: defaults.productivity_factors, allowances: defaults.allowances, project_costs: defaults.project_costs,
    overhead_pct: defaults.commercial.overhead_pct, margin_pct: defaults.commercial.target_margin_pct, risk_allowance_chf: 0,
  }
  const baseValue = (path: ParamSpec['path']) => (base ? read(base, path) : undefined)
  const modified = specs(settings).flatMap((g) => g.items).some((s) => {
    const b = baseValue(s.path)
    return b !== undefined && Math.abs(b - read(settings, s.path)) > 1e-9
  })

  const commit = (path: ParamSpec['path'], v: number) =>
    onChange(path.length === 1 ? { [path[0]]: v } : { [path[0]]: { ...(settings as unknown as Nested)[path[0]], [path[1]]: v } })
  const setLocal = (path: ParamSpec['path'], v: number) =>
    setDraft((d) => (path.length === 1 ? { ...d, [path[0]]: v } : { ...d, [path[0]]: { ...(d as unknown as Nested)[path[0]], [path[1]]: v } }))

  return (
    <div className={`h-full min-h-0 overflow-auto scroll-thin panel p-4 ${busy ? 'opacity-80' : ''}`}>
      <table className="w-full text-[13px] num">
        <tbody>
          <tr><td className="py-0.5 text-muted">{t('directCost')}</td><td className="text-right">{fmtChf(p.direct)}</td></tr>
          <tr><td className="py-0.5 text-muted">{t('overheadRisk')}</td><td className="text-right">{fmtChf(p.baseline - p.direct)}</td></tr>
          <tr><td className="py-0.5 text-muted">{t('margin')} {fmtPct(p.margin_pct)}</td><td className="text-right">{fmtChf(p.selling_price - p.baseline)}</td></tr>
          <tr className="border-t border-hair"><td className="pt-1.5 font-semibold">{t('offerPrice')}</td><td className="pt-1.5 text-right text-[17px] font-semibold">CHF {fmtChf(p.selling_price)}</td></tr>
        </tbody>
      </table>

      <div className="mt-4 flex items-baseline border-t border-hair pt-3">
        <span className="text-[13px] font-semibold">{t('parameters')}</span>
        {modified && base && (
          <button disabled={busy} onClick={() => onChange(base)} className="ml-auto text-[12px] font-semibold text-green hover:underline">{t('resetAll')}</button>
        )}
      </div>
      {specs(draft).map((g) => (
        <div key={g.group} className="mt-3">
          <div className="text-[11.5px] font-semibold text-muted">{t(g.group)}</div>
          {g.items.map((s) => {
            const key = s.path[s.path.length - 1]
            const v = read(draft, s.path)
            const b = baseValue(s.path)
            const changed = b !== undefined && Math.abs(v - b) > 1e-9
            return (
              <Slider key={key} label={PARAM_LABELS[key]?.[lang] ?? humanize(key)} value={v} spec={s} changed={changed} base={b}
                onInput={(x) => setLocal(s.path, x)} onCommit={(x) => x !== read(settings, s.path) && commit(s.path, x)} />
            )
          })}
        </div>
      ))}
      {Object.keys(settings.locations).length > 0 && settings.location_options.length > 0 && (
        <div className="mt-3">
          <div className="text-[11.5px] font-semibold text-muted">{t('gLocations')}</div>
          {Object.entries(settings.locations).map(([sys, loc]) => (
            <div key={sys} className="flex items-center gap-2 py-1 text-[12.5px]">
              <span className="truncate">{sys} {systemName(systems[sys], lang)}</span>
              <select value={loc} disabled={busy} onChange={(e) => onChange({ locations: { ...settings.locations, [sys]: e.target.value } })}
                className="ml-auto rounded border border-hair bg-surface px-1.5 py-0.5 text-[12.5px]">
                {settings.location_options.map((o) => (
                  <option key={o} value={o}>{LOCATION_LABEL[o]?.[lang] ?? humanize(o)}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Slider({ label, value, spec, changed, base, onInput, onCommit }: {
  label: string; value: number; spec: ParamSpec; changed: boolean; base?: number; onInput: (v: number) => void; onCommit: (v: number) => void
}) {
  const max = Math.max(spec.max, value)
  return (
    <label className="block py-1">
      <div className="flex items-baseline text-[12.5px]">
        <span>{label}</span>
        <span className="ml-auto num" title={changed && base !== undefined ? fmt(base, spec) : undefined}>
          {changed && base !== undefined && <span className="mr-1.5 text-[11px] text-faint line-through">{fmt(base, spec)}</span>}
          <span className={changed ? 'font-semibold text-green' : ''}>{fmt(value, spec)}</span>
        </span>
      </div>
      <input type="range" min={spec.min} max={max} step={spec.step} value={value}
        style={{ '--p': `${((value - spec.min) / (max - spec.min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => onInput(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="range mt-1" />
    </label>
  )
}
