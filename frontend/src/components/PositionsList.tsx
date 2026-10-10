import { ChevronRight, Search } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { LEVEL_COLOR, LEVEL_RANK, fmtChf, fmtNum, fmtUnit } from '../format'
import { lineTitle, systemName, useI18n } from '../i18n'
import { entryQuantity, entryTitle, type Entry } from '../tree'
import type { Level, Offer, PricedLine, SystemInfo } from '../types'

export type Stage = 'extract' | 'catalog' | 'price'

interface Props {
  entries: Entry[]
  systems: Record<string, SystemInfo>
  stage: Stage
  offer: Offer | null
  selected: string | null
  expanded: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  query: string
  onQuery: (q: string) => void
  extra?: React.ReactNode
}

/** The least certain way any value of these lines was obtained ("read" when everything was read). */
function worstLevel(lines: PricedLine[]): Level {
  return lines.flatMap((l) => l.attributes).reduce<Level>((w, a) => (LEVEL_RANK[a.level] > LEVEL_RANK[w] ? a.level : w), 'read')
}

/** Ids of the rows as shown, top to bottom (for ↑/↓). */
export function visibleIds(entries: Entry[], expanded: Set<string>): string[] {
  return entries.flatMap((e) => [e.id, ...(expanded.has(e.id) ? e.children.map((c) => c.id) : [])])
}

export function PositionsList({ entries, systems, stage, offer, selected, expanded, onSelect, onToggle, query, onQuery, extra }: Props) {
  const { t, lang } = useI18n()
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  useEffect(() => {
    if (selected) refs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const groups = useMemo(() => {
    const out: { code: string; entries: Entry[] }[] = []
    for (const e of entries) {
      const code = e.members[0].system
      if (!out.length || out[out.length - 1].code !== code) out.push({ code, entries: [] })
      out[out.length - 1].entries.push(e)
    }
    return out
  }, [entries])

  const amount = (ls: PricedLine[]) => ls.reduce((s, l) => s + (offer?.lines[l.line_id]?.amount ?? 0), 0)

  const right = (lines: PricedLine[], group: boolean) => {
    const l = lines[0]
    if (stage === 'extract') {
      const level = worstLevel(lines)
      return (
        <span className="inline-flex items-center gap-1.5">
          {group ? '' : l.decision.quantity != null ? `${fmtNum(l.decision.quantity)} ${fmtUnit(l.decision.unit, lang)}` : '—'}
          <span className="size-1.5 rounded-full" style={{ background: level === 'read' ? 'transparent' : LEVEL_COLOR[level] }} />
        </span>
      )
    }
    if (stage === 'catalog') {
      const quote = lines.some((x) => x.status_key === 'supplier_quote_required')
      const nets = [...new Set(lines.map((x) => x.cost?.net_unit_cost).filter((n) => n != null))] as number[]
      return (
        <span className="inline-flex items-center gap-1.5">
          {nets.length === 0 ? '—' : nets.length === 1 ? fmtChf(nets[0], 2) : `${fmtChf(Math.min(...nets), 2)}–${fmtChf(Math.max(...nets), 2)}`}
          <span className="size-1.5 rounded-full" style={{ background: quote ? 'var(--color-warn)' : 'transparent' }} />
        </span>
      )
    }
    if (group) return <span className="font-semibold">{fmtChf(amount(lines), 2)}</span>
    const o = offer?.lines[l.line_id]
    if (o?.kind === 'included') return t('included')
    if (o?.kind !== 'priced') return '—'
    return (
      <span className="whitespace-nowrap rise">
        {l.cost && l.cost.net_unit_cost > 0 && <span className="text-faint">{fmtChf(l.cost.net_unit_cost, 2)} → </span>}
        <span className="font-semibold">{fmtChf(o.unit_price, 2)}</span>
      </span>
    )
  }

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
            <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur px-3 py-1 font-semibold text-[12px] text-muted border-b border-dashed border-hair">
              {g.code} {systemName(systems[g.code], lang)}
            </div>
            {g.entries.map((e) => {
              const open = expanded.has(e.id)
              const hasKids = e.children.length > 0
              const first = e.members[0]
              const isGroup = e.kind === 'group'
              return (
                <div key={e.id}>
                  <Row id={e.id} refs={refs} active={selected === e.id} onClick={() => onSelect(e.id)}
                    chevron={hasKids ? (
                      <button onClick={(ev) => { ev.stopPropagation(); onToggle(e.id) }} className="p-0.5 -ml-1 rounded hover:bg-canvas" aria-label="toggle">
                        <ChevronRight className={`size-3.5 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
                      </button>
                    ) : <span className="w-[18px] -ml-1 shrink-0" />}
                    title={entryTitle(e, lang)}
                    sub={<>p.{[...new Set(e.members.map((m) => m.page))].join(', ')}{first.source === 'cad' ? ` · ${t('fromCad')}` : ''}
                      {isGroup ? <span className="text-green font-semibold text-[11px]"> · {e.members.length} {t('variants')} · {entryQuantity(e, lang)}</span> : ''}
                      {!isGroup && hasKids ? <span className="text-muted"> · {e.children.length} {t('partsWord')}</span> : ''}</>}
                    right={right(e.members, isGroup)} />
                  {open && e.children.map((c) => (
                    <Row key={c.id} id={c.id} refs={refs} active={selected === c.id} onClick={() => onSelect(c.id)} child
                      chevron={<span className="w-[18px] -ml-1 shrink-0" />}
                      title={c.role === 'variant' ? variantLabel(c.line, lang) : lineTitle(c.line, lang)}
                      sub={<>p.{c.line.page}{c.role === 'part' ? <span> · {t('partWord')}</span> : ''}</>}
                      right={right([c.line], false)} />
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A variant row: what makes it different (its size, when it has one). */
function variantLabel(l: PricedLine, lang: 'en' | 'de') {
  const size = l.attributes.find((a) => a.key === 'size')
  const v = size ? (typeof size.value === 'string' ? size.value : size.value?.[lang]) : null
  const idx = l.group?.kind === 'variant' ? l.group.index + 1 : 1
  return v || `${lang === 'en' ? 'Variant' : 'Variante'} ${idx}`
}

function Row({ id, refs, active, onClick, chevron, title, sub, right, child }: {
  id: string; refs: React.RefObject<Record<string, HTMLDivElement | null>>; active: boolean; onClick: () => void
  chevron: React.ReactNode; title: string; sub: React.ReactNode; right: React.ReactNode; child?: boolean
}) {
  return (
    <div ref={(el) => { refs.current[id] = el }} onClick={onClick} role="button" tabIndex={-1}
      className={`w-full cursor-pointer text-left flex items-baseline gap-1.5 pr-3 py-1.5 border-b border-hair/70 ${child ? 'pl-7' : 'pl-3'}
        ${active ? 'bg-hl-read/30 shadow-[inset_3px_0_0_var(--color-green)]' : 'hover:bg-canvas'}`}>
      {chevron}
      <span className={`min-w-0 flex-1 ${child ? 'border-l-[1.5px] border-dashed border-faint/60 pl-2' : ''}`}>
        <span className={`block truncate ${child ? 'text-[12.5px]' : 'text-[13px]'}`}>{title}</span>
        <span className="block text-[11px] text-faint num truncate">{sub}</span>
      </span>
      <span className="shrink-0 text-right text-[12.5px] num">{right}</span>
    </div>
  )
}
