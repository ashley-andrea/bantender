import { Check as CheckIcon, CircleAlert, CircleMinus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { fmtChf, fmtNum, fmtUnit } from '../../format'
import { humanize, tx, useI18n } from '../../i18n'
import { graphOf, selectedLine, type Selection } from '../../tree'
import type { CatalogContext, Parsed, PricedLine, ProductivityRule } from '../../types'
import { InlineNumber } from '../InlineNumber'
import { ItemGraph, type ProductNode } from '../ItemGraph'
import { Legend, SelectionHeader } from './Extraction'

interface Props {
  sel: Selection
  systems: Parsed['systems']
  active: string | null
  onActive: (k: string) => void
  onQuote: (unitPrice: number | null) => void
  busy: boolean
}

/** The lines a selection stands for: the child, or every variant of a parent. */
export const selectionLines = (sel: Selection): PricedLine[] => (sel.child ? [sel.child.line] : sel.entry.members)

/** Distinct products of the lines, with the net price each is priced at. */
export function productsOf(lines: PricedLine[]): ProductNode[] {
  const seen = new Map<string, ProductNode>()
  for (const l of lines) {
    const pid = l.decision.product_id
    if (pid && !seen.has(pid)) seen.set(pid, { key: `product:${pid}`, id: pid, net: l.cost?.net_unit_cost ?? 0, unit: l.decision.unit })
  }
  return [...seen.values()]
}

/** Hours per unit when every line uses the same installation rule and value. */
function hoursOf(lines: PricedLine[]) {
  const hs = new Set(lines.map((l) => (l.cost && l.decision.install_code ? `${l.decision.install_code}|${l.cost.base_hours}` : '')))
  if (hs.size !== 1 || !lines[0].cost || !lines[0].decision.install_code || !lines[0].cost.base_hours) return null
  return { value: lines[0].cost.base_hours, unit: lines[0].decision.unit ?? '' }
}

export function CataloguePanel({ sel, systems, active, onActive, onQuote, busy }: Props) {
  const { t, lang } = useI18n()
  const lines = selectionLines(sel)
  const products = productsOf(lines)
  const line = selectedLine(sel)
  const checks = line ? line.decision.checks.filter((c) => c.key !== 'quantity' && c.key !== 'estimator') : []
  const needsQuote = line && (line.status_key === 'supplier_quote_required' || line.decision.overridden.includes('unit_price'))
  return (
    <div className="h-full min-h-0 overflow-auto scroll-thin panel p-5">
      <SelectionHeader sel={sel} systems={systems} />
      <Legend className="mt-5" />
      <div className="mt-6" key={sel.child?.id ?? sel.entry.id}>
        <ItemGraph spec={graphOf(sel, lang)} products={products} hours={hoursOf(lines)} active={active} onActive={onActive} />
      </div>

      {!products.length && <p className="mt-2 text-[13px] text-muted">{t('noProduct')}</p>}
      {checks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
          {checks.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1" title={tx(c.detail, lang)}>
              {c.result === 'pass' ? <CheckIcon className="size-3.5 text-good" /> : c.result === 'partial' ? <CircleMinus className="size-3.5 text-warn" /> : <CircleAlert className="size-3.5 text-bad" />}
              {tx(c.label, lang)}
            </span>
          ))}
        </div>
      )}
      {needsQuote && line && (
        <div className="mt-5 flex items-center gap-3 rounded-lg border-[1.5px] border-dashed border-warn bg-[#fff6d9] px-3 py-2 text-[13px]">
          <span className="font-hand font-bold text-[15px]">{t('supplierQuote')}</span>
          <span className="ml-auto text-muted">{t('quotePrice')}</span>
          <InlineNumber value={line.cost?.net_unit_cost ?? null} suffix={`CHF / ${fmtUnit(line.decision.unit, lang)}`}
            edited={line.decision.overridden.includes('unit_price')} busy={busy} onSave={(v) => onQuote(v)} onReset={() => onQuote(null)} />
        </div>
      )}
      <References lines={lines} className="mt-8" />
    </div>
  )
}

