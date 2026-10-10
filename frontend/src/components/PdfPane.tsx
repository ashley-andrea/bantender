import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { BBox } from '../types'

// Must be set in the module that renders react-pdf components.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export interface Highlight {
  bbox: BBox
  color: string // highlighter colour (translucent)
  ink?: string // solid colour of the same meaning, for the active mark's underline and label
  strong?: boolean
  label?: string
}

interface Props {
  url: string
  page: number
  pageCount: number
  pageSize: [number, number] | undefined
  highlights: Highlight[]
  caption?: string
  onPage: (p: number) => void
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const TAG_H = 22

/** One label per name, above its first mark; a label that would cover an earlier one moves up a row. */
function placeLabels(hs: Highlight[], scale: number) {
  const placed: { x: number; y: number; w: number; text: string; color: string }[] = []
  const seen = new Set<string>()
  for (const h of [...hs].sort((a, b) => a.bbox[1] - b.bbox[1])) {
    if (!h.strong || !h.label || seen.has(h.label)) continue
    seen.add(h.label)
    const w = h.label.length * 7.5 + 18
    const x = Math.max(0, h.bbox[0] * scale - 6)
    let y = h.bbox[1] * scale - TAG_H - 4
    while (placed.some((p) => x < p.x + p.w && p.x < x + w && Math.abs(p.y - y) < TAG_H)) y -= TAG_H + 2
    placed.push({ x, y, w, text: h.label, color: h.ink ?? '#1c2933' })
  }
  return placed
}

export function PdfPane({ url, page, pageCount, pageSize, highlights, caption, onPage }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [base, setBase] = useState(600) // fit-to-width page width
  const [zoom, setZoom] = useState(1)
  const [rendered, setRendered] = useState(1) // zoom the canvas was last rendered at (a pinch re-renders once it settles)
  const anchor = useRef<{ x: number; y: number; cx: number; cy: number; from: number } | null>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  // Fit width: re-render the page only once a resize settles (dragging a column edge would re-render per pixel).
  useEffect(() => {
    if (!scroller.current) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(([e]) => {
      const w = Math.floor(e.contentRect.width) - 24
      clearTimeout(timer)
      if (w >= 120) timer = setTimeout(() => setBase(w), 120)
    })
    ro.observe(scroller.current)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => setRendered(zoom), 180)
    return () => clearTimeout(id)
  }, [zoom])

  // Pinch (trackpad: ctrl + wheel in Chrome and Firefox, gesture events in Safari) zooms around the fingers.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const zoomAt = (next: number, clientX: number, clientY: number) => {
      const from = zoomRef.current
      const n = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
      if (n === from) return
      const r = el.getBoundingClientRect()
      const cx = clientX - r.left
      const cy = clientY - r.top
      anchor.current = { x: el.scrollLeft + cx, y: el.scrollTop + cy, cx, cy, from }
      zoomRef.current = n
      setZoom(n)
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomAt(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY)
    }
    let gestureStart = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureStart = zoomRef.current
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as Event & { scale: number; clientX: number; clientY: number }
      zoomAt(gestureStart * g.scale, g.clientX, g.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
    }
  }, [])

  // Keep the point under the fingers (or the centre, for the buttons) where it was.
  useLayoutEffect(() => {
    const a = anchor.current
    const el = scroller.current
    if (!a || !el) return
    const k = zoom / a.from
    el.scrollLeft = a.x * k - a.cx
    el.scrollTop = a.y * k - a.cy
    anchor.current = null
  }, [zoom])

  const step = (factor: number) => {
    const el = scroller.current
    if (!el) return
    const cx = el.clientWidth / 2
    const cy = el.clientHeight / 2
    const n = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * factor * 100) / 100))
    anchor.current = { x: el.scrollLeft + cx, y: el.scrollTop + cy, cx, cy, from: zoom }
    setZoom(n)
  }

  const width = base * zoom
  const scale = pageSize ? width / pageSize[0] : 1
  const height = pageSize ? pageSize[1] * scale : 800
  const focus = highlights.find((h) => h.strong) ?? highlights[0]
  const labels = placeLabels(highlights, scale)
  const anyStrong = highlights.some((h) => h.strong)

  // Bring the focused mark into view when the selection changes (not on zoom).
  useEffect(() => {
    if (focus && scroller.current) {
      scroller.current.scrollTo({ top: Math.max(0, focus.bbox[1] * scale - 160), left: Math.max(0, focus.bbox[0] * scale - 60), behavior: 'smooth' })
    }
  }, [focus?.bbox[1], focus?.bbox[0], page])

  return (
    <div className="h-full flex flex-col panel overflow-hidden">
      <div className="flex items-center gap-2 px-2 h-9 border-b border-hair shrink-0">
        <span className="text-[12px] text-muted truncate">{caption}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button className="p-1 rounded hover:bg-canvas disabled:opacity-30" title="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => step(1 / 1.25)}>
            <Minus className="size-4" />
          </button>
          <button className="w-11 text-[12px] text-muted num hover:text-ink" title="Fit width" onClick={() => step(1 / zoom)}>{Math.round(zoom * 100)}%</button>
          <button className="p-1 rounded hover:bg-canvas disabled:opacity-30" title="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => step(1.25)}>
            <Plus className="size-4" />
          </button>
          <span className="mx-1.5 h-4 w-px bg-hair" />
          <button className="p-1 rounded hover:bg-canvas disabled:opacity-30" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-[12px] text-muted num whitespace-nowrap px-1 text-center">{page} / {pageCount}</span>
          <button className="p-1 rounded hover:bg-canvas disabled:opacity-30" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div ref={scroller} className="flex-1 overflow-auto scroll-thin bg-[#ebe6da] p-3">
        <div className="relative bg-white shadow-[2px_3px_0_rgb(28_41_51/0.12)]" style={{ width, height }}>
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${zoom / rendered})` }}>
            <Document file={url} loading={<div className="h-[60vh] grid place-items-center text-muted text-sm">…</div>}>
              <Page pageNumber={page} width={base * rendered} renderTextLayer={false} renderAnnotationLayer={false} />
            </Document>
          </div>
          {highlights.map((h, i) => {
            const [x0, y0, x1, y1] = h.bbox
            return (
              <div key={i} className="hl" style={{
                left: (x0 - 3) * scale, top: (y0 - 1.5) * scale, width: (x1 - x0 + 6) * scale, height: (y1 - y0 + 3) * scale,
                background: h.color, opacity: anyStrong && !h.strong ? 0.5 : 1,
                boxShadow: h.strong && h.ink ? `inset 0 -2px 0 ${h.ink}` : undefined,
              }} />
            )
          })}
          {labels.map((l) => (
            <span key={l.text} className="hl-tag" style={{ left: l.x, top: l.y, color: l.color }}>{l.text}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
