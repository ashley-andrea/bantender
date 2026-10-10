import { Loader2, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EditField } from '../../api'
import { fmtChf, fmtNum, fmtPct, fmtUnit } from '../../format'
import { LOCATION_LABEL, PARAM_LABELS, humanize, systemName, useI18n } from '../../i18n'
import type { Offer, Parsed, Pricing, PricedLine, ReferenceParameters, Settings } from '../../types'
import { InlineNumber } from '../InlineNumber'
import { FamilyTable, useCatalog } from './Catalogue'
import { LineHeader } from './Extraction'

/** One position: its recap, the catalogue row it is priced from, and the few steps from net price to unit price. */
export function PriceDetail({ line, systems, offer, settings, onEdit, busy }: {
  line: PricedLine; systems: Parsed['systems']; offer: Offer | null; settings: Settings
  onEdit: (field: EditField, v: number | null) => void; busy: boolean
}) {
  const { t, lang } = useI18n()
  const ctx = useCatalog(line.decision.product_id)
  const o = offer?.lines[line.line_id]
  const c = line.cost
  const unit = fmtUnit(line.decision.unit, lang)
  const m = offer?.factor ?? 1

  return (
    <div className="h-full min-h-0 overflow-auto scroll-thin panel p-5">
      <LineHeader line={line} systems={systems} />
      {ctx && (
        <div data-cite="pos:product" className="mt-5">
          <div className="text-[12.5px] font-semibold">{t('catalogueRef')} <span className="font-normal text-muted">· {ctx.item.product_id}</span></div>
          <FamilyTable ctx={ctx} className="mt-1" />
        </div>
      )}
      <div className="mt-5 grid grid-cols-4 gap-4 text-[13px] rounded-md bg-canvas px-4 py-3">
        <Cell cite="pos:quantity" label={t('quantity')}>
          {line.source === 'lv' ? (
            <InlineNumber value={line.decision.quantity} suffix={unit} edited={line.decision.overridden.includes('quantity')} busy={busy}
              onSave={(v) => onEdit('quantity', v)} onReset={() => onEdit('quantity', null)} />
          ) : `${fmtNum(line.decision.quantity)} ${unit}`}
        </Cell>
        <Cell cite="pos:hours" label={t('hoursPerUnit')}>
          {c && line.decision.install_code ? (
            <InlineNumber value={c.base_hours} suffix="h" edited={line.decision.overridden.includes('hours_per_unit')} busy={busy}
              onSave={(v) => onEdit('hours_per_unit', v)} onReset={() => onEdit('hours_per_unit', null)} />
          ) : '—'}
        </Cell>
        <Cell cite="pos:unit_price" label={t('unitPrice')}><span className="num font-semibold">{o?.kind === 'priced' ? fmtChf(o.unit_price, 2) : o?.kind === 'included' ? t('included') : '—'}</span></Cell>
        <Cell cite="pos:amount" label={t('amount')}><span className="num font-semibold text-green">{o?.kind === 'priced' ? fmtChf(o.amount, 2) : '—'}</span></Cell>
      </div>
      {c && (
        <p data-cite="pos:direct" className="mt-2 px-4 text-[12px] text-muted num">
          {t('directCost')}: <span className="font-semibold text-ink">CHF {fmtChf(c.direct_cost, 2)}</span>
        </p>
      )}

      {c && o?.kind === 'priced' && o.raw != null && (o.quantity ?? 0) > 0 && (
        <Steps line={line} settings={settings} m={m} raw={o.raw / o.quantity!} unitPrice={o.unit_price!} includesLabour={!!o.includes_labour} />
      )}
      {!c && o?.kind === 'included' && <p className="mt-6 text-[13px] text-muted">{t('includedNote')}</p>}
      {line.source === 'cad' && <p className="mt-6 text-[13px] text-muted">{t('cadNote')}</p>}
    </div>
  )
}

