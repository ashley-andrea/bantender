import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { FLAG_LABEL, SECTION_NAMES, fmtChf, fmtNum, fmtUnit } from '../format'
import { LangToggle, STATUS_META, useI18n } from '../i18n'
import type { Anomaly, Line, Override, Parsed, PricedLine, Pricing } from '../types'
import { BuildUp } from './BuildUp'
import { LineDetail, StatusChip, lineTitle, statusKey } from './LineDetail'
import { PdfPane, type Highlight } from './PdfPane'

type LotFilter = 'all' | '1' | '2'
const STATUS_FILTERS = ['needs_price', 'review_required', 'supplier_quote_required', 'assumption_applied', 'calculated', 'excluded'] as const

export function Workspace({ tenderId, onBack }: { tenderId: string; onBack: () => void }) {
  const { t, lang } = useI18n()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'lines' | 'price'>('lines')
  const [lot, setLot] = useState<LotFilter>('all')
  const [scope, setScope] = useState<{ system?: string; section?: string }>({})
  const [status, setStatus] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [showFlags, setShowFlags] = useState(false)

  useEffect(() => {
    Promise.all([api.getTender(tenderId), api.getPricing(tenderId)])
      .then(([a, b]) => {
        setParsed(a)
        setPricing(b)
      })
      .catch((e) => setError(e.message))
  }, [tenderId])

  const sources = useMemo(() => new Map((parsed?.lines ?? []).map((l) => [l.line_id, l])), [parsed])

  const lines = useMemo(() => {
    if (!pricing) return []
    const q = query.trim().toLowerCase()
    return pricing.lines.filter((l) => {
      const k = statusKey(l)
      const st = status === 'excluded' ? ['out_of_scope', 'non_priceable'].includes(k) : !status || k === status
      const text = `${l.line_id} ${l.title_en} ${l.title_de} ${l.decision.product_id ?? ''} ${sources.get(l.line_id)?.description ?? ''}`.toLowerCase()
      return (lot === 'all' || l.lot === lot) && (!scope.system || l.system === scope.system) && (!scope.section || l.section === scope.section) && st && (!q || text.includes(q) || String(l.page) === q)
    })
  }, [pricing, lot, scope, status, query, sources])

  const current = pricing?.lines.find((l) => l.line_id === selected) ?? null

  useEffect(() => {
    if (!selected && lines.length) select(lines[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length])

  function select(l: PricedLine) {
    setSelected(l.line_id)
    setPage(l.page)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT' || tab !== 'lines') return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const i = lines.findIndex((l) => l.line_id === selected)
      const next = lines[Math.min(lines.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) select(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lines, selected, tab])

  async function mutate(p: Promise<Pricing>) {
    setBusy(true)
    try {
      setPricing(await p)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="p-10 text-bad">{error}</div>
  if (!parsed || !pricing) return <div className="h-full grid place-items-center text-muted">Loading tender…</div>

  const source: Line | undefined = current ? sources.get(current.line_id) : undefined
  const highlights: Highlight[] = []
  if (current?.source === 'cad') {
    current.evidence?.filter((e) => e.page === page).forEach((e) => highlights.push({ bbox: e.bbox, kind: 'row' }))
  } else if (source) {
    if (source.page === page) highlights.push({ bbox: source.row_bbox, kind: 'row' })
    if (source.header_bbox && source.header_page === page) highlights.push({ bbox: source.header_bbox, kind: 'header' })
  }
  const pageSystem = Object.entries(parsed.systems).find(([, s]) => page >= s.first_page && page <= s.last_page)
  const sum = pricing.summary
  const counts = (k: string) =>
    pricing.lines.filter((l) => (k === 'excluded' ? ['out_of_scope', 'non_priceable'].includes(statusKey(l)) : statusKey(l) === k)).length

  return (
    <div className="h-full flex flex-col">
      <header className="h-16 shrink-0 flex items-center gap-4 px-5 bg-surface border-b border-hair">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-canvas">
          <ArrowLeft className="size-5" />
        </button>
        <div className="size-7 rounded-[8px] bg-brand grid place-items-center font-bold text-brand-ink text-sm">b</div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold truncate">Schulhaus Oberglatt · BKP 244 {lang === 'en' ? 'Ventilation' : 'Lüftung'}</div>
          <div className="text-xs text-muted truncate">{parsed.meta.filename}</div>
        </div>
        <div className="ml-6 inline-flex rounded-[10px] bg-[#e8e8ed] p-0.5">
          {(['lines', 'price'] as const).map((v) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium ${tab === v ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink'}`}>
              {v === 'lines' ? t('tabLines') : t('tabPrice')}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-5">
          <Coverage pct={sum.coverage_pct} label={`${sum.priced_lines}/${sum.actionable_lines} ${t('priced').toLowerCase()}`} />
          <button onClick={() => { setTab('lines'); setStatus('needs_price') }} className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted">{t('needsPrice')}</div>
            <div className="text-[17px] font-semibold num text-bad">{sum.needs_price}</div>
          </button>
          <button onClick={() => setShowFlags(true)}
            className="flex items-center gap-2 rounded-full bg-warn/12 px-3.5 py-1.5 text-[13px] font-semibold text-[#b86e00] hover:bg-warn/20">
            <AlertTriangle className="size-4" /> {pricing.anomalies.length}
          </button>
          <LangToggle />
          <PriceTicker value={pricing.project.selling_price} label={t('indicativePrice')} />
        </div>
      </header>

      {tab === 'price' ? (
        <div className="flex-1 min-h-0 p-5">
          <BuildUp pricing={pricing} systems={parsed.systems} onSettings={(b) => mutate(api.settings(tenderId, b))} />
        </div>
      ) : (
        <>
          <div className="shrink-0 flex items-center gap-3 px-5 py-3 flex-wrap">
            <div className="inline-flex rounded-[10px] bg-[#e8e8ed] p-0.5">
              {(['all', '1', '2'] as LotFilter[]).map((v) => (
                <button key={v} onClick={() => setLot(v)}
                  className={`px-3 py-1.5 rounded-[8px] text-[13px] font-medium ${lot === v ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink'}`}>
                  {v === 'all' ? t('allLots') : v === '1' ? t('lot1') : t('lot2')}
                </button>
              ))}
            </div>
            <div className="relative w-72">
              <Search className="size-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')}
                className="w-full rounded-[10px] bg-surface border border-hair pl-9 pr-3 py-2 text-[13px] outline-none focus:border-sel" />
            </div>
            <div className="flex items-center gap-1.5">
              {STATUS_FILTERS.map((k) => {
                const meta = k === 'excluded' ? { en: 'Excluded', de: 'Ausgeschlossen', tone: STATUS_META.out_of_scope.tone } : STATUS_META[k]
                const active = status === k
                return (
                  <button key={k} onClick={() => setStatus(active ? null : k)}
                    className={`rounded-full px-2.5 py-1 text-[12px] font-semibold transition ${active ? meta.tone + ' ring-1 ring-current' : 'bg-surface border border-hair text-muted hover:text-ink'}`}>
                    {meta[lang]} <span className="num opacity-70">{counts(k)}</span>
                  </button>
                )
              })}
            </div>
            {(scope.system || scope.section) && (
              <button onClick={() => setScope({})} className="flex items-center gap-1 text-[13px] text-sel">
                <X className="size-3.5" /> {scope.system} {scope.section && `· ${scope.section}`}
              </button>
            )}
            <span className="ml-auto text-[12.5px] text-muted num">{fmtNum(lines.length)} {t('linesShown')}</span>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-[210px_minmax(0,1fr)_minmax(0,38%)] gap-3 px-5 pb-5">
            <SystemTree pricing={pricing} parsed={parsed} lot={lot} scope={scope} onScope={setScope} />
            <div className="min-h-0 grid grid-rows-[minmax(0,1fr)_minmax(0,1.1fr)] gap-3">
              <LinesTable lines={lines} selected={selected} onSelect={select} />
              {current ? (
                <LineDetail line={current} source={source} busy={busy}
                  onOverride={(b: Override) => mutate(api.override(tenderId, current.line_id, b))}
                  onReset={() => mutate(api.resetLine(tenderId, current.line_id))} />
              ) : <div />}
            </div>
            <PdfPane url={api.pdfUrl(tenderId)} page={page} pageCount={parsed.meta.pages} pageSize={parsed.meta.page_sizes[String(page)]}
              highlights={highlights} caption={pageSystem ? `${pageSystem[0]} ${pageSystem[1].name}` : ''} onPage={setPage} />
          </div>
        </>
      )}

      {showFlags && <FlagsPanel anomalies={pricing.anomalies} onClose={() => setShowFlags(false)} onGo={(p) => { setTab('lines'); setPage(p); setShowFlags(false) }} />}
    </div>
  )
}

function PriceTicker({ value, label }: { value: number; label: string }) {
  const prev = useRef(value)
  const [flash, setFlash] = useState<'' | 'up' | 'down'>('')
  useEffect(() => {
    if (value !== prev.current) {
      setFlash(value > prev.current ? 'up' : 'down')
      prev.current = value
      const id = setTimeout(() => setFlash(''), 600)
      return () => clearTimeout(id)
    }
  }, [value])
  return (
    <div className="pl-5 border-l border-hair text-right">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-[22px] font-bold num tracking-tight transition-colors duration-300 rounded px-1 -mx-1 ${
        flash === 'up' ? 'bg-good/20 text-[#078a57]' : flash === 'down' ? 'bg-bad/15 text-bad' : ''}`}>
        CHF {fmtChf(value)}
      </div>
    </div>
  )
}

function Coverage({ pct, label }: { pct: number; label: string }) {
  const r = 15, c = 2 * Math.PI * r
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 40 40" className="size-9 -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="#e5e5ea" strokeWidth="4" />
        <circle cx="20" cy="20" r={r} fill="none" stroke="#0ecb81" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
      <div>
        <div className="text-[15px] font-semibold num leading-tight">{Math.round(pct)} %</div>
        <div className="text-[11px] text-muted num">{label}</div>
      </div>
    </div>
  )
}

function SystemTree({ pricing, parsed, lot, scope, onScope }: { pricing: Pricing; parsed: Parsed; lot: LotFilter; scope: { system?: string; section?: string }; onScope: (s: { system?: string; section?: string }) => void }) {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return (
    <nav className="min-h-0 overflow-auto scroll-thin rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-2">
      <div className="px-2 pt-2 pb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('systems')}</div>
      {Object.entries(parsed.systems)
        .filter(([, s]) => lot === 'all' || s.lot === lot)
        .map(([code, s]) => {
          const lines = pricing.lines.filter((l) => l.system === code)
          const sections = [...new Set(lines.map((l) => l.section))].sort()
          const active = scope.system === code && !scope.section
          return (
            <div key={code} className="mb-0.5">
              <div className={`flex items-center rounded-lg ${active ? 'bg-sel/10' : 'hover:bg-canvas'}`}>
                <button className="p-1.5" onClick={() => setOpen({ ...open, [code]: !open[code] })}>
                  {open[code] ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}
                </button>
                <button className="flex-1 min-w-0 py-1.5 pr-2 text-left" onClick={() => onScope({ system: code })}>
                  <span className="block text-[13px] font-medium truncate">{s.name}</span>
                  <span className="block text-[11px] text-muted num">
                    {code} · CHF {fmtChf(pricing.summary.by_system[code] ?? 0)}
                  </span>
                </button>
              </div>
              {open[code] &&
                sections.map((sec) => (
                  <button key={sec} onClick={() => onScope({ system: code, section: sec })}
                    className={`w-full flex items-center pl-8 pr-2 py-1 rounded-lg text-[12px] ${scope.system === code && scope.section === sec ? 'bg-sel/10 text-ink' : 'text-muted hover:bg-canvas'}`}>
                    <span className="flex-1 text-left">
                      {sec} {lang === 'de' ? SECTION_NAMES[sec] : SECTION_EN[sec]}
                    </span>
                    <span className="num">{lines.filter((l) => l.section === sec).length}</span>
                  </button>
                ))}
            </div>
          )
        })}
    </nav>
  )
}

const SECTION_EN: Record<string, string> = { A: 'Equipment', B: 'Ductwork', C: 'Fittings', D: 'Controls', E: 'Installation', F: 'Insulation' }

function LinesTable({ lines, selected, onSelect }: { lines: PricedLine[]; selected: string | null; onSelect: (l: PricedLine) => void }) {
  const { t, lang } = useI18n()
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})
  useEffect(() => {
    if (selected) rowRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div className="min-h-0 overflow-auto scroll-thin rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-surface/95 backdrop-blur z-10">
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted border-b border-hair">
            <th className="font-semibold px-3 py-2.5 w-[104px]">{t('colLine')}</th>
            <th className="font-semibold px-2 py-2.5">{t('colItem')}</th>
            <th className="font-semibold px-2 py-2.5 text-right w-16">{t('colQty')}</th>
            <th className="font-semibold px-2 py-2.5 w-12">{t('colUnit')}</th>
            <th className="font-semibold px-2 py-2.5 text-right w-24">{t('colChf')}</th>
            <th className="font-semibold px-3 py-2.5 w-28">{t('colStatus')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const active = l.line_id === selected
            const sub = lang === 'en' ? (l.title_de !== l.title_en ? l.title_de : '') : l.decision.product_id ?? ''
            return (
              <tr key={l.line_id} ref={(el) => { rowRefs.current[l.line_id] = el }} onClick={() => onSelect(l)}
                className={`cursor-pointer border-b border-hair/70 ${active ? 'bg-sel/8 shadow-[inset_3px_0_0_var(--color-sel)]' : 'hover:bg-canvas/70'}`}>
                <td className="px-3 py-1.5 font-mono text-[11px] text-muted whitespace-nowrap">{l.line_id}</td>
                <td className="px-2 py-1.5 max-w-0">
                  <div className="font-medium truncate">
                    {lineTitle(l, lang)}
                    {l.decision.overridden.length > 0 && <span className="ml-1.5 text-[10px] font-semibold text-sel align-middle">● {t('edited')}</span>}
                  </div>
                  {sub && <div className="text-muted truncate text-[11.5px]">{sub}</div>}
                </td>
                <td className="px-2 py-1.5 text-right num font-medium">{l.decision.quantity == null ? <span className="text-bad">—</span> : fmtNum(l.decision.quantity)}</td>
                <td className="px-2 py-1.5 text-muted">{fmtUnit(l.decision.unit, l.decision.unit ?? '')}</td>
                <td className="px-2 py-1.5 text-right num font-semibold">{l.cost ? fmtChf(l.cost.direct_cost) : <span className="text-faint font-normal">—</span>}</td>
                <td className="px-3 py-1.5"><StatusChip line={l} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {lines.length === 0 && <div className="p-10 text-center text-muted text-sm">—</div>}
    </div>
  )
}

function FlagsPanel({ anomalies, onClose, onGo }: { anomalies: Anomaly[]; onClose: () => void; onGo: (page: number) => void }) {
  const { t } = useI18n()
  return (
    <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px] flex justify-end" onClick={onClose}>
      <aside className="w-[440px] h-full bg-surface shadow-2xl flex flex-col rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center h-14 px-5 border-b border-hair">
          <h2 className="text-[15px] font-semibold">{t('redFlags')} · {anomalies.length}</h2>
          <button className="ml-auto p-1.5 rounded-md hover:bg-canvas" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <p className="px-5 pt-4 text-[13px] text-muted">{t('flagsIntro')}</p>
        <div className="flex-1 overflow-auto scroll-thin p-3 space-y-2">
          {anomalies.map((a, i) => (
            <button key={i} onClick={() => onGo(a.page)} className="w-full text-left rounded-xl border border-hair p-3 hover:border-sel">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warn" />
                <span className="text-[13px] font-semibold">{FLAG_LABEL[a.code] ?? a.code}</span>
                <span className="ml-auto text-[12px] text-sel num">p.{a.page}</span>
              </div>
              <div className="mt-1 text-[12.5px] text-muted">{a.message}</div>
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}
