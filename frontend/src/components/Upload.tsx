import { FileText, Upload as UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { fmtNum } from '../format'
import { LangToggle, useI18n } from '../i18n'
import type { TenderSummary } from '../types'

function remember(key: string, value: number) {
  try {
    sessionStorage.setItem(key, String(value))
  } catch {
    /* timing is a convenience only */
  }
}

export function Upload({ onOpen }: { onOpen: (id: string, live: boolean) => void }) {
  const { t } = useI18n()
  const [recent, setRecent] = useState<TenderSummary[]>([])
  const [drag, setDrag] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.listTenders().then(setRecent).catch(() => setRecent([]))
  }, [])

  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [startedAt])

  async function run(file: File) {
    setError(null)
    const start = Date.now()
    setStartedAt(start)
    setNow(start)
    try {
      const summary = await api.upload(file)
      remember(`uploadAt:${summary.tender_id}`, start)
      remember(`roundTrip:${summary.tender_id}`, Date.now() - start)
      onOpen(summary.tender_id, true)
    } catch (e) {
      setError((e as Error).message)
      setStartedAt(null)
    }
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="h-14 shrink-0 bg-navy px-6 flex items-center">
        <img src="/equans-logo-white.png" alt="Equans" className="h-6" />
        <span className="ml-auto"><LangToggle dark /></span>
      </header>

      <div className="flex-1 flex flex-col items-center px-4 pt-16 pb-12">
        <h1 className="text-[32px] font-semibold tracking-tight text-center">{t('tagline')}</h1>
        <p className="mt-2 text-muted text-[15px] text-center max-w-lg">{t('subline')}</p>

        <div
          className={`mt-10 w-full max-w-xl rounded-lg border-2 border-dashed bg-surface transition-colors ${drag ? 'border-green bg-green/5' : 'border-hair'}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            const f = e.dataTransfer.files[0]
            if (f && !startedAt) run(f)
          }}
        >
          {!startedAt ? (
            <button className="w-full py-14 flex flex-col items-center gap-3 cursor-pointer" onClick={() => input.current?.click()}>
              <UploadIcon className="size-6 text-muted" />
              <div className="text-[15px]">{t('dropHere')}</div>
              <span className="mt-1 rounded-md bg-green px-4 py-2 text-[14px] font-semibold text-white hover:brightness-110">{t('choosePdf')}</span>
            </button>
          ) : (
            <div className="py-16 flex flex-col items-center gap-3">
              <div className="w-48 h-1 rounded-full bg-hair overflow-hidden">
                <div className="h-full w-1/3 bg-green animate-[slide_1s_ease-in-out_infinite]" />
              </div>
              <div className="text-[15px]">{t('reading')}</div>
              <div className="text-[13px] text-muted num">{((now - startedAt) / 1000).toFixed(1)} s</div>
            </div>
          )}
          <input ref={input} type="file" accept="application/pdf" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) run(f)
            }} />
        </div>
        {error && <p className="mt-4 text-bad text-sm">{error}</p>}

        {recent.length > 0 && !startedAt && (
          <div className="mt-12 w-full max-w-xl">
            <h2 className="text-[12.5px] font-semibold text-muted mb-2">{t('recent')}</h2>
            <div className="panel divide-y divide-hair">
              {recent.map((r) => (
                <button key={r.tender_id} onClick={() => onOpen(r.tender_id, false)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-canvas">
                  <FileText className="size-4 text-muted" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] truncate">{r.project?.name ?? r.filename ?? r.tender_id}</div>
                    <div className="text-[12px] text-muted num">
                      {r.project?.bkp ? `BKP ${r.project.bkp} · ` : ''}{r.pages} {t('pages')} · {fmtNum(r.lines)} {t('positions')}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
