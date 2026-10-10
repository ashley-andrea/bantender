import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type EditField } from '../api'
import { certaintyColor, fmtChf, fmtNum } from '../format'
import { LangToggle, useI18n, type Key } from '../i18n'
import { STEPS, type Step } from '../route'
import type { Offer, Parsed, PricedLine, Pricing, ReferenceParameters } from '../types'
import { PdfPane, type Highlight } from './PdfPane'
import { PositionsList } from './PositionsList'
import { CataloguePanel } from './steps/Catalogue'
import { ExtractionIntro, ExtractionPanel } from './steps/Extraction'
import { ExportPanel, OfferOptions } from './steps/Offer'
import { BuildUp, FormulaCard, ParameterPanel } from './steps/Pricing'

const STEP_LABEL: Record<Step, Key> = { extract: 'step1', catalog: 'step2', price: 'step3', offers: 'step4', export: 'step5' }
const STEP_HINT: Record<Step, Key> = { extract: 'step1Hint', catalog: 'step2Hint', price: 'step3Hint', offers: 'step4Hint', export: 'step5Hint' }

interface Props {
  tenderId: string
  step: Step
  live: boolean
  onStep: (s: Step) => void
  onHome: () => void
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
    return pricing.lines.filter((l) =>
      [l.line_id, l.title_en, l.title_de, l.decision.product_id ?? '', l.section_name].some((s) => s.toLowerCase().includes(q)),
    )
  }, [pricing, query])

  // Until the estimator picks one, the first position is selected.
  const selectedId = chosenId ?? pricing?.lines[0]?.line_id ?? null
  const line = pricing?.lines.find((l) => l.line_id === selectedId) ?? null

  const edit = (field: EditField, v: number | null) => {
    if (!line) return
    if (v == null) apply(api.resetLine(tenderId, line.line_id, field))
    else apply(api.override(tenderId, line.line_id, field === 'unit_price' ? { unit_price: v, unit_price_source: 'quote' } : { [field]: v }))
  }

  const select = useCallback((l: PricedLine) => {
    setChosenId(l.line_id)
    setActive(null)
    setPage(l.page)
  }, [])

  // ↑/↓ walk the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key) || (e.target as HTMLElement).tagName === 'INPUT' || step === 'offers' || step === 'export') return
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

  // The hovered attribute may live on another page (e.g. "wie vorbeschrieben"): follow it.
  const activate = (key: string | null) => {
    setActive(key)
    const src = line?.attributes.find((x) => x.key === key)?.sources.find((s) => s.bbox)
    if (src && src.page !== page) setPage(src.page)
  }

  const highlights: Highlight[] = useMemo(() => {
    if (!line) return []
    const out: Highlight[] = []
    const seen = new Set<string>()
    for (const a of line.attributes) {
      for (const s of a.sources) {
        if (!s.bbox || s.page !== page) continue
        const k = s.bbox.join(',')
        const strong = a.key === active
        if (seen.has(k) && !strong) continue
        seen.add(k)
        const color = step === 'catalog' && !strong ? '#0a84ff' : certaintyColor(a.certainty)
        out.push({ bbox: s.bbox, color, strong, label: strong ? `${typeof a.label === 'string' ? a.label : a.label[lang]}` : undefined })
      }
    }
    if (!out.length && line.evidence) {
      for (const e of line.evidence) if (e.page === page) out.push({ bbox: e.bbox, color: '#0a84ff' })
    }
    return out
  }, [line, page, active, step, lang])

  if (error) return <Centered><p className="text-bad">{error}</p><button className="mt-4 text-sel" onClick={onHome}>← {t('back')}</button></Centered>
  if (!parsed || !pricing) return <Centered><Loader2 className="size-6 animate-spin text-muted" /></Centered>

  const pageSize = (p: number) => parsed.meta.page_sizes[String(p)]
  const stepIndex = STEPS.indexOf(step)
  const supplierLines = pricing.lines.filter((l) => l.status_key === 'supplier_quote_required')

  const pdf = (
    <PdfPane url={api.pdfUrl(tenderId)} page={page} pageCount={parsed.meta.pages} pageSize={pageSize(page)} highlights={highlights}
      caption={line && line.page === page ? line.line_id : ''} onPage={setPage} />
  )
  const list = (stage: 'extract' | 'catalog' | 'price') => (
    <PositionsList lines={lines} systems={parsed.systems} stage={stage} offer={offer} selected={selectedId} onSelect={select} query={query} onQuery={setQuery} />
  )

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title={parsed.project.name ?? parsed.meta.filename ?? tenderId}
        subtitle={parsed.project.bkp ? `BKP ${parsed.project.bkp} · ${lang === 'de' ? parsed.project.trade_de : parsed.project.trade_en}` : ''}
        step={step}
        onStep={(s) => { setIntro(false); onStep(s) }}
        price={pricing.project.selling_price}
        busy={busy}
        onHome={onHome}
      />

      <div className="px-5 pt-3 pb-2 flex items-center gap-4 shrink-0">
        <div>
          <div className="text-[19px] font-semibold tracking-tight">{t(STEP_LABEL[step])}</div>
          <div className="text-[13px] text-muted">{t(STEP_HINT[step])}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StepStats step={step} pricing={pricing} offer={offer} supplierCount={supplierLines.length}
            onNextQuote={() => {
              const i = supplierLines.findIndex((l) => l.line_id === selectedId)
              const n = supplierLines[(i + 1) % supplierLines.length]
              if (n) select(n)
            }} />
          {stepIndex > 0 && (
            <button onClick={() => onStep(STEPS[stepIndex - 1])} className="inline-flex items-center gap-1 rounded-full px-3.5 py-2 text-[13px] font-semibold text-muted hover:bg-surface">
              <ArrowLeft className="size-4" /> {t('back')}
            </button>
          )}
          {stepIndex < STEPS.length - 1 && (
            <button onClick={() => { setIntro(false); onStep(STEPS[stepIndex + 1]) }}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink text-white px-4 py-2 text-[13px] font-semibold hover:bg-black">
              {t(STEP_LABEL[STEPS[stepIndex + 1]])} <ArrowRight className="size-4" />
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 min-h-0 px-5 pb-5">
        {step === 'extract' && intro && (
          <div className="h-full grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
            <ExtractionIntro parsed={parsed} lines={pricing.lines} onPage={setPage} onDone={() => setIntro(false)} />
            {pdf}
          </div>
        )}
        {step === 'extract' && !intro && line && (
          <div className="h-full grid grid-cols-[320px_minmax(0,1fr)_minmax(0,0.9fr)] gap-4">
            {list('extract')}
            <ExtractionPanel line={line} active={active} onActive={activate} onEdit={edit} busy={busy} />
            {pdf}
          </div>
        )}
        {step === 'catalog' && line && (
          <div className="h-full grid grid-cols-[320px_minmax(0,1fr)_minmax(0,0.9fr)] gap-4">
            {list('catalog')}
            <CataloguePanel line={line} active={active} onActive={activate} busy={busy}
              onQuote={(v) => edit('unit_price', v)} />
            {pdf}
          </div>
        )}
        {step === 'price' && line && (
          <div className="h-full grid grid-cols-[320px_minmax(0,1fr)_340px] gap-4">
            {list('price')}
            <div className="min-h-0 overflow-auto scroll-thin space-y-4">
              <FormulaCard line={line} offer={offer} onEdit={edit} busy={busy} />
              <BuildUp pricing={pricing} />
            </div>
            <div className="min-h-0 overflow-auto scroll-thin">
              <ParameterPanel settings={pricing.settings} defaults={defaults} busy={busy} onChange={(patch) => apply(api.settings(tenderId, patch))} />
            </div>
          </div>
        )}
        {step === 'offers' && <OfferOptions pricing={pricing} />}
        {step === 'export' && offer && (
          <ExportView tenderId={tenderId} parsed={parsed} pricing={pricing} offer={offer} version={version} busy={busy}
            onConditions={(patch) => apply(api.settings(tenderId, patch))} />
        )}
      </main>
    </div>
  )
}

