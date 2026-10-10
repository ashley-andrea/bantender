import { Pencil, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fmtNum } from '../format'
import { useI18n } from '../i18n'

interface Props {
  value: number | null
  suffix: string
  edited: boolean
  busy: boolean
  onSave: (v: number) => void
  onReset: () => void
  dark?: boolean
}

/** A number the estimator can correct in place; edited values are marked and can be reset. */
export function InlineNumber({ value, suffix, edited, busy, onSave, onReset, dark }: Props) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const commit = () => {
    const n = Number(draft.replace(/['’\s]/g, '').replace(',', '.'))
    if (draft.trim() !== '' && Number.isFinite(n) && n >= 0 && n !== value) onSave(n)
    setEditing(false)
  }

  if (editing)
    return (
      <span className="inline-flex items-center gap-1">
        <input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          inputMode="decimal" className="w-20 rounded-md border border-sel bg-surface px-1.5 py-0.5 num text-[13px] text-ink outline-none" />
        <span className={dark ? 'text-[#c7c7cc]' : 'text-muted'}>{suffix}</span>
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5">
      <button disabled={busy} onClick={() => { setDraft(value == null ? '' : String(value)); setEditing(true) }}
        className={`group inline-flex items-center gap-1 rounded-md px-1 -mx-1 num font-semibold ${dark ? 'hover:bg-white/10' : 'hover:bg-canvas'} ${edited ? 'text-sel' : ''}`}
        title={t('edit')}>
        {value == null ? '—' : fmtNum(value)} {suffix}
        <Pencil className="size-3 opacity-40 group-hover:opacity-100" />
      </button>
      {edited && (
        <button disabled={busy} onClick={onReset} title={t('reset')} className={dark ? 'text-[#a1a1a6] hover:text-white' : 'text-muted hover:text-ink'}>
          <RotateCcw className="size-3.5" />
        </button>
      )}
    </span>
  )
}
