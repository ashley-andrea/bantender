import { ChevronDown, FileText, Upload as UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import { api, prefetched } from '../api'
import { fmtNum } from '../format'
import { LangToggle, useI18n, type Key } from '../i18n'
import type { TenderSummary } from '../types'
import './PdfPane' // sets up the PDF worker

// The intro plays once per page load; coming back to this screen later skips it.
let introPlayed = false

type Phase = 'intro' | 'settled' | 'ready'
const RATIO = 500 / 580 // bartender.png width / height
const LOGO_H = 46 // both logos, same height
const LOGO_GAP = 26 // from the centre line to each logo
const LOGO_TOP = 'calc(69vh - 8px)' // under the centred bartender (see imgStyle)

/**
 * Home: the bartender and "bantender × Equans" in the middle; then the wordmark moves to the top left, the bartender
 * to the bottom right with a speech bubble, and the page offers the recent tenders and the upload.
 */
export function Landing({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>(introPlayed ? 'ready' : 'intro')
  const [recent, setRecent] = useState<TenderSummary[]>([])
  const [menu, setMenu] = useState(false)
  const [drag, setDrag] = useState(false)
  const [file, setFile] = useState<{ url: string; name: string } | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.listTenders().then(setRecent).catch(() => setRecent([]))
  }, [])

  // The intro waits for any key or click, then settles and becomes ready.
  useEffect(() => {
    if (introPlayed) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const start = () => {
      window.removeEventListener('keydown', start)
      window.removeEventListener('pointerdown', start)
      setPhase('settled')
      timer = setTimeout(() => {
        setPhase('ready')
        introPlayed = true
      }, 900)
    }
    window.addEventListener('keydown', start)
    window.addEventListener('pointerdown', start)
    return () => {
      window.removeEventListener('keydown', start)
      window.removeEventListener('pointerdown', start)
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [startedAt])

  async function run(f: File) {
    setError(null)
    setMenu(false)
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

  const intro = phase === 'intro'
  const bubble: Key | null = phase !== 'ready' ? null : file ? 'bubbleReading' : menu ? 'bubbleUsual' : 'bubbleWaiting'
  const ease = 'all 900ms cubic-bezier(0.65, 0, 0.35, 1)'
  // Bartender: medium in the middle, then smaller in the bottom-right corner.
  const imgH = intro ? 38 : 25 // vh
  // Intro: bartender and the two logos form one group centred on the page (image + 30px gap + 46px logos).
  const imgStyle: React.CSSProperties = intro
    ? { height: `${imgH}vh`, left: `calc(50vw - ${(imgH * RATIO) / 2}vh)`, top: `calc(${50 - imgH / 2}vh - 38px)` }
    : { height: `${imgH}vh`, left: `calc(100vw - ${imgH * RATIO}vh - 40px)`, top: `calc(100vh - ${imgH}vh - 28px)` }

  return (
    <div className="h-full relative overflow-hidden"
      onDragOver={(e) => { e.preventDefault(); if (!intro) setDrag(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f && !file) run(f) }}>
      {/* header strip: the wordmark lands here */}
      <header className={`h-14 px-5 flex items-center justify-end gap-4 transition-opacity duration-500 ${intro ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <LangToggle />
        <svg className="absolute left-0 right-0 top-[54px] w-full h-1.5" viewBox="0 0 1000 6" preserveAspectRatio="none" aria-hidden>
          <path d="M0 3 C 150 1.5, 300 4.5, 500 3 S 850 1.8, 1000 3.2" stroke="#1c2933" strokeOpacity="0.55" strokeWidth="1.4" fill="none" />
        </svg>
      </header>

      <img src="/bartender.png" alt="" draggable={false} className="fixed z-10 w-auto mix-blend-multiply select-none pointer-events-none"
        style={{ ...imgStyle, transition: ease }} />

      {/* bantender × Equans under the bartender, same height and line, the pair centred; then the bantender logo
          flies to the top left and Equans fades out. */}
      <img src="/bantender-logo.png" alt="bantender" draggable={false} className="fixed z-20 w-auto select-none" style={{
        transition: ease,
        ...(intro
          ? { left: '50vw', top: LOGO_TOP, height: LOGO_H, transform: `translateX(calc(-100% - ${LOGO_GAP}px))` }
          : { left: '20px', top: '15px', height: 26, transform: 'translateX(0)' }),
      }} />
      <span className="fixed z-20 text-[24px] leading-none text-muted" style={{
        left: '50vw', top: `calc(${LOGO_TOP} + ${LOGO_H / 2 - 12}px)`, transform: 'translateX(-50%)', transition: 'opacity 500ms ease', opacity: intro ? 1 : 0,
      }}>×</span>
      <img src="/equans-logo.png" alt="Equans" className="fixed z-20 w-auto" style={{
        left: `calc(50vw + ${LOGO_GAP}px)`, top: LOGO_TOP, height: LOGO_H, transition: 'opacity 500ms ease', opacity: intro ? 1 : 0,
      }} />

      {/* speech bubble */}
      {bubble && (
        <div key={bubble} className="fixed z-20 grow" style={{ right: `calc(${imgH * RATIO}vh + 18px)`, top: `calc(100vh - ${imgH}vh - 34px)`, transformOrigin: 'right bottom' }}>
          <div className="relative text-[15px] font-semibold text-ink bg-surface px-4 py-2 border-[1.6px] border-ink rounded-[18px_14px_16px_12px/12px_16px_14px_18px]">
            {t(bubble)}
            <svg className="absolute -right-[15px] bottom-1" width="18" height="16" viewBox="0 0 18 16" aria-hidden>
              <path d="M1 2 C 7 4, 12 8, 17 15 C 11 12, 6 11, 1 11" fill="#ffffff" stroke="#1c2933" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      )}

      {/* page content */}
      <main className={`absolute inset-x-0 top-14 bottom-0 flex flex-col items-center transition-opacity duration-500 ${intro ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {/* upload, in the middle */}
        <div className="flex-1 w-full grid place-items-center pb-[8vh]">
          {!file ? (
            <div className={`panel w-[min(520px,90vw)] px-10 py-12 flex flex-col items-center gap-3 transition-colors ${drag ? 'panel-green bg-hl-read/20' : ''}`}>
              <div className="text-[23px] font-semibold text-center">{t('tagline')}</div>
              <p className="text-[13.5px] text-muted text-center max-w-sm">{t('subline')}</p>
              <button className="btn btn-green mt-4 px-5 py-2.5 text-[15px]" onClick={() => input.current?.click()}>
                <UploadIcon className="size-4" /> {t('uploadTender')}
              </button>
              <div className="text-[12px] text-faint">{t('orDrop')}</div>
              {/* recent tenders, as a dropdown under the upload */}
              <div className="mt-5">
                <button disabled={!recent.length || !!file} onClick={() => setMenu((m) => !m)}
                  className="btn btn-paper px-4 py-1.5 text-[14px]">
                  {t('recent')} {recent.length > 0 && <span className="num text-[13px] text-muted">({recent.length})</span>}
                  <ChevronDown className={`size-4 transition-transform ${menu ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {menu && (
                <div className="w-full mt-2 border-t border-dashed border-hair pt-2 rise">
                    {recent.map((r) => (
                      <button key={r.tender_id} onClick={() => onOpen(r.tender_id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded hover:bg-canvas">
                        <FileText className="size-4 text-muted shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-[14px]">{r.project?.name ?? r.filename ?? r.tender_id}</span>
                        <span className="text-[12px] text-muted num whitespace-nowrap">{r.pages} {t('pages')} · {fmtNum(r.lines)} {t('positions')}</span>
                      </button>
                    ))}
                </div>
              )}
              <input ref={input} type="file" accept="application/pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f) }} />
            </div>
          ) : (
            <div className="panel w-[min(560px,90vw)] p-5 flex gap-5 items-center rise">
              <div className="relative w-40 shrink-0 bg-white overflow-hidden border border-hair">
                <Document file={file.url} loading={<div className="h-52" />}>
                  <Page pageNumber={1} width={160} renderTextLayer={false} renderAnnotationLayer={false} />
                </Document>
                <div className="absolute inset-x-0 top-0 h-10 pointer-events-none animate-[scan_1.6s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-hl-derived/60 to-transparent" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] text-muted truncate">{file.name}</div>
                <div className="mt-1 text-[17px] font-semibold">{t('reading')}</div>
                <div className="mt-1 text-[32px] font-semibold num">{startedAt ? ((now - startedAt) / 1000).toFixed(1) : '0.0'} s</div>
                <div className="mt-3 w-48 h-1 rounded-full bg-hair overflow-hidden">
                  <div className="h-full w-1/3 bg-green animate-[slide_1s_ease-in-out_infinite]" />
                </div>
              </div>
            </div>
          )}
          {error && <p className="mt-4 text-bad text-sm">{error}</p>}
        </div>
      </main>
    </div>
  )
}
