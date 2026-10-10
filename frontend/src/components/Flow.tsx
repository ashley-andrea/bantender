import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, prefetched, type EditField } from '../api'
import { LEVEL_COLOR, fmtChf } from '../format'
import { LangToggle, tx, useI18n, type Key } from '../i18n'
import { STEPS, type Step } from '../route'
import type { Offer, Parsed, PricedLine, Pricing, ReferenceParameters } from '../types'
import { PdfPane, type Highlight } from './PdfPane'
import { PositionsList } from './PositionsList'
import { UploadView } from './Upload'
import { CataloguePanel } from './steps/Catalogue'
import { ExtractionPanel } from './steps/Extraction'
import { ExportPanel, OfferOptions } from './steps/Offer'
import { OfferBar, ParameterPanel, PriceDetail } from './steps/Pricing'

const STEP_LABEL: Record<Step, Key> = { extract: 'step1', catalog: 'step2', price: 'step3', offers: 'step4', export: 'step5' }

interface Props {
  tenderId: string | null
  step: Step
  onStep: (s: Step) => void
  onOpen: (id: string) => void
  onHome: () => void
}

export function Flow({ tenderId, step, onStep, onOpen, onHome }: Props) {
  const { t, lang } = useI18n()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [offer, setOffer] = useState<Offer | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [exportPage, setExportPage] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [defaults, setDefaults] = useState<ReferenceParameters | null>(null)

  useEffect(() => {
    api.reference().then((r) => setDefaults(r.parameters)).catch(() => setDefaults(null))
  }, [])

  // Tender data: handed over by the upload when there is one, else fetched. The offer (form numbers) follows.
  useEffect(() => {
    setParsed(null)
    setPricing(null)
    setOffer(null)
    setChosenId(null)
    setError(null)
    if (!tenderId) return
    const show = (p: Parsed, pr: Pricing) => {
      setParsed(p)
      setPricing(pr)
      if (pr.lines.length) setPage(pr.lines[0].page)
    }
    const cached = prefetched.get(tenderId)
    if (cached) {
      prefetched.delete(tenderId)
      show(cached.parsed, cached.pricing)
    } else {
      Promise.all([api.getTender(tenderId), api.getPricing(tenderId)])
        .then(([p, pr]) => show(p, pr))
        .catch((e) => setError((e as Error).message))
    }
    api.getOffer(tenderId).then(setOffer).catch((e) => setError((e as Error).message))
  }, [tenderId])

  // Every change goes through the server; the offer (and the filled PDF) follow.
  const apply = useCallback(
    async (req: Promise<Pricing>) => {
      if (!tenderId) return
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
    if (!line || !tenderId) return
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
        if (boxes.has(k) && !strong) continue
        boxes.set(k, { bbox: s.bbox, color: LEVEL_COLOR[a.level], strong, label: strong ? tx(a.label, lang) : undefined })
      }
    }
    return [...boxes.values()]
  }, [line, page, active, lang])

  const ready = Boolean(tenderId && parsed && pricing)
  const top = (
    <TopBar
      title={parsed?.project.name ?? parsed?.meta.filename ?? ''}
      step={step}
      enabled={ready}
      onStep={onStep}
      price={step === 'price' ? null : pricing?.project.selling_price ?? null}
      busy={busy}
      onHome={onHome}
    />
  )

  if (!tenderId) {
    return (
      <div className="h-full flex flex-col">
        {top}
        <main className="flex-1 min-h-0 p-3"><UploadView onOpen={onOpen} /></main>
      </div>
    )
  }
  if (error) return <div className="h-full flex flex-col">{top}<Centered><p className="text-bad">{error}</p><button className="mt-4 text-green" onClick={onHome}>← {t('back')}</button></Centered></div>
  if (!parsed || !pricing) return <div className="h-full flex flex-col">{top}<Centered><Loader2 className="size-6 animate-spin text-muted" /></Centered></div>

  const supplierLines = pricing.lines.filter((l) => l.status_key === 'supplier_quote_required')
  const nextQuote = step === 'catalog' && supplierLines.length > 0 && (
    <button className="mt-2 w-full flex items-center gap-2 px-1 text-left text-[12px] text-muted hover:text-ink"
      onClick={() => {
        const i = supplierLines.findIndex((l) => l.line_id === selectedId)
        select(supplierLines[(i + 1) % supplierLines.length])
      }}>
      <span className="size-1.5 rounded-full bg-warn" /> {supplierLines.length} {t('awaitQuote')} →
    </button>
  )
  const exportAt = exportPage ?? offer?.conditions.page ?? 2

  return (
    <div className="h-full flex flex-col">
      {top}
      <main className="flex-1 min-h-0 p-3">
        {/* Extraction and catalogue share one layout, so the PDF and its highlights stay put when switching. */}
        {(step === 'extract' || step === 'catalog') && line && (
          <div className="h-full grid grid-cols-[minmax(0,1fr)_290px_minmax(0,1.05fr)] gap-3">
            <PdfPane url={api.pdfUrl(tenderId)} page={page} pageCount={parsed.meta.pages} pageSize={parsed.meta.page_sizes[String(page)]}
              highlights={highlights} caption={parsed.meta.filename ?? ''} onPage={setPage} />
            <PositionsList lines={lines} systems={parsed.systems} stage={step} offer={offer} selected={selectedId} onSelect={select}
              query={query} onQuery={setQuery} extra={nextQuote} />
            {step === 'extract' ? (
              <ExtractionPanel line={line} systems={parsed.systems} active={active} onActive={activate} onEdit={edit} busy={busy} />
            ) : (
              <CataloguePanel line={line} systems={parsed.systems} active={active} onActive={activate} busy={busy} onQuote={(v) => edit('unit_price', v)} />
            )}
          </div>
        )}
        {step === 'price' && line && (
          <div className="h-full flex flex-col gap-3">
            <div className="flex-1 min-h-0 grid grid-cols-[360px_minmax(0,1fr)_330px] gap-3">
              <PositionsList lines={lines} systems={parsed.systems} stage="price" offer={offer} selected={selectedId} onSelect={select}
                query={query} onQuery={setQuery} />
              <PriceDetail line={line} systems={parsed.systems} offer={offer} settings={pricing.settings} onEdit={edit} busy={busy} />
              <ParameterPanel settings={pricing.settings} systems={parsed.systems} defaults={defaults} busy={busy}
                onChange={(patch) => apply(api.settings(tenderId, patch))} />
            </div>
            <OfferBar pricing={pricing} busy={busy} />
          </div>
        )}
        {step === 'offers' && <OfferOptions pricing={pricing} />}
        {step === 'export' && (offer ? (
          <div className="h-full grid grid-cols-[minmax(0,1fr)_380px] gap-3">
            <PdfPane url={api.offerPdfUrl(tenderId, false, version)} page={exportAt} pageCount={parsed.meta.pages} pageSize={parsed.meta.page_sizes[String(exportAt)]}
              highlights={offer.fields.filter((f) => f.page === exportAt).map((f) => ({ bbox: f.bbox, color: '#008163' }))}
              caption={parsed.meta.filename ?? ''} onPage={setExportPage} />
            <ExportPanel offer={offer} parsed={parsed} page={exportAt} url={api.offerPdfUrl(tenderId, true, version)}
              onJump={setExportPage} onConditions={(patch) => apply(api.settings(tenderId, patch))} busy={busy} />
          </div>
        ) : <Centered><Loader2 className="size-6 animate-spin text-muted" /></Centered>)}
      </main>
    </div>
  )
}

