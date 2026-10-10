import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { certaintyColor, fmtChf, fmtNum, fmtUnit } from '../format'
import { useI18n } from '../i18n'
import type { Offer, PricedLine, SystemInfo } from '../types'

export type Stage = 'extract' | 'catalog' | 'price'

interface Props {
  lines: PricedLine[]
  systems: Record<string, SystemInfo>
  stage: Stage
  offer: Offer | null
  selected: string | null
  onSelect: (l: PricedLine) => void
  query: string
  onQuery: (q: string) => void
}

export const minCertainty = (l: PricedLine) => Math.min(1, ...l.attributes.map((a) => a.certainty))

export function PositionsList({ lines, systems, stage, offer, selected, onSelect, query, onQuery }: Props) {
  const { t, lang } = useI18n()
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  useEffect(() => {
    if (selected) refs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const groups = useMemo(() => {
    const out: { code: string; lines: PricedLine[] }[] = []
    for (const l of lines) {
      if (!out.length || out[out.length - 1].code !== l.system) out.push({ code: l.system, lines: [] })
      out[out.length - 1].lines.push(l)
    }
    return out
  }, [lines])

  return (
    <div className="h-full min-h-0 flex flex-col rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] overflow-hidden">
      <div className="p-2.5 border-b border-hair shrink-0">
        <div className="relative">
          <Search className="size-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t('search')}
            className="w-full rounded-[10px] bg-canvas pl-9 pr-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-sel/30" />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {groups.map((g) => (
          <div key={g.code}>
            <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted border-b border-hair">
              {g.code} {systems[g.code]?.name}
            </div>
            {g.lines.map((l) => {
              const active = l.line_id === selected
              const o = offer?.lines[l.line_id]
              return (
                <button key={l.line_id} ref={(el) => { refs.current[l.line_id] = el }} onClick={() => onSelect(l)}
                  className={`w-full text-left flex items-center gap-2 px-3 py-2 border-b border-hair/60 ${active ? 'bg-sel/8 shadow-[inset_3px_0_0_var(--color-sel)]' : 'hover:bg-canvas/70'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{lang === 'en' ? l.title_en : l.title_de}</div>
                    <div className="text-[11px] text-muted truncate num">
                      {l.section} · p.{l.page}
                      {l.source === 'cad' ? ` · ${t('fromCad')}` : ''}
                      {lang === 'en' && l.title_de !== l.title_en ? ` · ${l.title_de}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0 num">
                    <div className="text-[12.5px] font-semibold">
                      {l.decision.quantity != null ? `${fmtNum(l.decision.quantity)} ${fmtUnit(l.decision.unit)}` : <span className="text-bad">—</span>}
                    </div>
                    {stage === 'extract' && (
                      <div className="flex justify-end mt-1"><span className="size-2 rounded-full" style={{ background: certaintyColor(minCertainty(l)) }} /></div>
                    )}
                    {stage === 'catalog' && (
                      <div className="text-[11px] text-muted">
                        {l.cost ? `${fmtChf(l.cost.net_unit_cost, 2)}` : l.decision.product_id ? '' : '—'}
                        {l.status_key === 'supplier_quote_required' && <span className="ml-1 text-warn font-semibold">●</span>}
                      </div>
                    )}
                    {stage === 'price' && (
                      <div className="text-[11px] text-muted">
                        {o?.kind === 'priced' ? fmtChf(o.amount, 0) : o?.kind === 'included' ? 'inkl.' : l.source === 'cad' && l.cost ? fmtChf(l.cost.direct_cost * (offer?.factor ?? 1), 0) : '—'}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