/** Net price → unit price per unit, in as few lines as it takes to trust the number. */
function Steps({ line, settings, m, raw, unitPrice, includesLabour }: {
  line: PricedLine; settings: Settings; m: number; raw: number; unitPrice: number; includesLabour: boolean
}) {
  const { t, lang } = useI18n()
  const c = line.cost!
  const q = line.decision.quantity || 1
  const material = c.material_cost / q
  const labour = c.labour_cost / q
  const hours = c.adjusted_hours / q
  const allowance = raw - material - (includesLabour ? labour : 0)
  const supplier = c.price_source === 'supplier_package'
  const rows: { label: string; value: number; sign?: string; cite?: string }[] = []
  if (c.net_unit_cost > 0) {
    rows.push({ label: t('stepNet'), value: c.net_unit_cost, cite: 'pos:net' })
    rows.push({ label: `${PARAM_LABELS.material_waste_pct[lang]} ${fmtPct(settings.allowances.material_waste_pct)}`, value: material - c.net_unit_cost, sign: '+' })
  }
  if (allowance > 0.005) {
    const key = supplier ? 'supplier_package_contingency_pct' : 'small_material_pct'
    rows.push({ label: `${PARAM_LABELS[key][lang]} ${fmtPct(settings.allowances[key])}`, value: allowance, sign: '+' })
  }
  if (includesLabour && labour > 0) {
    rows.push({ label: `${t('labour')} ${fmtNum(Math.round(hours * 10) / 10)} h × CHF ${fmtNum(c.hourly_rate)}`, value: labour, sign: '+' })
  }
  return (
    <div data-cite="pos:steps" className="mt-6">
      <div className="text-[12.5px] font-semibold">{t('stepsTitle')} <span className="font-normal text-muted">/ {fmtUnit(line.decision.unit, lang)}</span></div>
      <table className="mt-1 w-full text-[13px] num">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} data-cite={r.cite} className="border-b border-hair/70">
              <td className="py-1 text-muted">{r.label}</td>
              <td className="py-1 text-right">{r.sign ? `${r.sign} ` : ''}{fmtChf(r.value, 2)}</td>
            </tr>
          ))}
          <tr className="border-b border-hair/70">
            <td className="py-1 text-muted">× {t('factorM')} {m.toFixed(3)} <span className="text-faint">({t('factorWhy')})</span></td>
            <td className="py-1 text-right">+ {fmtChf(raw * (m - 1), 2)}</td>
          </tr>
          <tr className="font-semibold">
            <td className="pt-1.5">{t('unitPrice')}</td>
            <td className="pt-1.5 text-right text-green">{fmtChf(unitPrice, 2)}</td>
          </tr>
        </tbody>
      </table>
      {!includesLabour && labour > 0 && (
        <p className="mt-2 text-[12px] text-muted num">
          {t('labour')} {fmtNum(Math.round(hours * 10) / 10)} h × CHF {fmtNum(c.hourly_rate)} = {fmtChf(labour * m, 2)} {t('labourInE')}
        </p>
      )}
    </div>
  )
}

