import { Check as CheckIcon, CircleAlert, CircleMinus, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fmtChf, fmtNum, fmtUnit, sizeChips } from '../format'
import { STATUS_META, useI18n } from '../i18n'
import type { Line, Override, PricedLine } from '../types'

export function statusKey(p: PricedLine) {
  return p.decision.status === 'review_required' && !p.cost ? 'needs_price' : p.decision.status
}

export function StatusChip({ line }: { line: PricedLine }) {
  const { lang } = useI18n()
  const m = STATUS_META[statusKey(line)]
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.tone}`}>{m[lang]}</span>
}

export function lineTitle(p: PricedLine, lang: 'en' | 'de') {
  return lang === 'en' ? p.title_en || p.title_de : p.title_de || p.title_en
}

interface Props {
  line: PricedLine
  source: Line | undefined
  busy: boolean
  onOverride: (body: Override) => void
  onReset: () => void
}

export function LineDetail({ line, source, busy, onOverride, onReset }: Props) {
  const { t, lang } = useI18n()
  const d = line.decision
  const c = line.cost
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  useEffect(() => {
    setQty(d.quantity != null ? String(d.quantity) : '')
    setPrice(c && c.price_source === 'estimator_input' ? String(c.net_unit_cost) : '')
  }, [line.line_id, d.quantity, c])

  const chips = source ? sizeChips(source.sizes) : []
  const germanText = source ? [source.header, ...source.shared_text, ...source.local_text].filter(Boolean) : [line.title_de]
  const canConfirm = d.priced && ['review_required', 'assumption_applied'].includes(d.status)

  return (
    <div className="h-full min-h-0 overflow-auto scroll-thin rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-4 rise" key={line.line_id}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-muted num">
            {line.line_id} · {t('pageWord')}
            {line.page}
            {line.source === 'cad' && ` · ${t('fromCad')}`}
          </div>
          <div className="mt-1 text-[17px] font-semibold leading-snug">{lineTitle(line, lang)}</div>
          {lang === 'en' && line.title_de && line.title_de !== line.title_en && <div className="text-[12.5px] text-muted italic">{line.title_de}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] uppercase tracking-wide text-muted">{t('direct')}</div>
          <div className="text-[24px] font-bold num leading-tight">{c ? fmtChf(c.direct_cost) : '—'}</div>
          <StatusChip line={line} />
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((x) => (
            <span key={x} className="rounded-full bg-sel/10 text-sel px-2.5 py-0.5 text-[12px] font-semibold num">
              {x}
            </span>
          ))}
        </div>
      )}

      {/* Why this price */}
      <Section title={t('whyPrice')}>
        {d.reasons.map((r) => (
          <p key={r} className="text-[12.5px] text-ink mb-1.5">
            {r}
          </p>
        ))}
        {d.checks.length > 0 && (
          <ul className="space-y-1">
            {d.checks.map((ch) => (
              <li key={ch.key + ch.label} className="flex items-start gap-2 text-[12.5px]">
                {ch.result === 'pass' ? (
                  <CheckIcon className="size-4 text-good shrink-0 mt-px" />
                ) : ch.result === 'partial' ? (
                  <CircleMinus className="size-4 text-warn shrink-0 mt-px" />
                ) : (
                  <CircleAlert className="size-4 text-bad shrink-0 mt-px" />
                )}
                <span>
                  {ch.label}
                  {ch.detail && <span className="text-muted"> · {ch.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {d.confidence != null && (
          <div className="mt-2 text-[12px] text-muted">
            {t('confidence')}: <span className="font-semibold text-ink num">{Math.round(d.confidence * 100)} %</span> ({d.band})
          </div>
        )}
        {d.assumptions.length > 0 && (
          <div className="mt-2 rounded-lg bg-sel/6 px-3 py-2 text-[12.5px]">
            <span className="font-semibold">{t('assumptions')}: </span>
            {d.assumptions.join(' ')}
          </div>
        )}
      </Section>

      {/* Calculation trace */}
      {c && (
        <Section title={t('calculation')}>
          <table className="w-full text-[12.5px]">
            <tbody>
              {c.trace.map((s) => (
                <tr key={s.label} className="border-b border-hair/60 last:border-0">
                  <td className="py-1 pr-2 font-medium whitespace-nowrap">{s.label}</td>
                  <td className="py-1 pr-2 text-muted num">{s.formula}</td>
                  <td className="py-1 text-right num font-semibold whitespace-nowrap">{s.label === 'Installation hours' ? `${fmtNum(Math.round(s.value * 100) / 100)} h` : fmtChf(s.value, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[11.5px] text-muted">
            {d.product_id ?? (c.price_source === 'labour_only' ? t('labourOnly') : '')} · {c.price_source}
          </div>
        </Section>
      )}

      {/* Actions */}
      <Section title="">
        <div className="flex flex-wrap items-center gap-2">
          {canConfirm && (
            <button disabled={busy} onClick={() => onOverride({ confirmed: true, note: 'Checked against tender' })}
              className="rounded-full bg-good text-white px-3.5 py-1.5 text-[12.5px] font-semibold hover:brightness-95 disabled:opacity-50">
              {t('confirm')}
            </button>
          )}
          <Inline label={t('editQty')} value={qty} onChange={setQty} suffix={fmtUnit(d.unit, d.unit ?? '')}
            onSave={() => qty && onOverride({ quantity: Number(qty) })} busy={busy} save={t('save')} />
          <Inline label={t('setPrice')} value={price} onChange={setPrice} suffix="CHF"
            onSave={() => price && onOverride({ unit_price: Number(price), unit_price_source: 'estimator_input', note: 'Unit price entered by estimator' })}
            busy={busy} save={t('save')} />
          {d.labour_only_possible && !c && (
            <button disabled={busy} onClick={() => onOverride({ labour_only: true })} className="rounded-full border border-hair px-3 py-1.5 text-[12.5px] font-medium hover:border-sel">
              {t('labourOnly')}
            </button>
          )}
          {d.status !== 'out_of_scope' && (
            <button disabled={busy} onClick={() => onOverride({ status: 'out_of_scope', note: 'Excluded by estimator' })}
              className="rounded-full border border-hair px-3 py-1.5 text-[12.5px] font-medium hover:border-bad hover:text-bad">
              {t('exclude')}
            </button>
          )}
          {d.overridden.length > 0 && (
            <button disabled={busy} onClick={onReset} className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
              <RotateCcw className="size-3.5" /> {t('reset')} ({t('edited')}: {d.overridden.join(', ')})
            </button>
          )}
        </div>
      </Section>

      {d.alternatives.length > 0 && (
        <Section title={t('alternatives')}>
          <ul className="space-y-1">
            {d.alternatives.map((a) => (
              <li key={a.product_id} className="flex items-center gap-2 text-[12.5px]">
                <span className="font-mono text-[11.5px] text-muted w-28">{a.product_id}</span>
                <span className="flex-1 truncate">{a.description}</span>
                <span className="num text-muted">{fmtChf(a.net_cost_chf, 2)}</span>
                <button disabled={busy} onClick={() => onOverride({ product_id: a.product_id })} className="text-sel font-semibold">
                  {t('use')}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t('tenderText')}>
        <div className="text-[12.5px] text-muted space-y-0.5">
          {germanText.slice(0, 12).map((x, i) => (
            <div key={i} className={i === 0 ? 'text-ink font-medium' : ''}>
              {x}
            </div>
          ))}
          {source && (
            <div className="pt-1 text-ink num">
              {fmtNum(source.quantity)} {source.unit_raw}
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 pt-3 border-t border-hair">
      {title && <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">{title}</div>}
      {children}
    </div>
  )
}

function Inline(p: { label: string; value: string; onChange: (v: string) => void; onSave: () => void; suffix: string; busy: boolean; save: string }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        p.onSave()
      }}
      className="inline-flex items-center rounded-full border border-hair pl-3 pr-1 py-0.5 text-[12.5px] focus-within:border-sel"
    >
      <span className="text-muted mr-2">{p.label}</span>
      <input value={p.value} onChange={(e) => p.onChange(e.target.value)} inputMode="decimal" className="w-16 outline-none num bg-transparent" />
      <span className="text-muted mr-1">{p.suffix}</span>
      <button disabled={p.busy} className="rounded-full bg-ink text-white px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-50">
        {p.save}
      </button>
    </form>
  )
}
