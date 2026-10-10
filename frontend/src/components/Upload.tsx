import { FileText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import { api, prefetched } from '../api'
import { fmtNum } from '../format'
import { useI18n } from '../i18n'
import type { TenderSummary } from '../types'
import { DropArt, JourneyArt } from './Art'
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
          className={`panel border-[1.5px] border-dashed grid place-items-center transition-colors ${drag ? 'border-ink bg-peri' : 'border-ink/30 bg-cyan'}`}
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
          <button className="group flex flex-col items-center gap-3 p-10" onClick={() => input.current?.click()}>
            <DropArt className="w-56" />
            <span className="display text-[20px]">{t('dropHere')}</span>
            <span className="cta mt-1 px-6 py-2.5 text-[14px] group-hover:bg-white group-hover:text-ink">{t('choosePdf')}</span>
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
          <div className="flex-1 min-h-0 overflow-hidden well p-3">
            <div ref={box} className="relative bg-white overflow-hidden">
              <Document file={file.url} onLoadSuccess={(d) => setPages(d.numPages)} loading={<div className="h-[60vh]" />}>
                <Page pageNumber={1} width={width} renderTextLayer={false} renderAnnotationLayer={false} />
              </Document>
              <div className="absolute inset-x-0 top-0 h-24 pointer-events-none animate-[scan_1.6s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-cyan/60 to-transparent" />
            </div>
          </div>
        </div>
      )}

      <div className="panel p-10 flex flex-col overflow-hidden">
        {!file ? (
          <>
            <h1 className="text-[58px] !font-normal leading-[0.98] !tracking-[-0.045em] max-w-2xl"><Tagline text={t('tagline')} /></h1>
            <p className="mt-5 text-muted text-[15px] max-w-lg">{t('subline')}</p>
            {recent.length > 0 && (
              <div className="mt-10">
                <h2 className="eyebrow !font-mono mb-2">{t('recent')}</h2>
                <div className="divide-y divide-hair border-y border-hair">
                  {recent.map((r) => (
                    <button key={r.tender_id} onClick={() => onOpen(r.tender_id)} className="group w-full flex items-center gap-3 px-2 py-3 text-left hover:bg-mint transition-colors">
                      <FileText className="size-4 text-muted group-hover:text-ink" />
                      <span className="display flex-1 min-w-0 truncate text-[16px]">{r.project?.name ?? r.filename ?? r.tender_id}</span>
                      <span className="font-mono text-[11px] text-muted num">{r.pages} {t('pages')} · {fmtNum(r.lines)} {t('positions')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="eyebrow">{t('reading')}{pages ? ` · ${pages} ${t('pages')}` : ''}</div>
            <div className="figure mt-1 text-[96px] leading-none num">{startedAt ? ((now - startedAt) / 1000).toFixed(1) : '0.0'} s</div>
            <div className="mt-6 w-80 h-1.5 rounded-full bg-hair overflow-hidden">
              <div className="h-full w-1/3 bg-ink animate-[slide_1s_ease-in-out_infinite]" />
            </div>
          </>
        )}
        {error && <p className="mt-4 text-bad text-sm">{error}</p>}
        <JourneyArt className="mt-auto w-full max-w-2xl self-center pt-6" />
      </div>
    </div>
  )
}

/** The last two words set in italic serif. */
function Tagline({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <>
      {words.slice(0, -2).join(' ')}{' '}
      <em className="figure italic">{words.slice(-2).join(' ')}</em>
    </>
  )
}
