import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { FLAG_LABEL, SECTION_NAMES, fmtNum, fmtUnit, sizeChips } from '../format'
import type { Anomaly, Line, Parsed } from '../types'
import { PdfPane, type Highlight } from './PdfPane'

type LotFilter = 'all' | '1' | '2'

export function Workspace({ tenderId, onBack }: { tenderId: string; onBack: () => void }) {
  const [data, setData] = useState<Parsed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lot, setLot] = useState<LotFilter>('all')
  const [scope, setScope] = useState<{ system?: string; section?: string }>({})
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [showFlags, setShowFlags] = useState(false)

  useEffect(() => {
    api.getTender(tenderId).then(setData).catch((e) => setError(e.message))
  }, [tenderId])

  const lines = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.lines.filter(
      (l) =>
        (lot === 'all' || l.lot === lot) &&
        (!scope.system || l.system === scope.system) &&
        (!scope.section || l.section === scope.section) &&
        (!q || l.description.toLowerCase().includes(q) || l.line_id.includes(q) || String(l.page) === q),
    )
  }, [data, lot, scope, query])

  const current = data?.lines.find((l) => l.line_id === selected) ?? null

  useEffect(() => {
    if (!selected && lines.length) select(lines[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length])

  function select(l: Line) {
    setSelected(l.line_id)
    setPage(l.page)
  }

  // Keyboard: ↑/↓ moves through the visible lines.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const i = lines.findIndex((l) => l.line_id === selected)
      const next = lines[Math.min(lines.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) select(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lines, selected])

  if (error) return <div className="p-10 text-bad">{error}</div>
  if (!data) return <div className="h-full grid place-items-center text-muted">Loading tender…</div>

  const highlights: Highlight[] = []
  if (current && current.page === page) highlights.push({ bbox: current.row_bbox, kind: 'row' })
  if (current?.header_bbox && current.header_page === page) highlights.push({ bbox: current.header_bbox, kind: 'header' })
  const pageSystem = Object.entries(data.systems).find(([, s]) => page >= s.first_page && page <= s.last_page)
  const flagged = data.anomalies.length
  const lots = { '1': 'Lot 1 · Schulhaus', '2': 'Lot 2 · Turnhalle' }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="h-16 shrink-0 flex items-center gap-4 px-5 bg-surface border-b border-hair">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-canvas" title="All tenders">
          <ArrowLeft className="size-5" />
        </button>
        <div className="size-7 rounded-[8px] bg-brand grid place-items-center font-bold text-brand-ink text-sm">b</div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold truncate">Schulhaus Oberglatt · BKP 244 Lüftung</div>
          <div className="text-xs text-muted truncate">{data.meta.filename}</div>
        </div>
        <div className="ml-auto flex items-center gap-6">
          <Ticker label="Lines" value={fmtNum(data.lines.length)} />
          <Ticker label="Systems" value={String(Object.keys(data.systems).length)} />
          <Ticker label="Pages" value={String(data.meta.pages)} />
          <button
            onClick={() => setShowFlags(true)}
            className="flex items-center gap-2 rounded-full bg-warn/12 px-3.5 py-1.5 text-[13px] font-semibold text-[#b86e00] hover:bg-warn/20"
          >
            <AlertTriangle className="size-4" /> {flagged} red flags
          </button>
          <div className="pl-6 border-l border-hair text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted">Indicative price</div>
            <div className="text-[22px] font-bold num tracking-tight text-faint">CHF —</div>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-3">
        <div className="inline-flex rounded-[10px] bg-[#e8e8ed] p-0.5">
          {(['all', '1', '2'] as LotFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setLot(v)}
              className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium transition ${
                lot === v ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {v === 'all' ? 'All lots' : lots[v]}
            </button>
          ))}
        </div>
        <div className="relative w-80">
          <Search className="size-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lines, e.g. Tellerventil, DN160, 78"
            className="w-full rounded-[10px] bg-surface border border-hair pl-9 pr-3 py-2 text-[13px] outline-none focus:border-sel"
          />
        </div>
        {(scope.system || scope.section) && (
          <button onClick={() => setScope({})} className="flex items-center gap-1 text-[13px] text-sel">
            <X className="size-3.5" /> {scope.system} {scope.section && `· ${scope.section}`}
          </button>
        )}
        <span className="ml-auto text-[13px] text-muted num">{fmtNum(lines.length)} lines shown · ↑↓ to move</span>
      </div>

      {/* Main */}
      <div className="flex-1 min-h-0 grid grid-cols-[230px_minmax(0,1fr)_minmax(0,44%)] gap-3 px-5 pb-5">
        <SystemTree data={data} lot={lot} scope={scope} onScope={setScope} />
        <div className="min-h-0 flex flex-col gap-3">
          <LinesTable lines={lines} selected={selected} onSelect={select} />
          {current && <LineDetail line={current} />}
        </div>
        <PdfPane
          url={api.pdfUrl(tenderId)}
          page={page}
          pageCount={data.meta.pages}
          pageSize={data.meta.page_sizes[String(page)]}
          highlights={highlights}
          caption={pageSystem ? `${pageSystem[0]} ${pageSystem[1].name}` : ''}
          onPage={setPage}
        />
      </div>

      {showFlags && (
        <FlagsPanel
          anomalies={data.anomalies}
          onClose={() => setShowFlags(false)}
          onGo={(p) => {
            setPage(p)
            setShowFlags(false)
          }}
        />
      )}
    </div>
  )
}

