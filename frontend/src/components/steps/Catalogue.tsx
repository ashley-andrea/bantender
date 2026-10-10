import { Check as CheckIcon, CircleAlert, CircleMinus, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { fmtChf, fmtUnit } from '../../format'
import { tx, useI18n } from '../../i18n'
import type { CatalogContext, PricedLine } from '../../types'
import { ItemGraph } from '../ItemGraph'
import { LineHeader } from './Extraction'

interface Props {
  line: PricedLine
  active: string | null
  onActive: (k: string | null) => void
  onQuote: (unitPrice: number | null) => void
  busy: boolean
}

export function CataloguePanel({ line, active, onActive, onQuote, busy }: Props) {
  const { t, lang } = useI18n()
  const [ctx, setCtx] = useState<CatalogContext | null>(null)
  const pid = line.decision.product_id

  useEffect(() => {
    setCtx(null)
    if (pid) api.catalog(pid).then(setCtx).catch(() => setCtx(null))
  }, [pid])

  const checks = line.decision.checks.filter((c) => c.key !== 'quantity')
  return (
    <div className="h-full min-h-0 overflow-auto scroll-thin rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5">
      <LineHeader line={line} />
      <div className="mt-4">
        <ItemGraph line={line} stage="catalog" catalog={ctx} active={active} onActive={onActive} />
      </div>

      {!pid && <p className="mt-4 text-[13px] text-muted">{line.decision.reasons.map((r) => tx(r, lang)).join(' ') || t('noProduct')}</p>}

      {pid && (
        <>
          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">{t('matchedBecause')}</div>
            <ul className="space-y-1">
              {checks.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  {c.result === 'pass' ? <CheckIcon className="size-4 text-good mt-px shrink-0" /> : c.result === 'partial' ? <CircleMinus className="size-4 text-warn mt-px shrink-0" /> : <CircleAlert className="size-4 text-bad mt-px shrink-0" />}
                  <span>
                    {tx(c.label, lang)}
                    {c.detail && <span className="text-muted"> · {tx(c.detail, lang)}</span>}
                  </span>
                </li>
              ))}
              {line.decision.assumptions.map((a, i) => (
                <li key={`a${i}`} className="flex items-start gap-2 text-[13px]"><CircleMinus className="size-4 text-warn mt-px shrink-0" />{tx(a, lang)}</li>
              ))}
            </ul>
          </div>

          {line.status_key === 'supplier_quote_required' || line.decision.overridden.includes('unit_price') ? (
            <QuoteBox key={line.line_id} line={line} onQuote={onQuote} busy={busy} />
          ) : null}

          {ctx && (
            <div className="mt-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">
                {t('family')} · {ctx.item.category} / {ctx.item.subcategory} · {ctx.reference_version}
              </div>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] text-muted border-b border-hair">
                    <th className="py-1.5 font-medium">ID</th>
                    <th className="py-1.5 font-medium">{lang === 'de' ? 'Bezeichnung' : 'Description'}</th>
                    <th className="py-1.5 font-medium text-right">{t('listPrice')}</th>
                    <th className="py-1.5 font-medium text-right">{t('discount')}</th>
                    <th className="py-1.5 font-medium text-right">{t('netPrice')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ctx.family.map((i) => {
                    const on = i.product_id === pid
                    return (
                      <tr key={i.product_id} className={`border-b border-hair/60 ${on ? 'bg-sel/10 font-semibold' : 'text-muted'}`}>
                        <td className={`py-1.5 pr-2 font-mono text-[11.5px] ${on ? 'text-sel' : ''}`}>{i.product_id}</td>
                        <td className="py-1.5 pr-2 truncate max-w-[220px]">{i.description}</td>
                        <td className="py-1.5 text-right num">{fmtChf(i.list_price_chf, 2)}</td>
                        <td className="py-1.5 text-right num">{i.discount_pct} %</td>
                        <td className={`py-1.5 text-right num ${on ? 'text-ink' : ''}`}>{fmtChf(i.net_cost_chf, 2)} / {fmtUnit(i.unit)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function QuoteBox({ line, onQuote, busy }: { line: PricedLine; onQuote: (v: number | null) => void; busy: boolean }) {
  const { t } = useI18n()
  const quoted = line.decision.overridden.includes('unit_price')
  const saved = quoted && line.cost ? String(line.cost.net_unit_cost) : ''
  const [value, setValue] = useState(saved)
  useEffect(() => setValue(saved), [saved])
  const parsed = Number(value.replace(/['’\s]/g, '').replace(',', '.'))
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0
  return (
    <div className="mt-4 rounded-xl border border-warn/40 bg-warn/8 p-3">
      <div className="text-[13px] font-semibold text-[#9a5a00]">{t('supplierQuote')}</div>
      <p className="text-[12.5px] text-[#6b4a12] mt-0.5">{t('supplierNote')}</p>
      <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) onQuote(parsed) }}>
        <span className="text-[12.5px] text-muted">{t('enterQuote')}</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={line.cost ? fmtChf(line.cost.net_unit_cost, 2) : ''}
          className="w-28 rounded-lg border border-hair bg-surface px-2 py-1 num text-[13px] outline-none focus:border-sel" />
        <span className="text-[12.5px] text-muted">CHF / {fmtUnit(line.decision.unit)}</span>
        <button disabled={!valid || busy} className="rounded-full bg-ink text-white px-3 py-1 text-[12px] font-semibold disabled:opacity-40">{t('save')}</button>
        {quoted && (
          <button type="button" disabled={busy} onClick={() => onQuote(null)} className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
            <RotateCcw className="size-3.5" /> {t('reset')}
          </button>
        )}
      </form>
    </div>
  )
}
