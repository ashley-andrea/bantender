import { Download, FileCheck2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fmtChf, fmtNum, fmtPct } from '../../format'
import { useI18n, type Key } from '../../i18n'
import type { Offer, Pricing } from '../../types'

/** Reserved for the AI loop (bid optimisation); intentionally inert. */
export function OfferOptions({ pricing }: { pricing: Pricing }) {
  const { t } = useI18n()
  const p = pricing.project
  return (
    <div className="h-full grid place-items-center">
      <div className="w-full max-w-2xl">
        <div className="rounded-[20px] bg-surface shadow-[var(--shadow-card)] p-8">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-brand/15 grid place-items-center"><Sparkles className="size-5 text-[#b88a00]" /></div>
            <div>
              <div className="text-[19px] font-semibold">{t('aiTitle')}</div>
              <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('aiSoon')}</div>
            </div>
          </div>
          <p className="mt-4 text-[14.5px] text-muted leading-relaxed">{t('aiBody')}</p>
          <div className="mt-6 grid grid-cols-3 gap-3">
            {(['aiAggressive', 'currentOffer', 'aiConservative'] as Key[]).map((k) => (
              <div key={k} className={`rounded-xl p-4 ${k === 'currentOffer' ? 'bg-ink text-white' : 'border border-dashed border-hair text-faint'}`}>
                <div className={`text-[11px] uppercase tracking-wide ${k === 'currentOffer' ? 'text-[#a1a1a6]' : ''}`}>{t(k)}</div>
                <div className="mt-1 text-[20px] font-semibold num">{k === 'currentOffer' ? `CHF ${fmtChf(p.selling_price)}` : 'CHF ———'}</div>
                <div className={`text-[12px] num ${k === 'currentOffer' ? 'text-[#c7c7cc]' : ''}`}>{k === 'currentOffer' ? `${t('margin')} ${fmtPct(p.margin_pct)}` : '—'}</div>
              </div>
            ))}
          </div>
          <button disabled className="mt-6 w-full rounded-full bg-canvas text-faint py-3 text-[15px] font-semibold cursor-not-allowed inline-flex items-center justify-center gap-2">
            <Sparkles className="size-4" /> {t('aiButton')}
          </button>
        </div>
      </div>
    </div>
  )
}

const FIELD_GROUPS: { kinds: string[]; key: Key }[] = [
  { kinds: ['unit_price', 'amount'], key: 'fPositions' },
  { kinds: ['included'], key: 'fIncluded' },
  { kinds: ['section_total', 'montage', 'services', 'cad_material', 'days'], key: 'fSections' },
  { kinds: ['summary_cell', 'summary_total', 'lot_cell', 'lot_total', 'lot_brutto'], key: 'fSummary' },
  { kinds: ['brutto', 'netto', 'condition', 'condition_pct'], key: 'fConditions' },
]

interface ExportProps {
  offer: Offer
  pricing: Pricing
  url: string
  onJump: (page: number) => void
  onConditions: (patch: { discount_pct?: number; cash_discount_pct?: number }) => void
  busy: boolean
}

