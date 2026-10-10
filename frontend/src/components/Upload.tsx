import { FileText, Loader2, Upload as UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { fmtNum } from '../format'
import { LangToggle, useI18n } from '../i18n'
import type { TenderSummary } from '../types'

export function Upload({ onOpen }: { onOpen: (id: string, live: boolean) => void }) {
  const { t } = useI18n()
  const [recent, setRecent] = useState<TenderSummary[]>([])
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.listTenders().then(setRecent).catch(() => setRecent([]))
  }, [])

  async function run(file: File) {
    setError(null)
    setBusy(true)
    try {
      const summary = await api.upload(file)
      onOpen(summary.tender_id, true)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }


  return (
    <div className="min-h-full flex flex-col items-center px-4 py-16">
      <div className="w-full max-w-2xl flex items-center gap-2 mb-12">
        <div className="size-8 rounded-[9px] bg-brand grid place-items-center font-bold text-brand-ink">b</div>
        <span className="text-[17px] font-semibold tracking-tight">bantender</span>
        <span className="ml-auto"><LangToggle /></span>
      </div>

      <h1 className="text-[40px] leading-tight font-semibold tracking-tight text-center">{t('tagline')}</h1>
      <p className="mt-3 text-muted text-[17px] text-center max-w-xl">
        {t('subline')}
      </p>

      <div
        className={`mt-10 w-full max-w-2xl rounded-[20px] border-2 border-dashed transition-colors bg-surface shadow-[var(--shadow-card)] ${
          drag ? 'border-sel bg-sel/5' : 'border-hair'
        }`}
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
        {!busy ? (
          <button className="w-full py-16 flex flex-col items-center gap-4 cursor-pointer" onClick={() => input.current?.click()}>
            <div className="size-14 rounded-full bg-canvas grid place-items-center">
              <UploadIcon className="size-6 text-ink" />
            </div>
            <div className="text-[17px] font-medium">{t('dropHere')}</div>
            <div className="text-muted text-sm">{t('orClick')}</div>
            <span className="mt-2 inline-flex items-center rounded-full bg-brand px-5 py-2.5 text-[15px] font-semibold text-brand-ink hover:brightness-95">
              {t('choosePdf')}
            </span>
          </button>
        ) : (
          <div className="py-20 flex flex-col items-center gap-4">
            <Loader2 className="size-8 text-sel animate-spin" />
            <div className="text-[17px] font-medium">{t('uploading')}</div>
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) run(f)
          }}
        />
      </div>
      {error && <p className="mt-4 text-bad text-sm">{error}</p>}

      {recent.length > 0 && !busy && (
        <div className="mt-12 w-full max-w-2xl">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted mb-3">{t('recent')}</h2>
          <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] divide-y divide-hair">
            {recent.map((r) => (
              <button
                key={r.tender_id}
                onClick={() => onOpen(r.tender_id, false)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-canvas/60 cursor-pointer"
              >
                <FileText className="size-5 text-muted" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.project?.name ?? r.filename ?? r.tender_id}</div>
                  <div className="text-sm text-muted num">
                    {r.project?.bkp ? `BKP ${r.project.bkp} · ` : ''}{r.pages} {t('pages').toLowerCase()} · {Object.keys(r.systems).length} {t('systems')} · {fmtNum(r.lines)} {t('positions')}
                  </div>
                </div>
                <span className="text-sm text-sel font-medium">{t('open')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