function ExportView({ tenderId, parsed, pricing, offer, version, busy, onConditions }: {
  tenderId: string; parsed: Parsed; pricing: Pricing; offer: Offer; version: number; busy: boolean
  onConditions: (patch: Record<string, number>) => void
}) {
  const [page, setPage] = useState(offer.conditions.page || 2)
  const highlights = offer.fields.filter((f) => f.page === page).map((f) => ({ bbox: f.bbox, color: '#0ecb81' }))
  return (
    <div className="h-full grid grid-cols-[400px_minmax(0,1fr)] gap-4">
      <ExportPanel offer={offer} pricing={pricing} url={api.offerPdfUrl(tenderId, true, version)} onJump={setPage} onConditions={onConditions} busy={busy} />
      <PdfPane url={api.offerPdfUrl(tenderId, false, version)} page={page} pageCount={parsed.meta.pages} pageSize={parsed.meta.page_sizes[String(page)]}
        highlights={highlights} caption={`${highlights.length} ✓`} onPage={setPage} />
    </div>
  )
}

function StepStats({ step, pricing, offer, supplierCount, onNextQuote }: { step: Step; pricing: Pricing; offer: Offer | null; supplierCount: number; onNextQuote: () => void }) {
  const { t } = useI18n()
  const s = pricing.summary.tender
  const pill = 'rounded-full bg-surface shadow-[var(--shadow-card)] px-3 py-1.5 text-[12.5px] num'
  if (step === 'extract')
    return (
      <div className="flex gap-2 mr-2">
        <span className={pill}><b>{fmtNum(s.lines)}</b> {t('positions')}</span>
        <span className={pill}><b>{fmtNum(pricing.summary.cad.lines)}</b> {t('cadRows')}</span>
        <span className={pill}><b>{Object.keys(pricing.tender.systems).length}</b> {t('systems')}</span>
      </div>
    )
  if (step === 'catalog')
    return (
      <div className="flex gap-2 mr-2">
        <span className={pill}><b>{fmtNum(s.priced)}</b> / {fmtNum(s.to_price)} {t('withPrice')}</span>
        {supplierCount > 0 && (
          <button onClick={onNextQuote} className={`${pill} inline-flex items-center gap-1.5 hover:bg-canvas`}>
            <span className="size-2 rounded-full bg-warn" /> <b>{supplierCount}</b> {t('awaitQuote')} →
          </button>
        )}
      </div>
    )
  if (step === 'price' && offer)
    return (
      <div className="flex gap-2 mr-2">
        <span className={pill}>{t('lineCost')} <b>{fmtChf(pricing.project.direct)}</b></span>
        <span className={pill}>m <b>{offer.factor.toFixed(4)}</b></span>
      </div>
    )
  if (step === 'export' && offer)
    return (
      <div className="flex gap-2 mr-2">
        <span className={pill}><Check className="inline size-3.5 text-good" /> <b>{fmtNum(offer.fields.length)}</b> {t('fieldsTotal')}</span>
      </div>
    )
  return null
}