/** The reference data a selection is priced from: catalogue rows (catalog.csv) and installation rules (productivity.csv). */
export function References({ lines, className = '' }: { lines: PricedLine[]; className?: string }) {
  const { t } = useI18n()
  const products = productsOf(lines)
  const ctx = useCatalog(products[0]?.id ?? null)
  const codes = [...new Set(lines.map((l) => l.decision.install_code).filter(Boolean))] as string[]
  const rules = useRules(codes)
  if (!ctx && !rules.length) return null
  return (
    <div className={`space-y-7 ${className}`}>
      {ctx && (
        <div>
          <div className="flex items-baseline gap-2">
            <span className="title-hand">{t('catalogueRef')}</span>
            <span className="text-[11.5px] text-muted font-mono">catalog.csv</span>
          </div>
          <FamilyTable ctx={ctx} used={new Set(products.map((p) => p.id))} className="mt-2" />
        </div>
      )}
      {rules.length > 0 && (
        <div>
          <div className="flex items-baseline gap-2">
            <span className="title-hand">{t('productivityRef')}</span>
            <span className="text-[11.5px] text-muted font-mono">productivity.csv</span>
          </div>
          <RuleTable rules={rules} className="mt-2" />
        </div>
      )}
    </div>
  )
}

/** The matched catalogue row (by product id) and its neighbours in the same family. */
export function useCatalog(pid: string | null): CatalogContext | null {
  const [ctx, setCtx] = useState<CatalogContext | null>(null)
  useEffect(() => {
    let live = true
    if (pid) api.catalog(pid).then((c) => live && setCtx(c)).catch(() => live && setCtx(null))
    return () => {
      live = false
    }
  }, [pid])
  return ctx && ctx.item.product_id === pid ? ctx : null
}

function useRules(codes: string[]): ProductivityRule[] {
  const key = codes.join(',')
  const [rules, setRules] = useState<{ key: string; rules: ProductivityRule[] }>({ key: '', rules: [] })
  useEffect(() => {
    let live = true
    if (!key) return
    Promise.all(key.split(',').map((c) => api.rule(c).catch(() => null))).then((rs) => live && setRules({ key, rules: rs.filter(Boolean) as ProductivityRule[] }))
    return () => {
      live = false
    }
  }, [key])
  return rules.key === key ? rules.rules : []
}

export function FamilyTable({ ctx, used, className = '' }: { ctx: CatalogContext; used?: Set<string>; className?: string }) {
  const { t } = useI18n()
  const on = (pid: string) => (used ? used.has(pid) : pid === ctx.item.product_id)
  return (
    <table className={`tbl w-full text-[12.5px] ${className}`}>
      <thead>
        <tr className="text-left text-[11.5px] text-muted border-b border-hair">
          <th className="py-1.5 font-medium">{ctx.item.subcategory}</th>
          <th className="py-1.5 font-medium text-right">{t('listPrice')}</th>
          <th className="py-1.5 font-medium text-right">{t('discount')}</th>
          <th className="py-1.5 font-medium text-right">{t('netPrice')}</th>
        </tr>
      </thead>
      <tbody>
        {ctx.family.map((i) => (
          <tr key={i.product_id} className={`border-b border-hair/70 ${on(i.product_id) ? 'bg-hl-read/35 font-semibold text-ink' : 'text-muted'}`}>
            <td className="py-1.5 pr-2 truncate max-w-[280px]">{i.description}</td>
            <td className="py-1.5 px-2 text-right num">{fmtChf(i.list_price_chf, 2)}</td>
            <td className="py-1.5 px-2 text-right num">{i.discount_pct} %</td>
            <td className="py-1.5 text-right num">{fmtChf(i.net_cost_chf, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function RuleTable({ rules, className = '' }: { rules: ProductivityRule[]; className?: string }) {
  const { t, lang } = useI18n()
  return (
    <table className={`tbl w-full text-[12.5px] ${className}`}>
      <thead>
        <tr className="text-left text-[11.5px] text-muted border-b border-hair">
          <th className="py-1.5 font-medium">{t('workType')}</th>
          <th className="py-1.5 font-medium text-right">{t('hoursPerUnit')}</th>
          <th className="py-1.5 font-medium px-2">{t('labourRole')}</th>
          <th className="py-1.5 font-medium text-right">{t('rate')}</th>
        </tr>
      </thead>
      <tbody>
        {rules.map((r) => (
          <tr key={r.install_code} className="border-b border-hair/70 bg-hl-read/35 font-semibold">
            <td className="py-1.5 pr-2">
              {r.work_type} <span className="font-normal text-muted font-mono text-[11px]">{r.install_code}</span>
              {r.factor_keys.length > 0 && <div className="font-normal text-[11.5px] text-muted">× {r.factor_keys.map((k) => humanize(k)).join(', ')}</div>}
            </td>
            <td className="py-1.5 px-2 text-right num">{fmtNum(r.base_hours_per_unit)} h / {fmtUnit(r.unit, lang)}</td>
            <td className="py-1.5 px-2">{humanize(r.labour_role)}</td>
            <td className="py-1.5 text-right num">{fmtNum(r.default_hourly_rate_chf)} /h</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
