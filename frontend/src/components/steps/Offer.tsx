import { Download } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fmtChf, fmtPct } from '../../format'
import { systemName, useI18n, type Key } from '../../i18n'
import type { Offer, Parsed, Pricing } from '../../types'

/** Reserved for the AI loop (bid optimisation); intentionally inert. */
export function OfferOptions({ pricing }: { pricing: Pricing }) {
  const { t } = useI18n()
  const p = pricing.project
  return (
    <div className="h-full grid place-items-center">
      <div className="w-full max-w-xl panel p-6">
        <div className="text-[17px] font-semibold">{t('aiTitle')}</div>
        <p className="mt-1 text-[13.5px] text-muted">{t('aiBody')}</p>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {(['aiAggressive', 'currentOffer', 'aiConservative'] as Key[]).map((k) => (
            <div key={k} className={`rounded-md p-3 ${k === 'currentOffer' ? 'bg-navy text-white' : 'border border-dashed border-hair text-faint'}`}>
              <div className="text-[12px]">{t(k)}</div>
              <div className="mt-1 text-[16px] font-semibold num">{k === 'currentOffer' ? fmtChf(p.selling_price) : '—'}</div>
              <div className="text-[12px] num">{k === 'currentOffer' ? `${t('margin')} ${fmtPct(p.margin_pct)}` : ''}</div>
            </div>
          ))}
        </div>
        <button disabled className="mt-5 w-full rounded-md bg-canvas text-faint py-2.5 text-[13.5px] font-semibold cursor-not-allowed">{t('aiButton')}</button>
      </div>
    </div>
  )
}

interface ExportProps {
  offer: Offer
  parsed: Parsed
  page: number
  url: string
  onJump: (page: number) => void
  onConditions: (patch: { discount_pct?: number; cash_discount_pct?: number }) => void
  busy: boolean
}

export function ExportPanel({ offer, parsed, page, url, onJump, onConditions, busy }: ExportProps) {
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

  return (
    <div className="h-full min-h-0 flex flex-col panel overflow-hidden">
      <div className="p-4 border-b border-hair">
        <a href={url} className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-green text-white py-2.5 text-[14px] font-semibold hover:brightness-110">
          <Download className="size-4" /> {t('download')}
        </a>
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
      <div className="px-4 pt-3 pb-1 flex items-baseline text-[12.5px]">
        <span className="font-semibold">{t('filledPages')}</span>
        <span className="ml-auto text-muted num">{pageCount} {t('pages')} · {offer.fields.length} {t('fields')}</span>
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
      {/* Right padding leaves room for the assistant's button in the corner. */}
      <div className="pl-4 pr-20 py-3 border-t border-hair text-[12px] text-muted">
        <span className="font-semibold text-ink">{t('notFilled')}: </span>{t('notFilledBody')}
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