function TopBar({ title, subtitle, step, onStep, price, busy, onHome }: {
  title: string; subtitle: string; step: Step; onStep: (s: Step) => void; price: number; busy: boolean; onHome: () => void
}) {
  const { t } = useI18n()
  const prev = useRef(price)
  const [delta, setDelta] = useState(0)
  useEffect(() => {
    if (price !== prev.current) {
      setDelta(price - prev.current)
      prev.current = price
      const id = setTimeout(() => setDelta(0), 2400)
      return () => clearTimeout(id)
    }
  }, [price])
  const current = STEPS.indexOf(step)
  return (
    <header className="h-14 shrink-0 bg-surface/90 backdrop-blur border-b border-hair px-5 flex items-center gap-4">
      <button onClick={onHome} className="flex items-center gap-2 shrink-0" title={t('recent')}>
        <div className="size-7 rounded-[8px] bg-brand grid place-items-center font-bold text-brand-ink text-[14px]">b</div>
      </button>
      <div className="min-w-0 w-56 shrink">
        <div className="text-[13.5px] font-semibold truncate">{title}</div>
        <div className="text-[11.5px] text-muted truncate">{subtitle}</div>
      </div>
      <nav className="flex-1 flex justify-center">
        <ol className="flex items-center gap-1">
          {STEPS.map((s, i) => {
            const on = s === step
            const done = i < current
            return (
              <li key={s} className="flex items-center gap-1">
                {i > 0 && <span className={`w-6 h-px ${done || on ? 'bg-ink/40' : 'bg-hair'}`} />}
                <button onClick={() => onStep(s)}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${on ? 'bg-ink text-white' : done ? 'text-ink hover:bg-canvas' : 'text-muted hover:bg-canvas'}`}>
                  <span className={`size-5 rounded-full grid place-items-center text-[11px] num ${on ? 'bg-brand text-brand-ink' : done ? 'bg-good text-white' : 'bg-canvas text-muted'}`}>
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  {t(STEP_LABEL[s])}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <div className="text-[10.5px] uppercase tracking-wide text-muted">{t('offerPrice')}</div>
          <div className="flex items-center gap-1.5 justify-end">
            {busy && <Loader2 className="size-3.5 animate-spin text-muted" />}
            {delta !== 0 && (
              <span className={`rise text-[11.5px] font-semibold num ${delta > 0 ? 'text-good' : 'text-bad'}`}>
                {delta > 0 ? '+' : '−'}{fmtChf(Math.abs(delta))}
              </span>
            )}
            <span className="text-[17px] font-bold num tracking-tight">CHF {fmtChf(price)}</span>
          </div>
        </div>
        <LangToggle />
      </div>
    </header>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full grid place-items-center"><div className="text-center">{children}</div></div>
}
