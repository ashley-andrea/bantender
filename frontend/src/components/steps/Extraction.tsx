import { useEffect, useMemo, useState } from 'react'
import { certaintyColor, fmtNum, fmtUnit } from '../../format'
import { tx, useI18n } from '../../i18n'
import type { EditField } from '../../api'
import type { Attribute, Parsed, PricedLine } from '../../types'
import { InlineNumber } from '../InlineNumber'
import { ItemGraph } from '../ItemGraph'

/** Live reading: pages flip, positions appear in the order they are found. */
export function ExtractionIntro({ parsed, lines, onPage, onDone }: { parsed: Parsed; lines: PricedLine[]; onPage: (p: number) => void; onDone: () => void }) {
  const { t, lang } = useI18n()
  const lvPages = useMemo(() => parsed.pages.filter((p) => p.kind === 'lv' || p.kind === 'component_list').map((p) => p.page), [parsed])
  const [i, setI] = useState(0)
  const page = lvPages[Math.min(i, lvPages.length - 1)] ?? 1

  useEffect(() => {
    if (i >= lvPages.length) {
      const id = setTimeout(onDone, 700)
      return () => clearTimeout(id)
    }
    const id = setTimeout(() => setI(i + 1), 45)
    return () => clearTimeout(id)
  }, [i, lvPages.length, onDone])

  // The PDF pane follows every few pages (rendering each page would stutter).
  useEffect(() => {
    if (i % 6 === 0 || i >= lvPages.length) onPage(page)
  }, [i])

  const found = lines.filter((l) => l.page <= page)
  const pct = Math.min(100, Math.round((i / Math.max(1, lvPages.length)) * 100))
  return (
    <div className="h-full flex flex-col rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-6">
      <div className="flex items-baseline gap-3">
        <div className="text-[34px] font-bold num tracking-tight">{found.length}</div>
        <div className="text-muted">{t('found')}</div>
        <button onClick={onDone} className="ml-auto text-[13px] text-sel font-semibold">{t('skip')} →</button>
      </div>
      <div className="mt-1 text-[13px] text-muted num">
        {t('reading')} {page} / {parsed.meta.pages}
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-hair overflow-hidden">
        <div className="h-full bg-brand transition-all duration-100" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-5 flex-1 min-h-0 overflow-hidden flex flex-col gap-1.5">
        {found.slice(-16).reverse().map((l) => (
          <div key={l.line_id} className="rise flex items-center gap-3 rounded-xl bg-canvas px-3 py-2 text-[13px]">
            <span className="font-mono text-[11px] text-muted w-28 truncate">{l.line_id}</span>
            <span className="flex-1 truncate font-medium">{lang === 'en' ? l.title_en : l.title_de}</span>
            <span className="num text-muted">{l.decision.quantity != null ? `${fmtNum(l.decision.quantity)} ${fmtUnit(l.decision.unit)}` : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface PanelProps {
  line: PricedLine
  active: string | null
  onActive: (k: string | null) => void
  onEdit: (field: EditField, v: number | null) => void
  busy: boolean
}

export function ExtractionPanel({ line, active, onActive, onEdit, busy }: PanelProps) {
  const { t, lang } = useI18n()
  const attr: Attribute | undefined = line.attributes.find((a) => a.key === active)
  const qty = line.attributes.find((a) => a.key === 'quantity')
  return (
    <div className="h-full min-h-0 overflow-auto scroll-thin rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5">
      <LineHeader line={line} />
      {line.source === 'lv' && (
        <div className="mt-2 flex items-center gap-2 text-[13px]">
          <span className="text-muted">{t('quantity')}</span>
          <InlineNumber value={line.decision.quantity} suffix={fmtUnit(line.decision.unit)} edited={line.decision.overridden.includes('quantity')} busy={busy}
            onSave={(v) => onEdit('quantity', v)} onReset={() => onEdit('quantity', null)} />
          {qty && !line.decision.overridden.includes('quantity') && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              <span className="size-1.5 rounded-full" style={{ background: certaintyColor(qty.certainty) }} /> {tx(qty.why, lang)}
            </span>
          )}
        </div>
      )}
      <div className="mt-4">
        <ItemGraph line={line} stage="extract" active={active} onActive={onActive} />
      </div>
      <Legend />
      <div className="mt-4 min-h-[92px] rounded-xl bg-canvas p-4 text-[13px]">
        {attr ? (
          <div className="rise" key={attr.key}>
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: certaintyColor(attr.certainty) }} />
              <span className="font-semibold">{tx(attr.label, lang)}</span>
              <span className="ml-auto num text-muted">{t('certainty')} {Math.round(attr.certainty * 100)} %</span>
            </div>
            <div className="mt-1 text-[15px] font-semibold">{tx(attr.value, lang) || '—'}</div>
            <div className="mt-1 text-muted">{tx(attr.why, lang)}</div>
            {attr.sources.filter((s) => s.text).map((s, i) => (
              <div key={i} className="mt-2 font-mono text-[12px] rounded-md bg-surface px-2 py-1 border border-hair">
                p.{s.page} · «{s.text}»
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted">{t('clickNode')}</div>
        )}
      </div>
    </div>
  )
}

export function LineHeader({ line }: { line: PricedLine }) {
  const { lang } = useI18n()
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted num">
        {line.system} · {line.section} {line.section_name} · p.{line.page}
      </div>
      <div className="mt-0.5 text-[19px] font-semibold leading-snug">{lang === 'en' ? line.title_en : line.title_de}</div>
      {lang === 'en' && line.title_de !== line.title_en && <div className="text-[13px] text-muted italic">{line.title_de}</div>}
    </div>
  )
}

export function Legend() {
  const { t } = useI18n()
  return (
    <div className="mt-3 flex items-center gap-4 text-[11.5px] text-muted">
      <span className="font-semibold">{t('certainty')}</span>
      {([[1, t('high')], [0.8, t('medium')], [0.5, t('low')]] as [number, string][]).map(([c, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: certaintyColor(c) }} /> {label}
        </span>
      ))}
    </div>
  )
}
