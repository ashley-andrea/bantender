import { Check as CheckIcon, CircleAlert, CircleMinus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { fmtChf, fmtUnit } from '../../format'
import { tx, useI18n } from '../../i18n'
import type { CatalogContext, Parsed, PricedLine } from '../../types'
import { InlineNumber } from '../InlineNumber'
import { ItemGraph } from '../ItemGraph'
import { LineHeader } from './Extraction'

interface Props {
  line: PricedLine
  systems: Parsed['systems']
  active: string | null
  onActive: (k: string) => void
  onQuote: (unitPrice: number | null) => void
  busy: boolean
}

export function CataloguePanel({ line, systems, active, onActive, onQuote, busy }: Props) {
  const { t, lang } = useI18n()
  const pid = line.decision.product_id
  const shown = useCatalog(pid)

  const checks = line.decision.checks.filter((c) => c.key !== 'quantity' && c.key !== 'estimator')
  const needsQuote = line.status_key === 'supplier_quote_required' || line.decision.overridden.includes('unit_price')
  return (
    <div className="h-full min-h-0 overflow-auto scroll-thin panel p-5">
      <LineHeader line={line} systems={systems} />
      <div className="mt-3">
        <ItemGraph line={line} stage="catalog" catalog={shown} active={active} onActive={onActive} />
      </div>

      {!pid && <p className="mt-2 text-[13px] text-muted">{t('noProduct')}</p>}

      {pid && (
        <>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            {checks.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1" title={tx(c.detail, lang)}>
                {c.result === 'pass' ? <CheckIcon className="size-3.5 text-good" /> : c.result === 'partial' ? <CircleMinus className="size-3.5 text-warn" /> : <CircleAlert className="size-3.5 text-bad" />}
                {tx(c.label, lang)}
              </span>
            ))}
          </div>

          {needsQuote && (
            <div className="mt-4 flex items-center gap-3 rounded-md border border-warn/50 bg-warn/8 px-3 py-2 text-[13px]">
              <span className="font-semibold">{t('supplierQuote')}</span>
              <span className="ml-auto text-muted">{t('quotePrice')}</span>
              <InlineNumber value={line.cost?.net_unit_cost ?? null} suffix={`CHF / ${fmtUnit(line.decision.unit, lang)}`}
                edited={line.decision.overridden.includes('unit_price')} busy={busy} onSave={(v) => onQuote(v)} onReset={() => onQuote(null)} />
            </div>
          )}

          {shown && <FamilyTable ctx={shown} className="mt-4" />}
        </>
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

export function FamilyTable({ ctx, className = '' }: { ctx: CatalogContext; className?: string }) {
  const { t } = useI18n()
  return (
    <table className={`w-full text-[12.5px] ${className}`}>
      <thead>
        <tr className="text-left font-mono text-[10.5px] uppercase tracking-wider text-muted border-b border-hair">
          <th className="py-1 font-medium">{ctx.item.subcategory}</th>
          <th className="py-1 font-medium text-right">{t('listPrice')}</th>
          <th className="py-1 font-medium text-right">{t('discount')}</th>
          <th className="py-1 font-medium text-right">{t('netPrice')}</th>
        </tr>
      </thead>
      <tbody>
        {ctx.family.map((i) => {
          const on = i.product_id === ctx.item.product_id
          return (
            <tr key={i.product_id} className={`border-b border-hair/70 ${on ? 'bg-mint font-semibold text-ink' : 'text-muted'}`}>
              <td className="py-1 pr-2 truncate max-w-[260px]">{i.description}</td>
              <td className="py-1 text-right num">{fmtChf(i.list_price_chf, 2)}</td>
              <td className="py-1 text-right num">{i.discount_pct} %</td>
              <td className="py-1 text-right num">{fmtChf(i.net_cost_chf, 2)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
