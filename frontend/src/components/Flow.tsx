import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, prefetched, type EditField } from '../api'
import { LEVEL_COLOR, LEVEL_MARKER, fmtChf } from '../format'
import { LangToggle, useI18n, type Key } from '../i18n'
import { STEPS, type Step } from '../route'
import { buildTree, graphOf, resolve, selectedLine, type ValueNode } from '../tree'
import type { Offer, Parsed, PricedLine, Pricing, ReferenceParameters } from '../types'
import { Col, Handle, useWidths } from './Columns'
import { PdfPane, type Highlight } from './PdfPane'
import { PositionsList, visibleIds } from './PositionsList'
import { BantenderLogo } from './Sketch'
import { Landing } from './Landing'
import { CataloguePanel } from './steps/Catalogue'
import { ExtractionPanel, findNode } from './steps/Extraction'
import { ExportPanel } from './steps/Offer'
import { OfferOptions } from './steps/OfferOptions'
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
  const [widths, setWidth] = useWidths({
    pdf: Math.min(900, Math.max(420, Math.round(window.innerWidth * 0.36))), list: 290, priceList: 360, params: 330, export: 380,
  })
  const [dragging, setDragging] = useState(false)
  const listWidth = step === 'price' ? widths.priceList : widths.list

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

  // Positions as shown: parents (one position, or the variants of one item) with their children.
  const tree = useMemo(() => (pricing ? buildTree(pricing.lines) : []), [pricing])
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tree
    const hit = (l: PricedLine) => [l.line_id, l.title_en, l.title_de, l.decision.product_id ?? ''].some((x) => x.toLowerCase().includes(q))
    return tree.filter((e) => e.members.some(hit) || e.children.some((c) => hit(c.line)))
  }, [tree, query])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setExpanded((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  // Nothing is selected (and nothing highlighted) until the estimator picks a position; the price step starts on the first.
  const selectedId = chosenId ?? (step === 'price' ? tree[0]?.id ?? null : null)
  const sel = useMemo(() => resolve(tree, selectedId), [tree, selectedId])
  const line = selectedLine(sel)
  const spec = useMemo(() => (sel ? graphOf(sel, lang) : null), [sel, lang])

  const select = useCallback((id: string) => {
    const s = resolve(tree, id)
    if (!s) return
    setChosenId(id)
    setActive(null)
    // Opening a parent (or one of its children) shows the children under it.
    if (s.entry.children.length) setExpanded((x) => (x.has(s.entry.id) ? x : new Set(x).add(s.entry.id)))
    setPage((s.child?.line ?? s.entry.members[0]).page)
  }, [tree])

  const edit = (field: EditField, v: number | null) => {
    if (!line || !tenderId) return
    if (v == null) apply(api.resetLine(tenderId, line.line_id, field))
    else apply(api.override(tenderId, line.line_id, field === 'unit_price' ? { unit_price: v, unit_price_source: 'quote' } : { [field]: v }))
  }

  // The hovered value may live on another page (e.g. a section heading, another variant): follow it.
  const activate = (key: string) => {
    setActive(key)
    const node = spec ? findNode(spec, key) : null
    const src = node?.sources.find((s) => s.bbox)
    if (src && src.page !== page) setPage(src.page)
  }

  // ↑/↓ walk the rows as shown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key) || ['INPUT', 'SELECT'].includes((e.target as HTMLElement).tagName) || step === 'offers' || step === 'export') return
      const ids = visibleIds(entries, expanded)
      const i = selectedId ? ids.indexOf(selectedId) : -1
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) {
        e.preventDefault()
        select(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entries, expanded, selectedId, select, step])

  // Highlighter marks for every value of the selection on this page; the active one is labelled.
  const highlights: Highlight[] = useMemo(() => {
    if (!spec) return []
    const activeNode = findNode(spec, active)
    const activeBoxes = new Set((activeNode?.sources ?? []).filter((s) => s.bbox).map((s) => s.bbox!.join(',')))
    const boxes = new Map<string, Highlight>()
    const all: ValueNode[] = [spec.top, ...spec.nodes.flatMap((n) => (n.values ? n.values : [n]))]
    for (const n of all) {
      for (const s of n.sources) {
        if (!s.bbox || s.page !== page) continue
        const k = s.bbox.join(',')
        const strong = activeBoxes.has(k)
        const level = strong && activeNode ? activeNode.level : n.level
        if (boxes.has(k) && !(strong && !boxes.get(k)!.strong)) continue
        boxes.set(k, { bbox: s.bbox, color: LEVEL_MARKER[level], ink: LEVEL_COLOR[level], strong, label: strong && activeNode ? activeNode.label : undefined })
      }
    }
    return [...boxes.values()]
  }, [spec, page, active])

  const ready = Boolean(tenderId && parsed && pricing)
  const top = (
    <TopBar
      title={parsed?.project.name ?? parsed?.meta.filename ?? ''}
      step={step}
      enabled={ready}
      onStep={onStep}
      price={step === 'offers' || step === 'export' ? pricing?.project.selling_price ?? null : null}
      busy={busy}
      onHome={onHome}
    />
  )

  if (!tenderId) return <Landing onOpen={onOpen} />
  if (error) return <div className="h-full flex flex-col">{top}<Centered><p className="text-bad">{error}</p><button className="mt-4 text-green" onClick={onHome}>← {t('back')}</button></Centered></div>
  if (!parsed || !pricing) return <div className="h-full flex flex-col">{top}<Centered><Loader2 className="size-6 animate-spin text-muted" /></Centered></div>

  const supplierLines = pricing.lines.filter((l) => l.status_key === 'supplier_quote_required')
  const nextQuote = step === 'catalog' && supplierLines.length > 0 && (
    <button className="mt-2 w-full flex items-center gap-2 px-1 text-left text-[12px] text-muted hover:text-ink"
      onClick={() => {
        const i = supplierLines.findIndex((l) => l.line_id === selectedId)
        select(supplierLines[(i + 1) % supplierLines.length].line_id)
      }}>
      <span className="size-1.5 rounded-full bg-warn" /> {supplierLines.length} {t('awaitQuote')} →
    </button>
  )
  const exportAt = exportPage ?? offer?.conditions.page ?? 2

  return (
    <div className="h-full flex flex-col">
      {top}
      <main className="flex-1 min-h-0 p-3">
        {/* Extraction, catalogue and price share one row of columns. The PDF stays mounted (no reload or
            re-animation between the first two steps); moving to the price step slides the PDF out to the left,
            the same positions list moves over and the parameters come in from the right. */}
        {(step === 'extract' || step === 'catalog' || step === 'price') && (
          <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0 flex">
              <Col width={step === 'price' ? 0 : widths.pdf} full={widths.pdf} align="end" animate={!dragging}>
                <PdfPane url={api.pdfUrl(tenderId)} page={page} pageCount={parsed.meta.pages} pageSize={parsed.meta.page_sizes[String(page)]}
                  highlights={highlights} caption={parsed.meta.filename ?? ''} onPage={setPage} />
              </Col>
              <Handle visible={step !== 'price'} value={widths.pdf} min={360} max={960} onChange={(w) => setWidth('pdf', w)} onDrag={setDragging} animate={!dragging} />
              <Col width={listWidth} full={listWidth} animate={!dragging}>
                <PositionsList entries={entries} systems={parsed.systems} stage={step} offer={offer} selected={selectedId} onSelect={select}
                  expanded={expanded} onToggle={toggle} query={query} onQuery={setQuery} extra={nextQuote} />
              </Col>
              <Handle value={listWidth} min={240} max={480} onChange={(w) => setWidth(step === 'price' ? 'priceList' : 'list', w)} onDrag={setDragging} animate={!dragging} />
              <div className="flex-1 min-w-[380px] h-full">
                <div key={step} className="h-full rise">
                  {!sel && <PickHint />}
                  {sel && step === 'extract' && <ExtractionPanel sel={sel} systems={parsed.systems} active={active} onActive={activate} onEdit={edit} busy={busy} />}
                  {sel && step === 'catalog' && <CataloguePanel sel={sel} systems={parsed.systems} active={active} onActive={activate} busy={busy} onQuote={(v) => edit('unit_price', v)} />}
                  {sel && step === 'price' && <PriceDetail sel={sel} systems={parsed.systems} offer={offer} settings={pricing.settings} onEdit={edit} busy={busy} />}
                </div>
              </div>
              <Handle visible={step === 'price'} invert value={widths.params} min={280} max={480} onChange={(w) => setWidth('params', w)} onDrag={setDragging} animate={!dragging} />
              <Col width={step === 'price' ? widths.params : 0} full={widths.params} animate={!dragging}>
                {step === 'price' && (
                  <ParameterPanel settings={pricing.settings} systems={parsed.systems} defaults={defaults} busy={busy}
                    onChange={(patch) => apply(api.settings(tenderId, patch))} />
                )}
              </Col>
            </div>
            {step === 'price' && <div className="pt-3 rise"><OfferBar pricing={pricing} busy={busy} workbook={api.workbookUrl(tenderId)} /></div>}
          </div>
        )}
        {step === 'offers' && <OfferOptions pricing={pricing} busy={busy} onSettings={(patch) => apply(api.settings(tenderId, patch))} onChoose={(c) => apply(api.choose(tenderId, c))} />}
        {step === 'export' && (offer ? (
          <div className="h-full flex">
            <div className="flex-1 min-w-[400px] h-full">
            <PdfPane url={api.offerPdfUrl(tenderId, false, version)} page={exportAt} pageCount={parsed.meta.pages} pageSize={parsed.meta.page_sizes[String(exportAt)]}
              highlights={offer.fields.filter((f) => f.page === exportAt).map((f) => ({ bbox: f.bbox, color: LEVEL_MARKER.read }))}
              caption={parsed.meta.filename ?? ''} onPage={setExportPage} />
            </div>
            <Handle invert value={widths.export} min={320} max={560} onChange={(w) => setWidth('export', w)} onDrag={setDragging} animate={!dragging} />
            <Col width={widths.export} full={widths.export} animate={false}>
            <ExportPanel offer={offer} parsed={parsed} choice={pricing.choice ?? null} page={exportAt} url={api.offerPdfUrl(tenderId, true, version)}
              onJump={setExportPage} onConditions={(patch) => apply(api.settings(tenderId, patch))} busy={busy} />
            </Col>
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
    <header className="h-14 shrink-0 px-5 flex items-center gap-5 relative bg-surface/70">
      <button onClick={onHome} className="shrink-0 text-ink" title={t('recent')}>
        <BantenderLogo size={24} />
      </button>
      <div className="text-[12.5px] text-muted truncate max-w-56">{title}</div>
      <nav className="flex-1 flex justify-center">
        <ol className="flex items-center gap-3">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button onClick={() => onStep(s)} disabled={!enabled && s !== 'extract'}
                className={`relative px-4 h-14 text-[14px] disabled:cursor-default disabled:text-faint/60 ${s === step ? 'text-ink font-semibold' : i < current ? 'text-ink/80 hover:text-ink' : 'text-muted hover:text-ink'}`}>
                <span className="num mr-1.5 text-faint text-[13px]">{i + 1}</span>{t(STEP_LABEL[s])}
                {s === step && (
                  <svg className="absolute left-2 right-2 bottom-2.5 w-[calc(100%-16px)] h-2.5" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
                    <path d="M2 6 C 20 3, 45 8, 62 5 S 90 4, 98 6" stroke="#70bd95" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.85" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {price != null && (
        <div className="flex items-baseline gap-2">
          {busy && <Loader2 className="size-3.5 animate-spin text-muted self-center" />}
          {delta !== 0 && <span className={`rise text-[12px] font-semibold num ${delta > 0 ? 'text-good' : 'text-bad'}`}>{delta > 0 ? '+' : '−'}{fmtChf(Math.abs(delta))}</span>}
          <span className="text-[11px] text-muted">CHF</span>
          <span className="text-[17px] font-semibold num">{fmtChf(price)}</span>
        </div>
      )}
      <LangToggle />
      <svg className="absolute left-0 right-0 bottom-0 w-full h-1.5" viewBox="0 0 1000 6" preserveAspectRatio="none" aria-hidden>
        <path d="M0 3 C 150 1.5, 300 4.5, 500 3 S 850 1.8, 1000 3.2" stroke="#1c2933" strokeOpacity="0.55" strokeWidth="1.4" fill="none" />
      </svg>
    </header>
  )
}

function PickHint() {
  const { t } = useI18n()
  return (
    <div className="h-full panel grid place-items-center">
      <div className="text-center px-8">
        <div className="text-[17px] font-semibold text-muted">← {t('pickPosition')}</div>
        <div className="mt-1 text-[12.5px] text-faint">{t('pickPositionHint')}</div>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 h-full grid place-items-center"><div className="text-center">{children}</div></div>
}
