import { Check, FileText, Loader2, Upload as UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { fmtNum } from '../format'
import type { TenderSummary } from '../types'

const STAGES = ['Uploading tender', 'Reading every page', 'Finding priceable lines', 'Checking for red flags']

export function Upload({ onOpen }: { onOpen: (id: string) => void }) {
  const [recent, setRecent] = useState<TenderSummary[]>([])
  const [drag, setDrag] = useState(false)
  const [stage, setStage] = useState(-1)
  const [result, setResult] = useState<TenderSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.listTenders().then(setRecent).catch(() => setRecent([]))
  }, [])

  async function run(file: File) {
    setError(null)
    setResult(null)
    setStage(0)
    const request = api.upload(file)
    // Stages reflect the real pipeline steps; their pacing is only so a 1-second parse stays readable.
    for (let i = 1; i < STAGES.length; i++) {
      await new Promise((r) => setTimeout(r, 380))
      setStage(i)
    }
    try {
      const summary = await request
      setStage(STAGES.length)
      setResult(summary)
      setTimeout(() => onOpen(summary.tender_id), 1400)
    } catch (e) {
      setError((e as Error).message)
      setStage(-1)
    }
  }

  const busy = stage >= 0 && !result

  return (
    <div className="min-h-full flex flex-col items-center px-4 py-16">
      <div className="flex items-center gap-2 mb-12">
        <div className="size-8 rounded-[9px] bg-brand grid place-items-center font-bold text-brand-ink">b</div>
        <span className="text-[17px] font-semibold tracking-tight">bantender</span>
      </div>

      <h1 className="text-[40px] leading-tight font-semibold tracking-tight text-center">From tender to first price.</h1>
      <p className="mt-3 text-muted text-[17px] text-center max-w-xl">
        Drop a tender PDF. Every line, quantity and price stays linked to the page it came from.
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
        {stage < 0 ? (
          <button className="w-full py-16 flex flex-col items-center gap-4 cursor-pointer" onClick={() => input.current?.click()}>
            <div className="size-14 rounded-full bg-canvas grid place-items-center">
              <UploadIcon className="size-6 text-ink" />
            </div>
            <div className="text-[17px] font-medium">Drop the tender PDF here</div>
            <div className="text-muted text-sm">or click to choose a file</div>
            <span className="mt-2 inline-flex items-center rounded-full bg-brand px-5 py-2.5 text-[15px] font-semibold text-brand-ink hover:brightness-95">
              Choose PDF
            </span>
          </button>
        ) : (
          <div className="p-8">
            <ol className="space-y-3">
              {STAGES.map((label, i) => (
                <li key={label} className="flex items-center gap-3 text-[15px]">
                  {i < stage || result ? (
                    <Check className="size-5 text-good" />
                  ) : i === stage ? (
                    <Loader2 className="size-5 text-sel animate-spin" />
                  ) : (
                    <span className="size-5 rounded-full border border-hair" />
                  )}
                  <span className={i <= stage ? 'text-ink' : 'text-faint'}>{label}</span>
                </li>
              ))}
            </ol>
            {result && (
              <div className="mt-8 grid grid-cols-4 gap-3 rise">
                <Stat label="Pages" value={result.pages} />
                <Stat label="Systems" value={Object.keys(result.systems).length} />
                <Stat label="Lines found" value={result.lines} />
                <Stat label="Red flags" value={result.anomalies} tone="warn" />
              </div>
            )}
            {busy && <p className="mt-6 text-sm text-muted">Deterministic parsing, no AI involved.</p>}
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

      {recent.length > 0 && stage < 0 && (
        <div className="mt-12 w-full max-w-2xl">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted mb-3">Recent tenders</h2>
          <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] divide-y divide-hair">
            {recent.map((t) => (
              <button
                key={t.tender_id}
                onClick={() => onOpen(t.tender_id)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-canvas/60 cursor-pointer"
              >
                <FileText className="size-5 text-muted" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{t.filename ?? t.tender_id}</div>
                  <div className="text-sm text-muted num">
                    {t.pages} pages · {Object.keys(t.systems).length} systems · {fmtNum(t.lines)} lines
                  </div>
                </div>
                <span className="text-sm text-sel font-medium">Open</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className="rounded-xl bg-canvas px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-[26px] font-semibold num tracking-tight ${tone === 'warn' ? 'text-warn' : ''}`}>{fmtNum(value)}</div>
    </div>
  )
}