function Ticker({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-[17px] font-semibold num">{value}</div>
    </div>
  )
}

function SystemTree({ data, lot, scope, onScope }: { data: Parsed; lot: LotFilter; scope: { system?: string; section?: string }; onScope: (s: { system?: string; section?: string }) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return (
    <nav className="min-h-0 overflow-auto scroll-thin rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-2">
      <div className="px-2 pt-2 pb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Systems</div>
      {Object.entries(data.systems)
        .filter(([, s]) => lot === 'all' || s.lot === lot)
        .map(([code, s]) => {
          const lines = data.lines.filter((l) => l.system === code)
          const sections = [...new Set(lines.map((l) => l.section))].sort()
          const active = scope.system === code && !scope.section
          return (
            <div key={code} className="mb-0.5">
              <div className={`flex items-center rounded-lg ${active ? 'bg-sel/10' : 'hover:bg-canvas'}`}>
                <button className="p-1.5" onClick={() => setOpen({ ...open, [code]: !open[code] })}>
                  {open[code] ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}
                </button>
                <button className="flex-1 flex items-center py-1.5 pr-2 text-left" onClick={() => onScope({ system: code })}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium truncate">{s.name}</span>
                    <span className="block text-[11px] text-muted num">
                      {code} · Lot {s.lot} · p.{s.first_page}–{s.last_page}
                    </span>
                  </span>
                  <span className="text-[12px] text-muted num">{lines.length}</span>
                </button>
              </div>
              {open[code] &&
                sections.map((sec) => (
                  <button
                    key={sec}
                    onClick={() => onScope({ system: code, section: sec })}
                    className={`w-full flex items-center pl-8 pr-2 py-1 rounded-lg text-[12px] ${
                      scope.system === code && scope.section === sec ? 'bg-sel/10 text-ink' : 'text-muted hover:bg-canvas'
                    }`}
                  >
                    <span className="flex-1 text-left">
                      {sec} {SECTION_NAMES[sec] ?? ''}
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

function LinesTable({ lines, selected, onSelect }: { lines: Line[]; selected: string | null; onSelect: (l: Line) => void }) {
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})
  useEffect(() => {
    if (selected) rowRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div className="flex-1 min-h-0 overflow-auto scroll-thin rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-surface/95 backdrop-blur z-10">
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted border-b border-hair">
            <th className="font-semibold px-4 py-2.5 w-[118px]">Line</th>
            <th className="font-semibold px-2 py-2.5">Item</th>
            <th className="font-semibold px-2 py-2.5 text-right w-20">Qty</th>
            <th className="font-semibold px-2 py-2.5 w-14">Unit</th>
            <th className="font-semibold px-2 py-2.5 text-right w-14">Page</th>
            <th className="font-semibold px-4 py-2.5 w-28">Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const active = l.line_id === selected
            const title = l.header || l.local_text[0] || ''
            const sub = (l.header ? l.local_text : l.local_text.slice(1)).join(' · ') || l.size_key || ''
            return (
              <tr
                key={l.line_id}
                ref={(el) => {
                  rowRefs.current[l.line_id] = el
                }}
                onClick={() => onSelect(l)}
                className={`cursor-pointer border-b border-hair/70 ${active ? 'bg-sel/8 shadow-[inset_3px_0_0_var(--color-sel)]' : 'hover:bg-canvas/70'}`}
              >
                <td className="px-4 py-2 font-mono text-[11.5px] text-muted whitespace-nowrap">{l.line_id}</td>
                <td className="px-2 py-2 max-w-0">
                  <div className="font-medium truncate">{title || <span className="text-faint">(untitled)</span>}</div>
                  {sub && <div className="text-muted truncate text-[12px]">{sub}</div>}
                </td>
                <td className="px-2 py-2 text-right num font-medium">{l.quantity == null ? <span className="text-bad">—</span> : fmtNum(l.quantity)}</td>
                <td className="px-2 py-2 text-muted">{fmtUnit(l.unit, l.unit_raw)}</td>
                <td className="px-2 py-2 text-right num text-sel">{l.page}</td>
                <td className="px-4 py-2">
                  {l.flags.length ? (
                    <span className="inline-flex rounded-full bg-bad/10 text-bad px-2 py-0.5 text-[11px] font-semibold">Needs info</span>
                  ) : (
                    <span className="inline-flex rounded-full bg-canvas text-muted px-2 py-0.5 text-[11px] font-medium">Extracted</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {lines.length === 0 && <div className="p-10 text-center text-muted text-sm">No lines match these filters.</div>}
    </div>
  )
}

function LineDetail({ line }: { line: Line }) {
  const chips = sizeChips(line.sizes)
  return (
    <div className="shrink-0 rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] p-4 rise" key={line.line_id}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-muted">
            {line.system} {line.system_name} · {line.section} {SECTION_NAMES[line.section] ?? ''} · p.{line.page}
          </div>
          <div className="mt-1 text-[16px] font-semibold">{line.header || line.local_text[0] || '(untitled)'}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[22px] font-semibold num leading-none">{fmtNum(line.quantity)}</div>
          <div className="text-[12px] text-muted mt-1">{fmtUnit(line.unit, line.unit_raw)}</div>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-sel/10 text-sel px-2.5 py-0.5 text-[12px] font-semibold num">
              {c}
            </span>
          ))}
        </div>
      )}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px] max-h-28 overflow-auto scroll-thin">
        {line.shared_text.slice(0, 6).map((t, i) => (
          <dd key={`s${i}`} className="col-span-2 text-muted truncate">
            {t}
          </dd>
        ))}
        {line.local_text.map((t, i) => (
          <dd key={`l${i}`} className="col-span-2 font-medium truncate">
            {t}
          </dd>
        ))}
      </dl>
      <div className="mt-3 pt-3 border-t border-hair flex items-center justify-between text-[12px]">
        <span className="text-muted">Catalogue match and price arrive with the matching layer.</span>
        {line.flags.map((f) => (
          <span key={f} className="text-bad font-semibold">
            {FLAG_LABEL[f] ?? f}
          </span>
        ))}
      </div>
    </div>
  )
}

function FlagsPanel({ anomalies, onClose, onGo }: { anomalies: Anomaly[]; onClose: () => void; onGo: (page: number) => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px] flex justify-end" onClick={onClose}>
      <aside className="w-[440px] h-full bg-surface shadow-2xl flex flex-col rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center h-14 px-5 border-b border-hair">
          <h2 className="text-[15px] font-semibold">Red flags · {anomalies.length}</h2>
          <button className="ml-auto p-1.5 rounded-md hover:bg-canvas" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <p className="px-5 pt-4 text-[13px] text-muted">Inconsistencies found in the tender itself. Each one links to its page.</p>
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
