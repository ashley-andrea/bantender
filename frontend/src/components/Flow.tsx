import { ArrowRight, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type EditField } from '../api'
import { LEVEL_COLOR, fmtChf } from '../format'
import { LangToggle, tx, useI18n, type Key } from '../i18n'
import { STEPS, type Step } from '../route'
import type { Offer, Parsed, PricedLine, Pricing, ReferenceParameters } from '../types'
import { PdfPane, type Highlight } from './PdfPane'
import { PositionsList } from './PositionsList'
import { CataloguePanel } from './steps/Catalogue'
import { ExtractionIntro, ExtractionPanel } from './steps/Extraction'
import { ExportPanel, OfferOptions } from './steps/Offer'
import { LineStrip, ParameterPanel } from './steps/Pricing'

const STEP_LABEL: Record<Step, Key> = { extract: 'step1', catalog: 'step2', price: 'step3', offers: 'step4', export: 'step5' }

interface Props {
  tenderId: string
  step: Step
  live: boolean
  onStep: (s: Step) => void
  onHome: () => void
}

/** Upload time and round trip, kept per tab so the timer survives a reload. */
function sessionNumber(key: string): number | null {
  try {
    const v = sessionStorage.getItem(key)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function Flow({ tenderId, step, live, onStep, onHome }: Props) {
  const { t, lang } = useI18n()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [offer, setOffer] = useState<Offer | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [intro, setIntro] = useState(live)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [exportPage, setExportPage] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [defaults, setDefaults] = useState<ReferenceParameters | null>(null)

  useEffect(() => {
    api.reference().then((r) => setDefaults(r.parameters)).catch(() => setDefaults(null))
  }, [])

  useEffect(() => {
    Promise.all([api.getTender(tenderId), api.getPricing(tenderId), api.getOffer(tenderId)])
      .then(([p, pr, o]) => {
        setParsed(p)
        setPricing(pr)
        setOffer(o)
        if (pr.lines.length) setPage(pr.lines[0].page)
      })
      .catch((e) => setError((e as Error).message))
  }, [tenderId])

  // Every change goes through the server; the offer (and the filled PDF) follow.
  const apply = useCallback(
    async (req: Promise<Pricing>) => {
      setBusy(true)
      try {
        setPricing(await req)
        setOffer(await api.getOffer(tenderId))
        setVersion((v) => v + 1)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [tenderId],
  )

  const lines = useMemo(() => {
    if (!pricing) return []
    const q = query.trim().toLowerCase()
    if (!q) return pricing.lines
    return pricing.lines.filter((l) => [l.line_id, l.title_en, l.title_de, l.decision.product_id ?? ''].some((s) => s.toLowerCase().includes(q)))
  }, [pricing, query])

  // Until the estimator picks one, the first position is selected.
  const selectedId = chosenId ?? pricing?.lines[0]?.line_id ?? null
  const line = pricing?.lines.find((l) => l.line_id === selectedId) ?? null

  const select = useCallback((l: PricedLine) => {
    setChosenId(l.line_id)
    setActive(null)
    setPage(l.page)
  }, [])

  const edit = (field: EditField, v: number | null) => {
    if (!line) return
    if (v == null) apply(api.resetLine(tenderId, line.line_id, field))
    else apply(api.override(tenderId, line.line_id, field === 'unit_price' ? { unit_price: v, unit_price_source: 'quote' } : { [field]: v }))
  }

  // The hovered value may live on another page (e.g. a section heading): follow it.
  const activate = (key: string) => {
    setActive(key)
    const src = line?.attributes.find((x) => x.key === key)?.sources.find((s) => s.bbox)
    if (src && src.page !== page) setPage(src.page)
  }

  // ↑/↓ walk the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key) || ['INPUT', 'SELECT'].includes((e.target as HTMLElement).tagName) || step === 'offers' || step === 'export') return
      const i = lines.findIndex((l) => l.line_id === selectedId)
      const next = lines[Math.max(0, Math.min(lines.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) {
        e.preventDefault()
        select(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lines, selectedId, select, step])

  // One box per printed row, coloured by how its value was obtained; the active value is labelled.
  const highlights: Highlight[] = useMemo(() => {
    if (!line) return []
    const boxes = new Map<string, Highlight>()
    for (const a of line.attributes) {
      for (const s of a.sources) {
        if (!s.bbox || s.page !== page) continue
        const k = s.bbox.join(',')
        const strong = a.key === active
        const prev = boxes.get(k)
        if (prev && !strong) continue
        boxes.set(k, { bbox: s.bbox, color: LEVEL_COLOR[a.level], strong, label: strong ? tx(a.label, lang) : undefined })
      }
    }
    return [...boxes.values()]
  }, [line, page, active, lang])

  if (error) return <Centered><p className="text-bad">{error}</p><button className="mt-4 text-green" onClick={onHome}>← {t('back')}</button></Centered>
  if (!parsed || !pricing) return <Centered><Loader2 className="size-6 animate-spin text-muted" /></Centered>

  const stepIndex = STEPS.indexOf(step)
  const supplierLines = pricing.lines.filter((l) => l.status_key === 'supplier_quote_required')
  const roundTrip = sessionNumber(`roundTrip:${tenderId}`)
  const seconds = roundTrip != null ? roundTrip / 1000 : parsed.meta.parse_seconds ?? null

  const pdf = (
    <PdfPane url={api.pdfUrl(tenderId)} page={page} pageCount={parsed.meta.pages} pageSize={parsed.meta.page_sizes[String(page)]}
      highlights={highlights} caption={parsed.meta.filename ?? ''} onPage={setPage} />
  )
  const list = (stage: 'extract' | 'catalog' | 'price', extra?: React.ReactNode) => (
    <PositionsList lines={lines} systems={parsed.systems} stage={stage} offer={offer} selected={selectedId} onSelect={select}
      query={query} onQuery={setQuery} extra={extra} />
  )
  const nextQuote = supplierLines.length > 0 && (
    <button className="mt-2 w-full flex items-center gap-2 px-1 text-left text-[12px] text-muted hover:text-ink"
      onClick={() => {
        const i = supplierLines.findIndex((l) => l.line_id === selectedId)
        select(supplierLines[(i + 1) % supplierLines.length])
      }}>
      <span className="size-1.5 rounded-full bg-warn" /> {supplierLines.length} {t('awaitQuote')} →
    </button>
  )
  const grid = 'h-full grid grid-cols-[minmax(0,1fr)_290px_minmax(0,1.05fr)] gap-3'

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title={parsed.project.name ?? parsed.meta.filename ?? tenderId}
        step={step}
        onStep={(s) => { setIntro(false); onStep(s) }}
        price={pricing.project.selling_price}
        busy={busy}
        onHome={onHome}
        startedAt={sessionNumber(`uploadAt:${tenderId}`)}
        onNext={stepIndex < STEPS.length - 1 ? () => { setIntro(false); onStep(STEPS[stepIndex + 1]) } : undefined}
      />

      <main className="flex-1 min-h-0 p-3">
        {step === 'extract' && intro && (
          <div className="h-full grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            {pdf}
            <ExtractionIntro parsed={parsed} lines={pricing.lines} seconds={seconds} onPage={setPage} onDone={() => setIntro(false)} />
          </div>
        )}
        {step === 'extract' && !intro && line && (
          <div className={grid}>
            {pdf}
            {list('extract')}
            <ExtractionPanel line={line} systems={parsed.systems} active={active} onActive={activate} onEdit={edit} busy={busy} />
          </div>
        )}
        {step === 'catalog' && line && (
          <div className={grid}>
            {pdf}
            {list('catalog', nextQuote)}
            <CataloguePanel line={line} systems={parsed.systems} active={active} onActive={activate} busy={busy} onQuote={(v) => edit('unit_price', v)} />
          </div>
        )}
        {step === 'price' && line && (
          <div className="h-full grid grid-cols-[minmax(0,1fr)_290px_minmax(0,1.05fr)] gap-3">
            {pdf}
            {list('price')}
            <div className="min-h-0 flex flex-col gap-3">
              <LineStrip line={line} systems={parsed.systems} offer={offer} onEdit={edit} busy={busy} />
              <div className="flex-1 min-h-0">
                <ParameterPanel pricing={pricing} systems={parsed.systems} defaults={defaults} busy={busy} onChange={(patch) => apply(api.settings(tenderId, patch))} />
              </div>
            </div>
          </div>
        )}
        {step === 'offers' && <OfferOptions pricing={pricing} />}
        {step === 'export' && offer && (
          <div className="h-full grid grid-cols-[minmax(0,1fr)_380px] gap-3">
            <PdfPane url={api.offerPdfUrl(tenderId, false, version)} page={exportPage ?? offer.conditions.page ?? 2} pageCount={parsed.meta.pages}
              pageSize={parsed.meta.page_sizes[String(exportPage ?? offer.conditions.page ?? 2)]}
              highlights={offer.fields.filter((f) => f.page === (exportPage ?? offer.conditions.page ?? 2)).map((f) => ({ bbox: f.bbox, color: '#008163' }))}
              caption={parsed.meta.filename ?? ''} onPage={setExportPage} />
            <ExportPanel offer={offer} parsed={parsed} page={exportPage ?? offer.conditions.page ?? 2} url={api.offerPdfUrl(tenderId, true, version)}
              onJump={setExportPage} onConditions={(patch) => apply(api.settings(tenderId, patch))} busy={busy} />
          </div>
        )}
      </main>

    </div>
  )
}

function TopBar({ title, step, onStep, price, busy, onHome, startedAt, onNext }: {
  title: string; step: Step; onStep: (s: Step) => void; price: number; busy: boolean; onHome: () => void; startedAt: number | null
  onNext?: () => void
}) {
  const { t } = useI18n()
  const prev = useRef(price)
  const [delta, setDelta] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (price !== prev.current) {
      setDelta(price - prev.current)
      prev.current = price
      const id = setTimeout(() => setDelta(0), 2400)
      return () => clearTimeout(id)
    }
  }, [price])
  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null
  const current = STEPS.indexOf(step)

  return (
    <header className="h-14 shrink-0 bg-navy text-white px-4 flex items-center gap-5">
      <button onClick={onHome} className="shrink-0" title={t('recent')}>
        <img src="/equans-logo-white.png" alt="Equans" className="h-6" />
      </button>
      <div className="text-[13px] text-white/75 truncate max-w-56">{title}</div>
      <nav className="flex-1 flex justify-center">
        <ol className="flex items-center">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button onClick={() => onStep(s)}
                className={`relative px-3 h-14 text-[13px] font-medium ${s === step ? 'text-white' : i < current ? 'text-white/80 hover:text-white' : 'text-white/50 hover:text-white/80'}`}>
                <span className="num mr-1.5 text-white/50">{i + 1}</span>{t(STEP_LABEL[s])}
                {s === step && <span className="absolute left-3 right-3 bottom-0 h-[3px] bg-mint" />}
              </button>
            </li>
          ))}
        </ol>
        {onNext && (
          <button onClick={onNext} className="ml-3 self-center inline-flex items-center gap-1 rounded-md bg-green px-3 py-1.5 text-[12.5px] font-semibold hover:brightness-110">
            {t('next')} <ArrowRight className="size-3.5" />
          </button>
        )}
      </nav>
      {elapsed != null && (
        <div className="text-[12px] text-white/60 num" title={t('sinceUpload')}>
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} {t('sinceUpload')}
        </div>
      )}
      <div className="flex items-baseline gap-2">
        {busy && <Loader2 className="size-3.5 animate-spin text-white/60 self-center" />}
        {delta !== 0 && <span className={`rise text-[12px] font-semibold num ${delta > 0 ? 'text-mint' : 'text-[#ff8a80]'}`}>{delta > 0 ? '+' : '−'}{fmtChf(Math.abs(delta))}</span>}
        <span className="text-[11px] text-white/60">CHF</span>
        <span className="text-[17px] font-semibold num">{fmtChf(price)}</span>
      </div>
      <LangToggle dark />
    </header>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full grid place-items-center"><div className="text-center">{children}</div></div>
}
