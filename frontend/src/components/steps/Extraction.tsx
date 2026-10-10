import { useEffect, useState } from 'react'
import type { EditField } from '../../api'
import { LEVEL_COLOR, fmtNum, fmtUnit } from '../../format'
import { lineTitle, sectionName, systemName, tx, useI18n, type Key } from '../../i18n'
import type { Level, Parsed, PricedLine } from '../../types'
import { InlineNumber } from '../InlineNumber'
import { ItemGraph } from '../ItemGraph'

/** Right after upload: how long reading took, then the positions as they were found (a quick replay). */
export function ExtractionIntro({ parsed, lines, seconds, onPage, onDone }: {
  parsed: Parsed; lines: PricedLine[]; seconds: number | null; onPage: (p: number) => void; onDone: () => void
}) {
  const { t, lang } = useI18n()
  const [n, setN] = useState(0)
  const lv = lines.filter((l) => l.source === 'lv')

  useEffect(() => {
    if (n >= lv.length) return
    const id = setTimeout(() => setN((x) => Math.min(lv.length, x + 4)), 16)
    return () => clearTimeout(id)
  }, [n, lv.length])

  const last = lv[Math.max(0, n - 1)]
  useEffect(() => {
    if (last && n % 24 === 0) onPage(last.page)
  }, [n, last, onPage])

  return (
    <div className="h-full panel flex flex-col p-6">
      <div className="flex items-baseline gap-3">
        <span className="text-[40px] font-semibold num leading-none">{n}</span>
        <span className="text-muted">{t('found')}</span>
      </div>
      <div className="mt-2 text-[13px] text-muted num">
        {parsed.meta.pages} {t('pages')} {t('readIn')} <b className="text-ink">{seconds != null ? `${seconds.toFixed(1)} s` : '—'}</b>
      </div>
      <div className="mt-5 flex-1 min-h-0 overflow-hidden">
        {lv.slice(Math.max(0, n - 18), n).reverse().map((l) => (
          <div key={l.line_id} className="rise flex items-baseline gap-3 py-1.5 border-b border-hair text-[13px]">
            <span className="text-faint num w-12">p.{l.page}</span>
            <span className="flex-1 truncate">{lineTitle(l, lang)}</span>
            <span className="num text-muted">{l.decision.quantity != null ? `${fmtNum(l.decision.quantity)} ${fmtUnit(l.decision.unit, lang)}` : '—'}</span>
          </div>
        ))}
      </div>
      <button onClick={onDone} className="mt-4 self-end rounded-md bg-green text-white px-4 py-2 text-[13px] font-semibold hover:brightness-110">
        {t('skip')} →
      </button>
    </div>
  )
}

interface PanelProps {
  line: PricedLine
  systems: Parsed['systems']
  active: string | null
  onActive: (k: string) => void
  onEdit: (field: EditField, v: number | null) => void
  busy: boolean
}

export function ExtractionPanel({ line, systems, active, onActive, onEdit, busy }: PanelProps) {
  const { t, lang } = useI18n()
  const attr = line.attributes.find((a) => a.key === active)
  return (
    <div className="h-full min-h-0 overflow-auto scroll-thin panel p-5">
      <LineHeader line={line} systems={systems} />
      <div className="mt-3">
        <ItemGraph line={line} stage="extract" active={active} onActive={onActive} />
      </div>
      <div className="mt-2 min-h-[64px] border-t border-hair pt-3 text-[13px]">
        {attr ? (
          <div className="flex items-start gap-3" key={attr.key}>
            <span className="mt-1 size-2.5 rounded-full shrink-0" style={{ background: LEVEL_COLOR[attr.level] }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-muted">{tx(attr.label, lang)}</span>
                {attr.key === 'quantity' && line.source === 'lv' ? (
                  <InlineNumber value={line.decision.quantity} suffix={fmtUnit(line.decision.unit, lang)} edited={line.decision.overridden.includes('quantity')}
                    busy={busy} onSave={(v) => onEdit('quantity', v)} onReset={() => onEdit('quantity', null)} />
                ) : (
                  <span className="font-semibold">{tx(attr.value, lang) || '—'}</span>
                )}
              </div>
              <div className="text-muted text-[12.5px]">
                {t(attr.level as Key)} · {tx(attr.why, lang)}{attr.sources[0]?.page ? ` · p.${attr.sources[0].page}` : ''}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <Legend />
    </div>
  )
}

export function LineHeader({ line, systems }: { line: PricedLine; systems: Parsed['systems'] }) {
  const { lang } = useI18n()
  return (
    <div>
      <div className="text-[18px] font-semibold leading-snug">{lineTitle(line, lang)}</div>
      <div className="text-[12.5px] text-muted">
        {line.system} {systemName(systems[line.system], lang)} · {line.section} {sectionName(line, lang)} · p.{line.page}
      </div>
    </div>
  )
}

export function Legend() {
  const { t } = useI18n()
  const items: [Level, string][] = [['read', ''], ['derived', '6 4'], ['assumed', '2 4']]
  return (
    <div className="mt-3 flex items-center gap-4 text-[11.5px] text-muted">
      {items.map(([l, dash]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <svg width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke={LEVEL_COLOR[l]} strokeWidth="2" strokeDasharray={dash || undefined} strokeLinecap="round" /></svg>
          {t(l)}
        </span>
      ))}
    </div>
  )
}
