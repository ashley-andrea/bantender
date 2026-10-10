import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, Info, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { fmtChf, fmtNum, fmtPct, fmtUnit } from '../format'
import { FLAG_LABELS, LangToggle, SECTION_EN, STATUS_META, useI18n } from '../i18n'
import type { Anomaly, Line, Override, Parsed, PricedLine, Pricing } from '../types'
import { BuildUp } from './BuildUp'
import { LineDetail, StatusChip, lineTitle } from './LineDetail'
import { PdfPane, type Highlight } from './PdfPane'

// Status filters. 'excluded', 'provisional' and 'unpriced' group several statuses.
const STATUS_CHIPS = ['needs_price', 'insufficient_information', 'review_required', 'supplier_quote_required', 'assumption_applied', 'calculated', 'excluded'] as const
const GROUPS: Record<string, string[]> = {
  excluded: ['out_of_scope', 'non_priceable'],
  provisional: ['review_required', 'supplier_quote_required', 'assumption_applied'],
  unpriced: ['needs_price', 'insufficient_information'],
}
const matches = (key: string, filter: string) => (GROUPS[filter] ? GROUPS[filter].includes(key) : key === filter)

type Source = 'all' | 'lv' | 'cad'

export function Workspace({ tenderId, onBack }: { tenderId: string; onBack: () => void }) {
  const { t, lang } = useI18n()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'lines' | 'price'>('lines')
  const [lot, setLot] = useState<string>('all')
  const [source, setSource] = useState<Source>('all')
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

  // All filters except status: the status chips count within this set, so their numbers always match the list.
  const base = useMemo(() => {
    if (!pricing) return []
    const q = query.trim().toLowerCase()
    return pricing.lines.filter((l) => {
      const text = `${l.line_id} ${l.title_en} ${l.title_de} ${l.decision.product_id ?? ''} ${sources.get(l.line_id)?.description ?? ''}`.toLowerCase()
      return (
        (lot === 'all' || l.lot === lot) &&
        (source === 'all' || l.source === source) &&
        (!scope.system || l.system === scope.system) &&
        (!scope.section || l.section === scope.section) &&
        (!q || text.includes(q) || String(l.page) === q)
      )
    })
  }, [pricing, lot, source, scope, query, sources])
  const lines = useMemo(() => (status ? base.filter((l) => matches(l.status_key, status)) : base), [base, status])

  const current = pricing?.lines.find((l) => l.line_id === selected) ?? null

  // Keep the selection inside the visible list.
  useEffect(() => {
    if (lines.length && !lines.some((l) => l.line_id === selected)) select(lines[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines])

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

  if (error)
    return (
      <div className="p-10">
        <p className="text-bad">{error}</p>
        <button onClick={() => setError(null)} className="mt-3 text-sel text-sm">{t('close')}</button>
      </div>
    )
  if (!parsed || !pricing) return <div className="h-full grid place-items-center text-muted">{t('loading')}</div>

  const project = pricing.tender.project
  const lots = Object.entries(pricing.tender.lots).sort(([a], [b]) => Number(a) - Number(b))
  const lotLabel = (n: string) => `${t('lot')} ${n}${pricing.tender.lots[n]?.name ? ` · ${pricing.tender.lots[n].name}` : ''}`
  const lineSource: Line | undefined = current ? sources.get(current.line_id) : undefined
  const highlights: Highlight[] = []
  if (current?.source === 'cad') {
    current.evidence?.filter((e) => e.page === page).forEach((e) => highlights.push({ bbox: e.bbox, kind: 'row' }))
  } else if (lineSource) {
    if (lineSource.page === page) highlights.push({ bbox: lineSource.row_bbox, kind: 'row' })
    if (lineSource.header_bbox && lineSource.header_page === page) highlights.push({ bbox: lineSource.header_bbox, kind: 'header' })
  }
  const pageSystem = Object.entries(parsed.systems).find(([, s]) => page >= s.first_page && page <= s.last_page)
  const count = (f: string) => base.filter((l) => matches(l.status_key, f)).length
  const trade = lang === 'de' ? project.trade_de : project.trade_en

  return (
    <div className="h-full flex flex-col">
      <header className="h-16 shrink-0 flex items-center gap-4 px-5 bg-surface border-b border-hair">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-canvas">
          <ArrowLeft className="size-5" />
        </button>
        <div className="size-7 rounded-[8px] bg-brand grid place-items-center font-bold text-brand-ink text-sm">b</div>
        <div className="min-w-0 max-w-[340px]">
          <div className="text-[15px] font-semibold truncate">{project.name ?? parsed.meta.filename}</div>
          <div className="text-xs text-muted truncate">
            {project.bkp && `BKP ${project.bkp}${trade ? ` ${trade}` : ''} · `}
            {parsed.meta.filename}
          </div>
        </div>
        <div className="ml-4 inline-flex rounded-[10px] bg-[#e8e8ed] p-0.5">
          {(['lines', 'price'] as const).map((v) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium ${tab === v ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink'}`}>
              {v === 'lines' ? t('tabLines') : t('tabPrice')}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-4">
          <StatusBar pricing={pricing} onFilter={(f) => { setTab('lines'); setSource('lv'); setStatus(f) }} />
          <button onClick={() => setShowFlags(true)} title={t('redFlags')}
            className="flex items-center gap-1.5 rounded-full bg-warn/12 px-3 py-1.5 text-[13px] font-semibold text-[#b86e00] hover:bg-warn/20">
            <AlertTriangle className="size-4" /> {pricing.anomalies.length}
          </button>
          <LangToggle />
          <PriceTicker value={pricing.project.selling_price} margin={pricing.project.margin_pct} />
        </div>
      </header>

      {tab === 'price' ? (
        <div className="flex-1 min-h-0 p-5">
          <BuildUp pricing={pricing} onSettings={(b) => mutate(api.settings(tenderId, b))} />
        </div>
      ) : (
        <>
          <div className="shrink-0 flex items-center gap-3 px-5 py-3 flex-wrap">
            {lots.length > 1 && (
              <Segmented value={lot} onChange={setLot} options={[['all', t('allLots')], ...lots.map(([n]) => [n, lotLabel(n)] as [string, string])]} />
            )}
            {pricing.summary.cad.lines > 0 && (
              <Segmented value={source} onChange={(v) => setSource(v as Source)}
                options={[['all', t('allSources')], ['lv', t('tenderLines')], ['cad', t('cadLines')]]} />
            )}
            <div className="relative w-64">
              <Search className="size-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')}
                className="w-full rounded-[10px] bg-surface border border-hair pl-9 pr-3 py-2 text-[13px] outline-none focus:border-sel" />
            </div>
            {(scope.system || scope.section) && (
              <button onClick={() => setScope({})} className="flex items-center gap-1 text-[13px] text-sel">
                <X className="size-3.5" /> {scope.system} {scope.section && `· ${scope.section}`}
              </button>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-1.5 px-5 pb-3 flex-wrap">
            {STATUS_CHIPS.map((k) => {
              const meta = k === 'excluded' ? { en: 'Excluded', de: 'Ausgeschlossen', tone: STATUS_META.out_of_scope.tone } : STATUS_META[k]
              const n = count(k)
              const active = status === k
              return (
                <button key={k} disabled={!n && !active} onClick={() => setStatus(active ? null : k)}
                  className={`rounded-full px-2.5 py-1 text-[12px] font-semibold transition disabled:opacity-40 ${active ? meta.tone + ' ring-1 ring-current' : 'bg-surface border border-hair text-muted hover:text-ink'}`}>
                  {meta[lang]} <span className="num opacity-70">{n}</span>
                </button>
              )
            })}
            {status && GROUPS[status] && !(STATUS_CHIPS as readonly string[]).includes(status) && (
              <button onClick={() => setStatus(null)} className="rounded-full px-2.5 py-1 text-[12px] font-semibold bg-sel/10 text-sel ring-1 ring-current">
                <span className="capitalize">{status === 'unpriced' ? t('unpricedWord') : t('provisionalWord')}</span> <span className="num opacity-70">{count(status)}</span> <X className="inline size-3" />
              </button>
            )}
            <span className="ml-auto text-[12.5px] text-muted num">
              {fmtNum(lines.length)} / {fmtNum(base.length)} · ↑↓
            </span>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-[210px_minmax(0,1fr)_minmax(0,38%)] gap-3 px-5 pb-5">
            <SystemTree pricing={pricing} lot={lot} scope={scope} onScope={setScope} />
            <div className="min-h-0 grid grid-rows-[minmax(0,1fr)_minmax(0,1.1fr)] gap-3">
              <LinesTable lines={lines} selected={selected} onSelect={select} />
              {current && lines.some((l) => l.line_id === current.line_id) ? (
                <LineDetail line={current} source={lineSource} busy={busy}
                  onOverride={(b: Override) => mutate(api.override(tenderId, current.line_id, b))}
                  onReset={() => mutate(api.resetLine(tenderId, current.line_id))} />
              ) : (
                <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] grid place-items-center text-muted text-sm">{t('noLines')}</div>
              )}
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

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="inline-flex rounded-[10px] bg-[#e8e8ed] p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-3 py-1.5 rounded-[8px] text-[13px] font-medium whitespace-nowrap ${value === v ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

/** Tender lines to price, split into calculated / provisional / unpriced. Same definitions as the backend summary. */
function StatusBar({ pricing, onFilter }: { pricing: Pricing; onFilter: (f: string) => void }) {
  const { t } = useI18n()
  const s = pricing.summary.tender
  const parts = [
    { key: 'calculated', n: s.calculated, color: 'bg-good', label: t('calculatedWord') },
    { key: 'provisional', n: s.provisional, color: 'bg-warn', label: t('provisionalWord') },
    { key: 'unpriced', n: s.unpriced, color: 'bg-bad', label: t('unpricedWord') },
  ]
  return (
    <div className="w-[300px]">
      <div className="flex items-baseline gap-1.5 text-[12px] whitespace-nowrap">
        <span className="text-[15px] font-semibold num">{s.priced}</span>
        <span className="text-muted">{t('ofLines')} {s.to_price} {t('linesToPrice')}</span>
        <span className="ml-auto font-semibold num">{fmtPct(s.coverage_pct)}</span>
        <span className="relative group">
          <Info className="size-3.5 text-faint" />
          <span className="pointer-events-none absolute right-0 top-5 z-50 w-72 rounded-lg bg-ink text-white text-[11.5px] leading-snug p-3 opacity-0 group-hover:opacity-100 transition">
            {t('statusHelp')} ({s.excluded} {t('excludedWord')})
          </span>
        </span>
      </div>
      <div className="mt-1 flex h-2 rounded-full overflow-hidden bg-hair">
        {parts.map((p) => (
          <button key={p.key} title={`${p.n} ${p.label}`} onClick={() => onFilter(p.key)} className={`${p.color} h-full`} style={{ width: `${(p.n / Math.max(1, s.to_price)) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-muted num">
        {parts.map((p) => (
          <button key={p.key} onClick={() => onFilter(p.key)} className="hover:text-ink">
            <span className={`inline-block size-1.5 rounded-full mr-1 align-middle ${p.color}`} />
            {p.n} {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PriceTicker({ value, margin }: { value: number; margin: number }) {
  const { t } = useI18n()
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
    <div className="pl-4 border-l border-hair text-right">
      <div className="text-[11px] uppercase tracking-wide text-muted">
        {t('indicativePrice')} · {t('atMargin')} {fmtPct(margin)}
      </div>
      <div className={`text-[22px] font-bold num tracking-tight transition-colors duration-300 rounded px-1 -mx-1 ${
        flash === 'up' ? 'bg-good/20 text-[#078a57]' : flash === 'down' ? 'bg-bad/15 text-bad' : ''}`}>
        CHF {fmtChf(value)}
      </div>
    </div>
  )
}

function SystemTree({ pricing, lot, scope, onScope }: { pricing: Pricing; lot: string; scope: { system?: string; section?: string }; onScope: (s: { system?: string; section?: string }) => void }) {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return (
    <nav className="min-h-0 overflow-auto scroll-thin rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-2">
      <div className="px-2 pt-2 pb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('systems')}</div>
      {Object.entries(pricing.tender.systems)
        .filter(([, s]) => lot === 'all' || s.lot === lot)
        .map(([code, s]) => {
          const lines = pricing.lines.filter((l) => l.system === code)
          const sections = [...new Map(lines.map((l) => [l.section, l.section_name])).entries()].sort(([a], [b]) => a.localeCompare(b))
          const active = scope.system === code && !scope.section
          return (
            <div key={code} className="mb-0.5">
              <div className={`flex items-center rounded-lg ${active ? 'bg-sel/10' : 'hover:bg-canvas'}`}>
                <button className="p-1.5" onClick={() => setOpen({ ...open, [code]: !open[code] })}>
                  {open[code] ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}
                </button>
                <button className="flex-1 min-w-0 py-1.5 pr-2 text-left" onClick={() => onScope({ system: code })} title={t('bySystemNote')}>
                  <span className="block text-[13px] font-medium truncate">{s.name}</span>
                  <span className="block text-[11px] text-muted num">
                    {code} · CHF {fmtChf(pricing.summary.by_system[code] ?? 0)}
                  </span>
                </button>
              </div>
              {open[code] &&
                sections.map(([sec, name]) => (
                  <button key={sec} onClick={() => onScope({ system: code, section: sec })}
                    className={`w-full flex items-center pl-8 pr-2 py-1 rounded-lg text-[12px] ${scope.system === code && scope.section === sec ? 'bg-sel/10 text-ink' : 'text-muted hover:bg-canvas'}`}>
                    <span className="flex-1 text-left truncate">
                      {sec} {lang === 'de' ? name : SECTION_EN[name] ?? name}
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
            <th className="font-semibold px-2 py-2.5 text-right w-24" title={t('bySystemNote')}>{t('colChf')}</th>
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
      {lines.length === 0 && <div className="p-10 text-center text-muted text-sm">{t('noLines')}</div>}
    </div>
  )
}

function FlagsPanel({ anomalies, onClose, onGo }: { anomalies: Anomaly[]; onClose: () => void; onGo: (page: number) => void }) {
  const { t, lang } = useI18n()
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
                <span className="text-[13px] font-semibold">{FLAG_LABELS[a.code]?.[lang] ?? a.code}</span>
                <span className="ml-auto text-[12px] text-sel num">{t('pageWord')}{a.page}</span>
              </div>
              <div className="mt-1 text-[12.5px] text-muted">{lang === 'de' && a.message_de ? a.message_de : a.message}</div>
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}