export function ExportPanel({ offer, pricing, url, onJump, onConditions, busy }: ExportProps) {
  const { t } = useI18n()
  const c = offer.conditions
  const firstLv = offer.fields.find((f) => f.kind === 'unit_price')?.page
  const summaryPage = offer.fields.find((f) => f.kind === 'summary_cell')?.page
  const tenderLines = pricing.summary.tender
  return (
    <div className="h-full min-h-0 overflow-auto scroll-thin space-y-4">
      <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5">
        <div className="flex items-center gap-2">
          <FileCheck2 className="size-5 text-good" />
          <div className="text-[15px] font-semibold">{t('whatIsFilled')}</div>
        </div>
        <ul className="mt-3 space-y-1.5 text-[13px]">
          {FIELD_GROUPS.map((g) => {
            const n = offer.fields.filter((f) => g.kinds.includes(f.kind)).length
            const pages = offer.fields.filter((f) => g.kinds.includes(f.kind)).map((f) => f.page)
            const page = pages.length ? Math.min(...pages) : null
            return (
              <li key={g.key} className="flex items-baseline gap-2">
                <span className="num font-semibold w-10 text-right">{fmtNum(n)}</span>
                <span className="flex-1">{t(g.key)}</span>
                {page && <button onClick={() => onJump(page)} className="text-sel text-[12px] font-medium">p.{page} →</button>}
              </li>
            )
          })}
        </ul>
        <div className="mt-3 text-[12px] text-muted num">
          {fmtNum(tenderLines.priced)} / {fmtNum(tenderLines.to_price)} {t('positionsPriced')} · {fmtNum(offer.fields.length)} {t('fieldsTotal')}
        </div>
        <p className="mt-3 text-[12px] text-muted">{t('onlyNumbers')}</p>
      </div>

      <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5">
        <div className="text-[13px] font-semibold">{t('conditions')}{c.page})</div>
        <table className="mt-2 w-full text-[13px] num">
          <tbody>
            <CondRow label={t('cGross')} value={c.brutto} strong />
            {Math.abs(offer.rounding_difference) >= 0.005 && (
              <tr><td colSpan={2} className="pb-1.5 text-[11.5px] text-muted">{t('roundingNote')} {fmtChf(offer.selling_price)} ({offer.rounding_difference > 0 ? '+' : '−'}{fmtChf(Math.abs(offer.rounding_difference), 2)})</td></tr>
            )}
            <PctRow label={t('discount')} pct={c.discount_pct} value={-c.discount} onCommit={(v) => onConditions({ discount_pct: v })} busy={busy} />
            <CondRow label={t('cSubtotal')} value={c.sub1} muted />
            <PctRow label={t('cashDiscount')} pct={c.cash_discount_pct} value={-c.cash_discount} onCommit={(v) => onConditions({ cash_discount_pct: v })} busy={busy} />
            <CondRow label={t('cSubtotal')} value={c.sub2} muted />
            <CondRow label={`${t('cDeductions')} ${fmtPct(c.deductions_pct)}`} value={-c.deductions} />
            <CondRow label={t('cSubtotal')} value={c.sub3} muted />
            <CondRow label={`${t('cVat')} ${fmtPct(c.vat_pct)}`} value={c.vat} />
            <CondRow label={t('cNet')} value={c.netto} strong />
          </tbody>
        </table>
        <p className="mt-2 text-[11.5px] text-muted">{t('deductionsWhy')}</p>
      </div>

      <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5">
        <div className="flex flex-wrap gap-2 text-[12.5px]">
          <span className="text-muted self-center">{t('jumpTo')}</span>
          {c.page && <Chip onClick={() => onJump(c.page)}>{t('conditions').replace(/\s*\(.*$/, '')} · p.{c.page}</Chip>}
          {summaryPage && <Chip onClick={() => onJump(summaryPage)}>{t('costSummary')} · p.{summaryPage}</Chip>}
          {firstLv && <Chip onClick={() => onJump(firstLv)}>{t('firstPosition')} · p.{firstLv}</Chip>}
        </div>
        <a href={url} className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-brand-ink py-3 text-[15px] font-semibold hover:brightness-95">
          <Download className="size-4" /> {t('download')}
        </a>
      </div>
    </div>
  )
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-full bg-canvas px-3 py-1 font-medium hover:bg-hair">{children}</button>
}

function CondRow({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <tr className={`border-b border-hair/60 ${strong ? 'font-semibold' : ''} ${muted ? 'text-muted' : ''}`}>
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-right">{fmtChf(value, 2)}</td>
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
    <tr className="border-b border-hair/60">
      <td className="py-1.5">
        <span>{label}</span>
        <input value={v} disabled={busy} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="ml-2 w-14 rounded-md border border-hair bg-canvas px-1.5 py-0.5 text-right text-[12.5px] outline-none focus:border-sel" />
        <span className="ml-1 text-muted">%</span>
      </td>
      <td className="py-1.5 text-right">{fmtChf(value, 2)}</td>
    </tr>
  )
}
