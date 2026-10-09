import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { BBox } from '../types'

// Must be set in the module that renders react-pdf components.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export interface Highlight {
  bbox: BBox
  kind: 'row' | 'header'
}

interface Props {
  url: string
  page: number
  pageCount: number
  pageSize: [number, number] | undefined
  highlights: Highlight[]
  caption: string
  onPage: (p: number) => void
}

export function PdfPane({ url, page, pageCount, pageSize, highlights, caption, onPage }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)

  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  const scale = pageSize ? width / pageSize[0] : 1
  const focus = highlights.find((h) => h.kind === 'row') ?? highlights[0]

  // Bring the highlighted row into view.
  useEffect(() => {
    if (focus && scroller.current) {
      scroller.current.scrollTo({ top: Math.max(0, focus.bbox[1] * scale - 160), behavior: 'smooth' })
    }
  }, [focus?.bbox[1], page, scale])

  return (
    <div className="h-full flex flex-col rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-hair">
        <span className="text-[13px] font-semibold">Tender p.{page}</span>
        <span className="text-[13px] text-muted truncate">{caption}</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="p-1.5 rounded-md hover:bg-canvas disabled:opacity-30" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-[13px] text-muted num w-16 text-center">
            {page} / {pageCount}
          </span>
          <button className="p-1.5 rounded-md hover:bg-canvas disabled:opacity-30" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div ref={scroller} className="flex-1 overflow-auto scroll-thin bg-[#ececef] p-3">
        <div ref={box} className="relative bg-white shadow-sm">
          <Document file={url} loading={<div className="h-[60vh] grid place-items-center text-muted text-sm">Loading tender…</div>}>
            <Page pageNumber={page} width={width} renderTextLayer={false} renderAnnotationLayer={false} />
          </Document>
          {highlights.map((h, i) => {
            const [x0, y0, x1, y1] = h.bbox
            return (
              <div
                key={i}
                className={`absolute pointer-events-none rounded-[3px] transition-all duration-200 ${
                  h.kind === 'row' ? 'bg-sel/15 border-[1.5px] border-sel' : 'border-[1.5px] border-dashed border-sel'
                }`}
                style={{
                  left: (x0 - 4) * scale,
                  top: (y0 - 2) * scale,
                  width: (x1 - x0 + 8) * scale,
                  height: (y1 - y0 + 4) * scale,
                }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