function Cell({ cite, label, children }: { cite: string; label: string; children: React.ReactNode }) {
  return (
    <div data-cite={cite}>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

/** Locked to the bottom of the price step: how the positions add up to the offer price. */
export function OfferBar({ pricing, busy }: { pricing: Pricing; busy: boolean }) {
  const { t } = useI18n()
  const p = pricing.project
  return (
    <div className="panel px-5 py-3 flex items-center gap-8 text-[13px] num">
      <Part cite="direct-cost" label={t('directCost')} value={p.direct} />
      <span className="text-faint">+</span>
      <Part cite="overhead-risk" label={t('overheadRisk')} value={p.baseline - p.direct} />
      <span className="text-faint">+</span>
      <Part cite="margin" label={`${t('margin')} ${fmtPct(p.margin_pct)}`} value={p.selling_price - p.baseline} />
      <div data-cite="offer-price" className="ml-auto flex items-baseline gap-3">
        {busy && <Loader2 className="size-4 animate-spin text-muted self-center" />}
        <span className="text-muted">{t('offerPrice')}</span>
        <span className="text-[24px] font-semibold text-navy">CHF {fmtChf(p.selling_price)}</span>
      </div>
    </div>
  )
}

function Part({ label, value, cite }: { label: string; value: number; cite: string }) {
  return (
    <div data-cite={cite}>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="font-semibold">{fmtChf(value)}</div>
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

/** Every coefficient from the company parameters. Changed values can be undone one by one or all at once. */
export function ParameterPanel({ settings, systems, defaults, onChange, busy }: {
  settings: Settings; systems: Parsed['systems']; defaults: ReferenceParameters | null; onChange: (patch: Record<string, unknown>) => void; busy: boolean
}) {
  const { t, lang } = useI18n()
  const [draft, setDraft] = useState(settings)
  useEffect(() => setDraft(settings), [settings])

  const base = defaults && {
    factors: defaults.productivity_factors, allowances: defaults.allowances, project_costs: defaults.project_costs,
    overhead_pct: defaults.commercial.overhead_pct, margin_pct: defaults.commercial.target_margin_pct, risk_allowance_chf: 0,
  }
  const baseValue = (path: ParamSpec['path']) => (base ? read(base, path) : undefined)
  // Location detected from the system and lot names (what the tool chose before any edit).
  const detected = (code: string) => {
    const loc = systems[code]?.location ?? 'default'
    return settings.location_options.includes(loc) ? loc : settings.location_options[0]
  }
  const changedParams = specs(settings).flatMap((g) => g.items).some((s) => {
    const b = baseValue(s.path)
    return b !== undefined && Math.abs(b - read(settings, s.path)) > 1e-9
  })
  const changedLocations = Object.entries(settings.locations).some(([code, loc]) => loc !== detected(code))

  const commit = (path: ParamSpec['path'], v: number) =>
    onChange(path.length === 1 ? { [path[0]]: v } : { [path[0]]: { ...(settings as unknown as Nested)[path[0]], [path[1]]: v } })
  const setLocal = (path: ParamSpec['path'], v: number) =>
    setDraft((d) => (path.length === 1 ? { ...d, [path[0]]: v } : { ...d, [path[0]]: { ...(d as unknown as Nested)[path[0]], [path[1]]: v } }))

  return (
    <div className={`h-full min-h-0 overflow-auto scroll-thin panel p-4 ${busy ? 'opacity-80' : ''}`}>
      <div className="flex items-center">
        <span className="text-[13px] font-semibold">{t('parameters')}</span>
        <button disabled={busy || !base || (!changedParams && !changedLocations)} onClick={() => base && onChange({ ...base, locations: {} })}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-hair px-2 py-1 text-[12px] font-semibold text-green hover:bg-green/5 disabled:text-faint disabled:hover:bg-transparent">
          <RotateCcw className="size-3.5" /> {t('resetAll')}
        </button>
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
              <Slider key={key} cite={`param:${key}`} label={PARAM_LABELS[key]?.[lang] ?? humanize(key)} value={v} spec={s} changed={changed} busy={busy}
                onInput={(x) => setLocal(s.path, x)} onCommit={(x) => x !== read(settings, s.path) && commit(s.path, x)}
                onUndo={b !== undefined ? () => { setLocal(s.path, b); commit(s.path, b) } : undefined} />
            )
          })}
        </div>
      ))}
      {Object.keys(settings.locations).length > 0 && settings.location_options.length > 0 && (
        <div className="mt-3">
          <div className="text-[11.5px] font-semibold text-muted">{t('gLocations')}</div>
          {Object.entries(settings.locations).map(([sys, loc]) => (
            <div key={sys} data-cite={`location:${sys}`} className="flex items-center gap-2 py-1 text-[12.5px]">
              <span className="truncate">{sys} {systemName(systems[sys], lang)}</span>
              <span className="ml-auto inline-flex items-center gap-1.5">
                {loc !== detected(sys) && (
                  <UndoButton disabled={busy} onClick={() => onChange({ locations: { ...settings.locations, [sys]: detected(sys) } })} />
                )}
                <select value={loc} disabled={busy} onChange={(e) => onChange({ locations: { ...settings.locations, [sys]: e.target.value } })}
                  className={`rounded border border-hair bg-surface px-1.5 py-0.5 text-[12.5px] ${loc !== detected(sys) ? 'text-green font-semibold' : ''}`}>
                  {settings.location_options.map((o) => (
                    <option key={o} value={o}>{LOCATION_LABEL[o]?.[lang] ?? humanize(o)}</option>
                  ))}
                </select>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UndoButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const { t } = useI18n()
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={t('undo')} className="text-muted hover:text-green">
      <RotateCcw className="size-3.5" />
    </button>
  )
}

function Slider({ cite, label, value, spec, changed, busy, onInput, onCommit, onUndo }: {
  cite: string; label: string; value: number; spec: ParamSpec; changed: boolean; busy: boolean
  onInput: (v: number) => void; onCommit: (v: number) => void; onUndo?: () => void
}) {
  const max = Math.max(spec.max, value)
  return (
    <div data-cite={cite} className="py-1">
      <div className="flex items-center gap-1.5 text-[12.5px]">
        <span>{label}</span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {changed && onUndo && <UndoButton disabled={busy} onClick={onUndo} />}
          <span className={`num ${changed ? 'font-semibold text-green' : ''}`}>{fmt(value, spec)}</span>
        </span>
      </div>
      <input type="range" aria-label={label} min={spec.min} max={max} step={spec.step} value={value}
        style={{ '--p': `${((value - spec.min) / (max - spec.min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => onInput(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="range mt-1" />
    </div>
  )
}
