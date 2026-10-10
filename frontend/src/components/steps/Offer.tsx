import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtChf, fmtPct } from '../../format'
import { systemName, useI18n } from '../../i18n'
import type { Offer, OfferChoice, Parsed } from '../../types'

const SCENARIO_LABEL: Record<string, { en: string; de: string }> = {
  Aggressive: { en: 'Aggressive', de: 'Aggressiv' }, Target: { en: 'Target', de: 'Ziel' }, Conservative: { en: 'Conservative', de: 'Vorsichtig' },
  Custom: { en: 'Own choice on the curve', de: 'Eigene Wahl auf der Kurve' },
}

interface ExportProps {
  choice: OfferChoice | null
  offer: Offer
  parsed: Parsed
  page: number
  url: string
  onJump: (page: number) => void
  onConditions: (patch: { discount_pct?: number; cash_discount_pct?: number }) => void
  busy: boolean
}

export function ExportPanel({ choice, offer, parsed, page, url, onJump, onConditions, busy }: ExportProps) {
  const { t, lang } = useI18n()
  const c = offer.conditions

  // Every page that received numbers, in document order: the offer pages, then each system's LV pages.
  const groups = useMemo(() => {
    const count = new Map<number, number>()
    const summary = new Set<number>()
    for (const f of offer.fields) {
      count.set(f.page, (count.get(f.page) ?? 0) + 1)
      if (f.kind === 'system_summary' || f.kind === 'system_total') summary.add(f.page)
    }
    const pages = [...count.keys()].sort((a, b) => a - b)
    const out: { label: string; pages: { page: number; n: number; summary: boolean }[] }[] = []
    for (const p of pages) {
      const sys = Object.entries(parsed.systems).find(([, s]) => s.first_page <= p && p <= s.last_page)
      const label = sys ? `${sys[0]} ${systemName(sys[1], lang)}`
        : p === c.page ? t('pConditions') : t('pSummary')
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, pages: [] })
      out[out.length - 1].pages.push({ page: p, n: count.get(p) ?? 0, summary: summary.has(p) })
    }
    return out
  }, [offer, parsed, c.page, t, lang])
  const pageCount = groups.reduce((n, g) => n + g.pages.length, 0)
  // Step through the filled pages in document order (arrows here, or ← / → on the keyboard).
  const filled = groups.flatMap((g) => g.pages.map((p) => p.page))
  const at = filled.indexOf(page)
  const go = (d: number) => {
    const i = at < 0 ? (d > 0 ? filled.findIndex((p) => p > page) : filled.length - 1 - [...filled].reverse().findIndex((p) => p < page)) : at + d
    if (filled[i] != null) onJump(filled[i])
  }
  const goRef = useRef(go)
  goRef.current = go
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === 'ArrowRight') goRef.current(1)
      if (e.key === 'ArrowLeft') goRef.current(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="h-full min-h-0 flex flex-col panel overflow-hidden">
      <div className="p-4 border-b border-hair">
        <a href={url} className="btn btn-green w-full py-2.5 text-[14px]">
          <Download className="size-4" /> {t('download')}
        </a>
        {choice && (
          <div className="mt-3 text-[13px] text-ink">
            {t('chosenOffer')}: <b>{SCENARIO_LABEL[choice.scenario]?.[lang] ?? choice.scenario}</b>
            {choice.win_probability != null && <span className="text-muted"> · {Math.round(choice.win_probability * 100)} % {t('winChanceShort')}</span>}
          </div>
        )}
        <table className="mt-3 w-full text-[13px] num">
          <tbody>
            <Row label={t('cGross')} value={c.brutto} />
            <PctRow label={t('discount')} pct={c.discount_pct} value={-c.discount} onCommit={(v) => onConditions({ discount_pct: v })} busy={busy} />
            <PctRow label={t('cashDiscount')} pct={c.cash_discount_pct} value={-c.cash_discount} onCommit={(v) => onConditions({ cash_discount_pct: v })} busy={busy} />
            <Row label={`${t('cDeductions')} ${fmtPct(c.deductions_pct)}`} value={-c.deductions} />
            <Row label={`${t('cVat')} ${fmtPct(c.vat_pct)}`} value={c.vat} />
            <Row label={t('cNet')} value={c.netto} strong />
          </tbody>
        </table>
      </div>
      <div className="px-4 pt-3 pb-1 flex items-center gap-2 text-[12.5px]">
        <span className="title-hand">{t('filledPages')}</span>
        <span className="text-muted num">{pageCount} · {offer.fields.length} {t('fields')}</span>
        <span className="ml-auto inline-flex items-center gap-1">
          <button className="btn btn-paper p-1" disabled={at <= 0} onClick={() => go(-1)} title={t('prevFilled')}><ChevronLeft className="size-4" /></button>
          <span className="num text-muted w-14 text-center">{at >= 0 ? at + 1 : '–'} / {pageCount}</span>
          <button className="btn btn-paper p-1" disabled={at >= pageCount - 1} onClick={() => go(1)} title={t('nextFilled')}><ChevronRight className="size-4" /></button>
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin px-4 pb-3">
        {groups.map((g) => (
          <div key={g.label} className="py-1.5 border-b border-hair/70 last:border-0">
            <div className="text-[12.5px]">{g.label}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {g.pages.map((p) => (
                <button key={p.page} onClick={() => onJump(p.page)} title={`${p.n} ${t('fields')}${p.summary ? ` · ${t('pSystemSummary')}` : ''}`}
                  className={`min-w-9 rounded px-1.5 py-0.5 text-[11.5px] num border ${p.page === page ? 'bg-green text-white border-green'
                    : p.summary ? 'border-green/60 text-green hover:bg-green/10' : 'border-hair text-muted hover:border-green hover:text-ink'}`}>
                  {p.page}{p.summary ? ' Σ' : ''}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr className={strong ? 'font-semibold border-t border-hair' : ''}>
      <td className={`py-0.5 ${strong ? 'pt-1.5' : 'text-muted'}`}>{label}</td>
      <td className={`py-0.5 text-right ${strong ? 'pt-1.5' : ''}`}>{fmtChf(value, 2)}</td>
    </tr>
  )
}

function PctRow({ label, pct, value, onCommit, busy }: { label: string; pct: number; value: number; onCommit: (v: number) => void; busy: boolean }) {
  const [v, setV] = useState(String(pct))
  useEffect(() => setV(String(pct)), [pct])
  const commit = () => {
    const n = Number(v.replace(',', '.'))
    if (Number.isFinite(n) && n >= 0 && n < 100 && n !== pct) onCommit(n)
    else setV(String(pct))
  }
  return (
    <tr>
      <td className="py-0.5 text-muted">
        {label}
        <input value={v} disabled={busy} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="ml-2 w-10 rounded border border-hair bg-surface px-1 text-right text-[12.5px] text-ink outline-none focus:border-green" />
        <span className="ml-0.5">%</span>
      </td>
      <td className="py-0.5 text-right">{fmtChf(value, 2)}</td>
    </tr>
  )
}
