import { FileText, Upload as UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import { api, prefetched } from '../api'
import { fmtNum } from '../format'
import { useI18n } from '../i18n'
import type { TenderSummary } from '../types'
import './PdfPane' // sets up the PDF worker

/** The extraction step before a tender exists: drop the PDF; while it is read, its first page is shown being scanned. */
export function UploadView({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n()
  const [recent, setRecent] = useState<TenderSummary[]>([])
  const [drag, setDrag] = useState(false)
  const [file, setFile] = useState<{ url: string; name: string } | null>(null)
  const [pages, setPages] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)

  useEffect(() => {
    api.listTenders().then(setRecent).catch(() => setRecent([]))
  }, [])

  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [startedAt])

  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [file])

  async function run(f: File) {
    setError(null)
    const start = Date.now()
    setFile({ url: URL.createObjectURL(f), name: f.name })
    setStartedAt(start)
    setNow(start)
    try {
      const summary = await api.upload(f)
      const [parsed, pricing] = await Promise.all([api.getTender(summary.tender_id), api.getPricing(summary.tender_id)])
      prefetched.set(summary.tender_id, { parsed, pricing })
      onOpen(summary.tender_id)
    } catch (e) {
      setError((e as Error).message)
      setStartedAt(null)
      setFile(null)
    }
  }

  return (
    <div className="h-full grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3">
      {!file ? (
        <div
          className={`panel border-2 border-dashed grid place-items-center transition-colors ${drag ? 'border-green bg-green/5' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            const f = e.dataTransfer.files[0]
            if (f) run(f)
          }}
        >
          <button className="flex flex-col items-center gap-3 p-10" onClick={() => input.current?.click()}>
            <UploadIcon className="size-6 text-muted" />
            <span className="text-[15px]">{t('dropHere')}</span>
            <span className="mt-1 rounded-md bg-green px-4 py-2 text-[14px] font-semibold text-white hover:brightness-110">{t('choosePdf')}</span>
          </button>
          <input ref={input} type="file" accept="application/pdf" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) run(f)
            }} />
        </div>
      ) : (
        <div className="panel flex flex-col overflow-hidden">
          <div className="px-3 h-10 flex items-center border-b border-hair text-[12.5px] text-muted truncate">{file.name}</div>
          <div className="flex-1 min-h-0 overflow-hidden bg-[#e9edef] p-3">
            <div ref={box} className="relative bg-white overflow-hidden">
              <Document file={file.url} onLoadSuccess={(d) => setPages(d.numPages)} loading={<div className="h-[60vh]" />}>
                <Page pageNumber={1} width={width} renderTextLayer={false} renderAnnotationLayer={false} />
              </Document>
              <div className="absolute inset-x-0 top-0 h-24 pointer-events-none animate-[scan_1.6s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-green/25 to-transparent" />
            </div>
          </div>
        </div>
      )}

      <div className="panel p-8 flex flex-col">
        {!file ? (
          <>
            <div className="flex-1 min-h-0 grid place-items-center">
              <img src="/bartender.png" alt="" className="h-56 w-auto max-w-full object-contain mix-blend-multiply select-none" draggable={false} />
            </div>
            {recent.length > 0 && (
              <div className="mt-6">
                <h2 className="text-[12.5px] font-semibold text-muted mb-2">{t('recent')}</h2>
                <div className="divide-y divide-hair border-y border-hair">
                  {recent.map((r) => (
                    <button key={r.tender_id} onClick={() => onOpen(r.tender_id)} className="w-full flex items-center gap-3 px-1 py-2.5 text-left hover:bg-canvas">
                      <FileText className="size-4 text-muted" />
                      <span className="flex-1 min-w-0 truncate text-[14px]">{r.project?.name ?? r.filename ?? r.tender_id}</span>
                      <span className="text-[12px] text-muted num">{r.pages} {t('pages')} · {fmtNum(r.lines)} {t('positions')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-[15px]">{t('reading')}{pages ? ` · ${pages} ${t('pages')}` : ''}</div>
            <div className="mt-1 text-[36px] font-semibold num">{startedAt ? ((now - startedAt) / 1000).toFixed(1) : '0.0'} s</div>
            <div className="mt-4 w-64 h-1 rounded-full bg-hair overflow-hidden">
              <div className="h-full w-1/3 bg-green animate-[slide_1s_ease-in-out_infinite]" />
            </div>
          </>
        )}
        {error && <p className="mt-4 text-bad text-sm">{error}</p>}
      </div>
    </div>
  )
}
