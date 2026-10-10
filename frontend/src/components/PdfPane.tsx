import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { BBox } from '../types'

// Must be set in the module that renders react-pdf components.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export interface Highlight {
  bbox: BBox
  color: string
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
  extra?: React.ReactNode
}

export function PdfPane({ url, page, pageCount, pageSize, highlights, caption, onPage, extra }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)

  useEffect(() => {
    if (!box.current) return
    // Re-render the page only once a resize settles (dragging a column edge would otherwise re-render per pixel).
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(([e]) => {
      const w = Math.floor(e.contentRect.width)
      clearTimeout(timer)
      if (w >= 120) timer = setTimeout(() => setWidth(w), 120)
    })
    ro.observe(box.current)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [])

  const scale = pageSize ? width / pageSize[0] : 1
  const focus = highlights.find((h) => h.strong) ?? highlights[0]

  // Bring the focused box into view.
  useEffect(() => {
    if (focus && scroller.current) {
      scroller.current.scrollTo({ top: Math.max(0, focus.bbox[1] * scale - 180), behavior: 'smooth' })
    }
  }, [focus?.bbox[1], focus?.bbox[0], page, scale])

  return (
    <div className="h-full flex flex-col panel overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-10 border-b border-hair shrink-0">
        <span className="text-[12.5px] text-muted truncate">{caption}</span>
        <div className="ml-auto flex items-center gap-1">
          {extra}
          <button className="p-1.5 rounded-md hover:bg-canvas disabled:opacity-30" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-[12px] text-muted num whitespace-nowrap px-1 text-center">
            {page} / {pageCount}
          </span>
          <button className="p-1.5 rounded-md hover:bg-canvas disabled:opacity-30" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div ref={scroller} className="flex-1 overflow-auto scroll-thin bg-[#e9edef] p-3">
        <div ref={box} className="relative bg-white shadow-sm">
          <Document file={url} loading={<div className="h-[60vh] grid place-items-center text-muted text-sm">…</div>}>
            <Page pageNumber={page} width={width} renderTextLayer={false} renderAnnotationLayer={false} />
          </Document>
          {highlights.map((h, i) => {
            const [x0, y0, x1, y1] = h.bbox
            return (
              <div
                key={i}
                className="absolute pointer-events-none rounded-[2px] transition-all duration-200"
                style={{
                  left: (x0 - 4) * scale,
                  top: (y0 - 2) * scale,
                  width: (x1 - x0 + 8) * scale,
                  height: (y1 - y0 + 4) * scale,
                  border: `${h.strong ? 2 : 1}px solid ${h.color}`,
                  background: `${h.color}${h.strong ? '2e' : '12'}`,
                }}
              >
                {h.label && h.strong && (
                  <span className="absolute -top-[18px] right-0 whitespace-nowrap rounded-sm px-1.5 py-px text-[10.5px] font-semibold text-white" style={{ background: h.color }}>
                    {h.label}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