function TopBar({ title, step, enabled, onStep, price, busy, onHome }: {
  title: string; step: Step; enabled: boolean; onStep: (s: Step) => void; price: number | null; busy: boolean; onHome: () => void
}) {
  const { t } = useI18n()
  const prev = useRef(price)
  const [delta, setDelta] = useState(0)
  useEffect(() => {
    if (price != null && prev.current != null && price !== prev.current) {
      setDelta(price - prev.current)
      const id = setTimeout(() => setDelta(0), 2400)
      prev.current = price
      return () => clearTimeout(id)
    }
    prev.current = price
  }, [price])
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
              <button onClick={() => onStep(s)} disabled={!enabled && s !== 'extract'}
                className={`relative px-3 h-14 text-[13px] font-medium disabled:cursor-default disabled:text-white/30 ${s === step ? 'text-white' : i < current ? 'text-white/80 hover:text-white' : 'text-white/55 hover:text-white/85'}`}>
                <span className="num mr-1.5 text-white/50">{i + 1}</span>{t(STEP_LABEL[s])}
                {s === step && <span className="absolute left-3 right-3 bottom-0 h-[3px] bg-mint" />}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {price != null && (
        <div className="flex items-baseline gap-2">
          {busy && <Loader2 className="size-3.5 animate-spin text-white/60 self-center" />}
          {delta !== 0 && <span className={`rise text-[12px] font-semibold num ${delta > 0 ? 'text-mint' : 'text-[#ff8a80]'}`}>{delta > 0 ? '+' : '−'}{fmtChf(Math.abs(delta))}</span>}
          <span className="text-[11px] text-white/60">CHF</span>
          <span className="text-[17px] font-semibold num">{fmtChf(price)}</span>
        </div>
      )}
      <LangToggle dark />
    </header>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 h-full grid place-items-center"><div className="text-center">{children}</div></div>
}
