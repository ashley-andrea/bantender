import { useEffect, useState } from 'react'
import { fmtChf, fmtPct } from '../format'
import { awardNote, humanize, useI18n } from '../i18n'
import type { Award as AwardRule, Pricing } from '../types'

interface Props {
  pricing: Pricing
  onSettings: (body: Record<string, unknown>) => void
}

export function BuildUp({ pricing, onSettings }: Props) {
  const systems = pricing.tender.systems
  const { t, lang } = useI18n()
  const L = (en: string, de: string) => (lang === 'de' ? de : en)
  const p = pricing.project
  const s = pricing.settings
  const total = p.selling_price
  const margin = p.selling_price - p.baseline

  const steps: { label: string; value: number; kind: 'part' | 'total'; note?: string }[] = [
    { label: L('Catalogue material', 'Material (Katalog)'), value: p.material - p.supplier_material, kind: 'part', note: L('quantity × net cost × (1 + waste)', 'Menge × Nettopreis × (1 + Verschnitt)') },
    { label: L('Supplier packages (provisional)', 'Lieferantenpakete (provisorisch)'), value: p.supplier_material, kind: 'part', note: L('placeholder prices until quotes arrive', 'Richtpreise bis Offerten vorliegen') },
    { label: L('Installation labour', 'Montage'), value: p.labour, kind: 'part', note: L('hours × rate, with project factors', 'Stunden × Ansatz, mit Projektfaktoren') },
    { label: L('Transport / equipment', 'Transport / Inventar'), value: p.transport, kind: 'part' },
    { label: L('Small material', 'Kleinmaterial'), value: p.small_material, kind: 'part' },
    { label: L('Supplier contingency', 'Reserve Lieferanten'), value: p.supplier_contingency, kind: 'part' },
    { label: L('Engineering', 'Engineering'), value: p.engineering, kind: 'part' },
    { label: L('Commissioning', 'Inbetriebnahme'), value: p.commissioning, kind: 'part' },
    { label: L('Hygiene inspection', 'Hygieneprüfung'), value: p.hygiene, kind: 'part' },
    { label: L('Documentation', 'Dokumentation'), value: p.documentation, kind: 'part' },
    { label: L('Direct cost', 'Direkte Kosten'), value: p.direct, kind: 'total' },
    { label: L('Risk allowance', 'Risikozuschlag'), value: p.risk, kind: 'part' },
    { label: L('Overhead', 'Gemeinkosten'), value: p.overhead, kind: 'part', note: `${s.overhead_pct} %` },
    { label: L('Cost baseline', 'Selbstkosten'), value: p.baseline, kind: 'total' },
    { label: L('Margin', 'Marge'), value: margin, kind: 'part', note: L(`${fmtPct(p.margin_pct)} of price, rounded up to CHF ${fmtChf(s.round_to_chf)}`, `${fmtPct(p.margin_pct)} vom Preis, auf CHF ${fmtChf(s.round_to_chf)} aufgerundet`) },
  ]
  let running = 0

  return (
    <div className="h-full min-h-0 grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-3">
      <div className="min-h-0 overflow-auto scroll-thin rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5">
        <h2 className="text-[15px] font-semibold">{t('buildUp')}</h2>
        <p className="mt-1 text-[12.5px] text-muted">
          {L('Line costs', 'Positionskosten')} CHF {fmtChf(pricing.summary.value.total_chf)}:{' '}
          <span className="text-[#078a57] font-semibold">{fmtPct(pricing.summary.value.calculated_pct)} {L('calculated', 'berechnet')}</span>,{' '}
          <span className="text-[#b36b00] font-semibold">{fmtPct(100 - pricing.summary.value.calculated_pct)} {L('provisional (supplier quotes, assumptions, reviews)', 'provisorisch (Offerten, Annahmen, Prüfungen)')}</span>.
        </p>
        <div className="mt-4 space-y-1.5">
          {steps.map((st) => {
            const start = st.kind === 'total' ? 0 : running
            if (st.kind === 'part') running += st.value
            if (st.kind === 'part' && st.value === 0) return null
            return (
              <div key={st.label} className="grid grid-cols-[190px_1fr_110px] items-center gap-3 text-[13px]">
                <div className={st.kind === 'total' ? 'font-semibold' : ''}>
                  {st.label}
                  {st.note && <div className="text-[11px] text-muted leading-tight">{st.note}</div>}
                </div>
                <div className="relative h-5 bg-canvas rounded">
                  <div
                    className={`absolute top-0 h-5 rounded ${st.kind === 'total' ? 'bg-ink/80' : 'bg-[#c7c7cc]'}`}
                    style={{ left: `${(start / total) * 100}%`, width: `${Math.max(0.3, (st.value / total) * 100)}%` }}
                  />
                </div>
                <div className={`text-right num ${st.kind === 'total' ? 'font-semibold' : ''}`}>{fmtChf(st.value)}</div>
              </div>
            )
          })}
          <div className="grid grid-cols-[190px_1fr_110px] items-center gap-3 pt-2 border-t border-hair">
            <div className="text-[14px] font-bold">{t('indicativePrice')}</div>
            <div className="relative h-6 bg-canvas rounded">
              <div className="absolute inset-0 rounded bg-brand" />
            </div>
            <div className="text-right num text-[17px] font-bold">{fmtChf(total)}</div>
          </div>
        </div>

        <h3 className="mt-8 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('bySystem')}</h3>
        <p className="text-[11.5px] text-muted mt-0.5">{t('bySystemNote')}</p>
        <div className="mt-2 space-y-1.5">
          {Object.entries(pricing.summary.by_system).map(([code, chf]) => (
            <div key={code} className="grid grid-cols-[190px_1fr_110px] items-center gap-3 text-[13px]">
              <div className="truncate">
                {code} {systems[code]?.name} <span className="text-muted">· Lot {systems[code]?.lot}</span>
              </div>
              <div className="relative h-3 bg-canvas rounded">
                <div className="absolute h-3 rounded bg-sel/70" style={{ width: `${(chf / p.lines_direct) * 100}%` }} />
              </div>
              <div className="text-right num">{fmtChf(chf)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0 overflow-auto scroll-thin flex flex-col gap-3">
        <Parameters pricing={pricing} onSettings={onSettings} />
        <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5">
          <h2 className="text-[15px] font-semibold">{t('scenarios')}</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {pricing.scenarios.map((sc) => (
              <div key={sc.name} className={`rounded-xl p-3 ${sc.name === 'Target' ? 'bg-brand/15 ring-1 ring-brand' : 'bg-canvas'}`}>
                <div className="text-[12px] font-semibold">{sc.name}</div>
                <div className="mt-1 text-[18px] font-bold num">{fmtChf(sc.bid_price)}</div>
                <div className="mt-2 text-[11.5px] text-muted">{fmtPct(sc.margin_pct)} {L('margin', 'Marge')}</div>
                <div className="text-[11.5px]">
                  {t('winProb')} <span className="font-semibold num">{Math.round(sc.win_probability * 100)} %</span>
                </div>
                <div className="text-[11.5px]">
                  {t('contribution')} <span className="font-semibold num">{fmtChf(sc.expected_contribution)}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">{t('placeholderModel')}</p>
        </div>
        {pricing.award ? <Award rule={pricing.award} /> : (
          <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5 text-[13px] text-muted">{t('awardMissing')}</div>
        )}
      </div>
    </div>
  )
}

function Parameters({ pricing, onSettings }: { pricing: Pricing; onSettings: (b: Record<string, unknown>) => void }) {
  const { t } = useI18n()
  const s = pricing.settings
  const [margin, setMargin] = useState(s.margin_pct)
  const [eff, setEff] = useState(s.factors.site_efficiency)
  const [risk, setRisk] = useState(String(s.risk_allowance_chf))
  useEffect(() => {
    setMargin(s.margin_pct)
    setEff(s.factors.site_efficiency)
  }, [s.margin_pct, s.factors.site_efficiency])

  return (
    <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5">
      <h2 className="text-[15px] font-semibold">{t('parameters')}</h2>
      <Slider label={t('margin')} value={margin} min={0} max={12} step={0.5} fmt={(v) => fmtPct(v)} onChange={setMargin} onCommit={(v) => onSettings({ margin_pct: v })} />
      <Slider label={t('siteEfficiency')} value={eff} min={0.6} max={1.1} step={0.01} fmt={(v) => v.toFixed(2)} onChange={setEff}
        onCommit={(v) => onSettings({ factors: { site_efficiency: v } })} />
      <form className="mt-3 flex items-center gap-3 text-[13px]" onSubmit={(e) => { e.preventDefault(); onSettings({ risk_allowance_chf: Number(risk) || 0 }) }}>
        <span className="w-44">{t('risk')}</span>
        <input value={risk} onChange={(e) => setRisk(e.target.value)} onBlur={() => onSettings({ risk_allowance_chf: Number(risk) || 0 })}
          className="w-32 rounded-lg border border-hair px-2 py-1 num outline-none focus:border-sel" inputMode="decimal" />
      </form>
      <Toggle label={t('includeCad')} on={s.include_cad_ductwork} onChange={(v) => onSettings({ include_cad_ductwork: v })} />
      <Toggle label={t('includeProject')} on={s.include_project_costs} onChange={(v) => onSettings({ include_project_costs: v })} />
      {s.location_options.length > 1 && (
        <div className="mt-4">
          <div className="text-[13px] mb-1.5">{t('mountingHeight')}</div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-[12.5px] items-center">
            {Object.entries(pricing.tender.systems).map(([code, sys]) => {
              const loc = s.locations[code]
              return (
                <div key={code} className="contents">
                  <span className="truncate">{code} {sys.name}</span>
                  <select value={loc} onChange={(e) => onSettings({ locations: { ...s.locations, [code]: e.target.value } })}
                    className="rounded-md border border-hair bg-surface px-1.5 py-0.5">
                    {s.location_options.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
                  </select>
                  <span className="num text-muted w-10 text-right">×{s.factors[`mounting_height_${loc}`] ?? 1}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Slider(p: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  return (
    <label className="mt-3 flex items-center gap-3 text-[13px]">
      <span className="w-44">{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} className="flex-1 accent-[#f0b90b]"
        onChange={(e) => p.onChange(Number(e.target.value))}
        onMouseUp={(e) => p.onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => p.onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => p.onCommit(Number((e.target as HTMLInputElement).value))} />
      <span className="w-14 text-right num font-semibold">{p.fmt(p.value)}</span>
    </label>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="mt-3 flex items-center gap-3 text-[13px] w-full text-left">
      <span className={`relative w-9 h-5 rounded-full transition ${on ? 'bg-good' : 'bg-[#d1d1d6]'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}

function Award({ rule }: { rule: AwardRule }) {
  const { t, lang } = useI18n()
  // Linear scoring read from the tender: full weight at the lowest offer, 0 at zero_at_ratio × lowest.
  const span = rule.zero_at_ratio - 1
  const pts = (r: number) => rule.weight * Math.max(0, 1 - (r - 1) / span)
  const W = 460, H = 150, x = (r: number) => 30 + ((r - 1) / (span * 1.2)) * (W - 50), y = (v: number) => 26 + (1 - v / rule.weight) * (H - 56)
  const marks = rule.examples.map((e) => e.ratio)
  return (
    <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-5">
      <h2 className="text-[15px] font-semibold">{t('awardTitle')}</h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full max-w-[460px]">
        <line x1={24} y1={H - 22} x2={W - 8} y2={H - 22} stroke="#e5e5ea" />
        <polyline fill="none" stroke="#f0b90b" strokeWidth={2.5} points={[1, rule.zero_at_ratio, 1 + span * 1.2].map((r) => `${x(r)},${y(pts(r))}`).join(' ')} />
        {marks.map((r) => (
          <g key={r}>
            <circle cx={x(r)} cy={y(pts(r))} r={3.5} fill="#1d1d1f" />
            <text x={x(r)} y={y(pts(r)) - 8} fontSize={11} textAnchor="middle" fill="#1d1d1f">
              {fmtChf(Math.round(pts(r) * 10) / 10, Number.isInteger(Math.round(pts(r) * 10) / 10) ? 0 : 1)}
            </text>
            <text x={x(r)} y={H - 8} fontSize={10.5} textAnchor="middle" fill="#6e6e73">
              +{Math.round((r - 1) * 100)}%
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-1 text-[12px] text-muted">{awardNote(rule, lang)}</p>
    </div>
  )
}
