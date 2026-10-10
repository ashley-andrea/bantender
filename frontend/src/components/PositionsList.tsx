import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { LEVEL_COLOR, LEVEL_RANK, fmtChf, fmtNum, fmtUnit } from '../format'
import { lineTitle, systemName, useI18n } from '../i18n'
import type { Level, Offer, PricedLine, SystemInfo } from '../types'

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
  extra?: React.ReactNode
}

/** The least certain way any of the line's values was obtained ("read" when everything was read). */
function worstLevel(l: PricedLine): Level {
  return l.attributes.reduce<Level>((w, a) => (LEVEL_RANK[a.level] > LEVEL_RANK[w] ? a.level : w), 'read')
}

export function PositionsList({ lines, systems, stage, offer, selected, onSelect, query, onQuery, extra }: Props) {
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
    <div className="h-full min-h-0 flex flex-col panel overflow-hidden">
      <div className="px-2 py-2 border-b border-hair shrink-0">
        <div className="relative">
          <Search className="size-3.5 text-faint absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t('search')}
            className="w-full rounded-md bg-canvas pl-7 pr-2 py-1.5 text-[13px] outline-none focus:ring-1 focus:ring-green" />
        </div>
        {extra}
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {groups.map((g) => (
          <div key={g.code}>
            <div className="sticky top-0 z-10 bg-canvas px-3 py-1 text-[11.5px] font-semibold text-muted border-b border-hair">
              {g.code} {systemName(systems[g.code], lang)}
            </div>
            {g.lines.map((l) => {
              const active = l.line_id === selected
              const o = offer?.lines[l.line_id]
              const level = worstLevel(l)
              return (
                <button key={l.line_id} ref={(el) => { refs.current[l.line_id] = el }} onClick={() => onSelect(l)}
                  className={`w-full text-left flex items-baseline gap-2 px-3 py-1.5 border-b border-hair/70 ${active ? 'bg-green/8 shadow-[inset_2px_0_0_var(--color-green)]' : 'hover:bg-canvas'}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] truncate">{lineTitle(l, lang)}</span>
                    <span className="block text-[11px] text-faint num">p.{l.page}{l.source === 'cad' ? ` · ${t('fromCad')}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-right text-[12.5px] num">
                    {stage === 'extract' && (
                      <span className="inline-flex items-center gap-1.5">
                        {l.decision.quantity != null ? `${fmtNum(l.decision.quantity)} ${fmtUnit(l.decision.unit, lang)}` : '—'}
                        <span className="size-1.5 rounded-full" style={{ background: level === 'read' ? 'transparent' : LEVEL_COLOR[level] }} />
                      </span>
                    )}
                    {stage === 'catalog' && (
                      <span className="inline-flex items-center gap-1.5">
                        {l.cost ? fmtChf(l.cost.net_unit_cost, 2) : '—'}
                        <span className="size-1.5 rounded-full" style={{ background: l.status_key === 'supplier_quote_required' ? 'var(--color-warn)' : 'transparent' }} />
                      </span>
                    )}
                    {stage === 'price' && (o?.kind === 'priced' ? (
                      <span className="whitespace-nowrap rise">
                        {l.cost && l.cost.net_unit_cost > 0 && <span className="text-faint">{fmtChf(l.cost.net_unit_cost, 2)} → </span>}
                        <span className="font-semibold">{fmtChf(o.unit_price, 2)}</span>
                      </span>
                    ) : o?.kind === 'included' ? t('included') : '—')}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
