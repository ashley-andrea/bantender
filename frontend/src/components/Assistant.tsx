import { Calculator, ChevronRight, Database, FileText, ListTree, Loader2, RotateCcw, SendHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useI18n, type Key } from '../i18n'
import type { AssistantAnswer, AssistantView, ChatTurn, Citation } from '../types'

interface Props {
  tenderId: string
  view: AssistantView
  active: Citation | null
  onShow: (c: Citation) => void
  avoid: DOMRect | null // the element a source was shown in: the window moves off it
}

type Point = { x: number; y: number }
const EDGE = 8 // px the window keeps from the screen edges
const GAP = 16 // px between the window and the element it moves off

/** A window position kept on screen. */
function clamp(x: number, y: number, w: number, h: number): Point {
  return { x: Math.min(Math.max(EDGE, x), window.innerWidth - w - EDGE), y: Math.min(Math.max(EDGE, y), window.innerHeight - h - EDGE) }
}

const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** Where the window goes so it does not cover `target`: beside it (left, right), else above or below, else the side with more room. */
function offTarget(box: DOMRect, target: DOMRect): Point {
  const fits = ({ x, y }: Point) => x >= EDGE && y >= EDGE && x + box.width <= window.innerWidth - EDGE && y + box.height <= window.innerHeight - EDGE
  const options: Point[] = [
    { x: target.left - GAP - box.width, y: box.top },
    { x: target.right + GAP, y: box.top },
    { x: box.left, y: target.top - GAP - box.height },
    { x: box.left, y: target.bottom + GAP },
  ]
  const fit = options.find(fits)
  if (fit) return fit
  const left = target.left > window.innerWidth - target.right
  return clamp(left ? target.left - GAP - box.width : target.right + GAP, box.top, box.width, box.height)
}

type Message = { role: 'user'; text: string } | { role: 'assistant'; answer: AssistantAnswer } | { role: 'error'; text: string }

const HINT_KEY = 'bartender-hint-seen'
const SUGGESTIONS: Key[] = ['botQ5', 'botQ6', 'botQ1', 'botQ3']
const KIND_ICON = { tender: FileText, bid: Calculator, position: ListTree, data: Database }
const ACTION: Partial<Record<Citation['kind'], Key>> = { tender: 'botShowPdf', position: 'botOpenPosition' }
const SPIN_MS = 2400
const SPINNER_VERBS = {
  en: ['Shaking', 'Stirring', 'Muddling', 'Pouring', 'Garnishing', 'Mixing', 'Straining', 'Decanting', 'Uncorking', 'Infusing',
    'Polishing glasses', 'Chilling', 'Tasting', 'Distilling', 'Tapping a fresh one', 'Reading the fine print', 'Checking the bottles', 'Ashleying', 'Pietroing', 'Matteing', 'Sebaing'],
  de: ['Schüttelt', 'Rührt um', 'Mixt', 'Schenkt ein', 'Garniert', 'Seiht ab', 'Dekantiert', 'Entkorkt', 'Poliert Gläser', 'Kühlt',
    'Verkostet', 'Destilliert', 'Zapft frisch', 'Liest das Kleingedruckte', 'Prüft die Flaschen'],
}

/** A different random verb than the last one. */
function nextVerb(verbs: string[], last?: string) {
  const pool = verbs.filter((v) => v !== last)
  return pool[Math.floor(Math.random() * pool.length)]
}

function Thinking({ lang }: { lang: 'en' | 'de' }) {
  const verbs = SPINNER_VERBS[lang]
  const [verb, setVerb] = useState(() => nextVerb(verbs))
  useEffect(() => {
    const id = setInterval(() => setVerb((v) => nextVerb(verbs, v)), SPIN_MS)
    return () => clearInterval(id)
  }, [verbs])
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-muted" aria-live="polite">
      <Loader2 className="size-3.5 animate-spin" /> <span key={verb} className="rise inline-block">{verb}…</span>
    </div>
  )
}

function hintSeen() {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}

/** The answer as plain text, for the conversation history sent with the next question. */
function asText(a: AssistantAnswer) {
  return a.status === 'answered' ? a.statements.map((s) => s.text).join(' ') : a.message
}

/** Esteban, the bartender: a button in the lower right; a small chat window that leaves the page usable beside it.
 *  While the window is closed, a dot on the button shows he is working (pulsing amber) or has an answer (green). */
export function Assistant({ tenderId, view, active, onShow, avoid }: Props) {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const [hint, setHint] = useState(!hintSeen())
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [unread, setUnread] = useState(false) // an answer arrived; shown on the button only while the window is closed
  const scroller = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const [pos, setPos] = useState<Point | null>(null) // null: the corner above the button; set by dragging the header
  const drag = useRef<Point | null>(null) // pointer offset inside the window while dragging
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api.assistant().then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false))
  }, [])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  // A source shown under the window: move the window beside it.
  useEffect(() => {
    const box = panel.current?.getBoundingClientRect()
    if (avoid && box && overlaps(box, avoid)) setPos(offTarget(box, avoid))
  }, [avoid])

  // Keep a moved window on screen when the browser window shrinks.
  useEffect(() => {
    const onResize = () => {
      const box = panel.current?.getBoundingClientRect()
      if (box) setPos((p) => p && clamp(p.x, p.y, box.width, box.height))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const startDrag = (e: React.PointerEvent<HTMLElement>) => {
    const box = panel.current?.getBoundingClientRect()
    if (!box || e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    drag.current = { x: e.clientX - box.left, y: e.clientY - box.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    const box = panel.current?.getBoundingClientRect()
    if (drag.current && box) setPos(clamp(e.clientX - drag.current.x, e.clientY - drag.current.y, box.width, box.height))
  }
  const endDrag = () => {
    drag.current = null
  }

  const toggle = () => {
    setOpen((o) => !o)
    setHint(false)
    setUnread(false)
    try {
      localStorage.setItem(HINT_KEY, '1')
    } catch {
      /* storage unavailable: the hint shows again next time */
    }
  }

  const ask = async (question: string) => {
    const q = question.trim()
    if (!q || busy) return
    const history: ChatTurn[] = messages.flatMap((m): ChatTurn[] =>
      m.role === 'user' ? [{ role: 'user', content: m.text }] : m.role === 'assistant' ? [{ role: 'assistant', content: asText(m.answer) }] : [],
    )
    setMessages((ms) => [...ms, { role: 'user', text: q }])
    setDraft('')
    setBusy(true)
    try {
      const answer = await api.ask(tenderId, { question: q, history: history.slice(-12), lang, view })
      setMessages((ms) => [...ms, { role: 'assistant', answer }])
    } catch (e) {
      setMessages((ms) => [...ms, { role: 'error', text: (e as Error).message }])
    } finally {
      setBusy(false)
      setUnread(true)
    }
  }

  return (
    <>
      {open && (
        <section ref={panel} style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
          className="fixed right-6 bottom-[150px] z-50 w-[400px] max-w-[calc(100vw-40px)] h-[min(620px,calc(100vh-190px))] flex flex-col panel panel-solid rise"
          aria-label={t('botName')}>
          <header onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
            onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && setPos(null)} title={t('botDrag')}
            className="flex items-center gap-3 px-3 py-2.5 border-b border-hair shrink-0 cursor-grab active:cursor-grabbing select-none touch-none">
            <img src="/esteban-sticker.png" alt="" className="h-11 w-auto -my-1 select-none" draggable={false} />
            <div className="min-w-0 flex-1">
              <div className="title-hand">{t('botName')}</div>
              <div className="text-[11.5px] text-muted truncate">{t('botSub')}</div>
            </div>
            {messages.length > 0 && (
              <button className="p-1.5 rounded-md text-muted hover:bg-canvas hover:text-ink" title={t('botNew')} onClick={() => setMessages([])} disabled={busy}>
                <RotateCcw className="size-4" />
              </button>
            )}
            <button className="p-1.5 rounded-md text-muted hover:bg-canvas hover:text-ink" title={t('botClose')} onClick={toggle}>
              <X className="size-4" />
            </button>
          </header>

          <div ref={scroller} className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-3">
            {enabled === false && <p className="text-[12.5px] text-bad">{t('botOff')}</p>}
            {messages.length === 0 && enabled !== false && (
              <div className="space-y-3">
                <p className="text-[13px] text-muted leading-relaxed">{t('botIntro')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((k) => (
                    <button key={k} onClick={() => ask(t(k))} disabled={!enabled}
                      className="btn btn-paper text-left text-[12.5px] px-2.5 py-1.5 font-medium">
                      {t(k)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] rounded-[14px_12px_3px_14px/12px_14px_3px_12px] bg-green text-white text-[13px] px-3 py-2 whitespace-pre-wrap">{m.text}</p>
                </div>
              ) : m.role === 'error' ? (
                <p key={i} className="text-[12.5px] text-bad">{m.text}</p>
              ) : (
                <Answer key={i} answer={m.answer} active={active} onShow={onShow} />
              ),
            )}
            {busy && <Thinking lang={lang} />}
          </div>

          <form className="border-t border-hair p-2 flex items-end gap-2 shrink-0" onSubmit={(e) => { e.preventDefault(); ask(draft) }}>
            <textarea ref={input} rows={1} value={draft} placeholder={t('botAsk')} disabled={!enabled}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  ask(draft)
                }
              }}
              className="flex-1 resize-none max-h-28 field-sizing-content text-[13px] px-2.5 py-2 rounded-[10px_8px_10px_7px] border-[1.4px] border-ink/60 outline-none focus:border-green disabled:bg-canvas" />
            <button type="submit" disabled={!draft.trim() || busy || !enabled} title={t('botAsk')}
              className="btn btn-green size-9 shrink-0">
              <SendHorizontal className="size-4" />
            </button>
          </form>
        </section>
      )}

      {/* Esteban: the sticker in the corner, laid over the page; a speech bubble the first time. */}
      <div className="fixed right-5 bottom-3 z-50 flex items-end gap-1 pointer-events-none">
        {hint && !open && (
          <div className="rise relative pointer-events-auto mb-16 mr-1 bg-surface border-[1.6px] border-ink rounded-[18px_14px_16px_12px/12px_16px_14px_18px] pl-3.5 pr-8 py-2 text-[13px] font-medium max-w-60">
            {t('botHint')}
            <button className="absolute top-1.5 right-1.5 p-1 text-faint hover:text-ink" onClick={() => setHint(false)} aria-label={t('botClose')}>
              <X className="size-3" />
            </button>
            <svg className="absolute -right-[15px] bottom-2" width="18" height="16" viewBox="0 0 18 16" aria-hidden>
              <path d="M1 2 C 7 4, 12 8, 17 15 C 11 12, 6 11, 1 11" fill="#ffffff" stroke="#1c2933" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
        )}
        <button onClick={toggle} title={!open && busy ? t('botWorking') : !open && unread ? t('botReady') : t('botHint')} aria-expanded={open}
          className={`relative pointer-events-auto transition-transform duration-200 hover:-rotate-3 hover:scale-105 ${open ? '-rotate-2' : 'rotate-2'}`}>
          <img src="/esteban-sticker.png" alt={t('botName')} draggable={false}
            className="h-[128px] w-auto select-none drop-shadow-[0_3px_6px_rgb(0_36_57/0.22)]" />
          {!open && (busy || unread) && (
            <span className="absolute top-2 right-3 grid place-items-center size-4" aria-label={busy ? t('botWorking') : t('botReady')}>
              {busy && <span className="absolute inset-0 rounded-full bg-warn opacity-60 animate-ping" />}
              <span className={`relative size-4 rounded-full border-2 border-white ${busy ? 'bg-warn' : 'bg-green'}`} />
            </span>
          )}
        </button>
      </div>
    </>
  )
}

function Answer({ answer, active, onShow }: { answer: AssistantAnswer; active: Citation | null; onShow: (c: Citation) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  if (answer.status !== 'answered') {
    return <p className="max-w-[92%] rounded-[12px_14px_14px_3px/14px_12px_12px_3px] border-[1.4px] border-ink/70 bg-surface text-[13px] px-3 py-2">{answer.message}</p>
  }
  const byN = new Map(answer.citations.map((c) => [c.n, c]))
  const isActive = (c: Citation) => active?.source === c.source && active.quote === c.quote
  const n = answer.citations.length
  // A number in the text opens the list and shows that source.
  const show = (c: Citation) => {
    setOpen(true)
    onShow(c)
  }
  return (
    <div className="max-w-[96%] space-y-2">
      <div className="rounded-[12px_14px_14px_3px/14px_12px_12px_3px] border-[1.4px] border-ink/70 bg-surface text-[13px] leading-relaxed px-3 py-2 space-y-1.5">
        {answer.statements.map((s, i) => (
          <p key={i}>
            {s.text}
            {s.refs.map((r) => (
              <button key={r} onClick={() => show(byN.get(r)!)}
                className={`ml-1 align-super text-[10px] font-semibold num px-1 rounded ${isActive(byN.get(r)!) ? 'bg-navy text-white' : 'bg-white text-green border border-hair hover:border-green'}`}>
                {r}
              </button>
            ))}
          </p>
        ))}
      </div>

      <div className="rounded-[10px_8px_10px_7px] border border-dashed border-ink/40 overflow-hidden">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-canvas">
          <ChevronRight className={`size-3.5 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="text-[12px] font-semibold num shrink-0">{n} {t(n === 1 ? 'botSource' : 'botSources')}</span>
          <span className="text-[11.5px] text-muted truncate">· {sourceSummary(answer.citations, t)}</span>
        </button>
        {open && (
          <ol className="border-t border-hair divide-y divide-hair">
            {answer.citations.map((c) => (
              <SourceItem key={c.n} c={c} active={isActive(c)} onShow={onShow} />
            ))}
          </ol>
        )}
      </div>

      {answer.unverified > 0 && (
        <p className="text-[11.5px] text-faint">
          {answer.unverified} {t(answer.unverified === 1 ? 'botStatement' : 'botStatements')} {t('botDropped')}
        </p>
      )}
    </div>
  )
}

/** Where the answer comes from, in one line: "Tender p. 9, 13 · Our offer · catalog.csv". */
function sourceSummary(citations: Citation[], t: (k: Key) => string) {
  const pages = [...new Set(citations.filter((c) => c.kind === 'tender').map((c) => c.page!))].sort((a, b) => a - b)
  const parts = pages.length ? [`${t('botTender')} p. ${pages.join(', ')}`] : []
  for (const c of citations) {
    const part = c.kind === 'bid' ? t('botOffer') : c.kind === 'position' ? c.line_id! : c.kind === 'data' ? c.label.split(' ')[0] : null
    if (part && !parts.includes(part)) parts.push(part)
  }
  return parts.join(' · ')
}

function SourceItem({ c, active, onShow }: { c: Citation; active: boolean; onShow: (c: Citation) => void }) {
  const { t } = useI18n()
  const Icon = KIND_ICON[c.kind]
  const action = ACTION[c.kind] ?? (c.step ? 'botShowThere' : undefined)
  return (
    <li className={`px-2.5 py-2 ${active ? 'bg-navy/5' : ''}`}>
      <div className="flex items-center gap-2 text-[11.5px]">
        <span className={`size-4 shrink-0 grid place-items-center rounded-full text-[10px] font-semibold num ${active ? 'bg-navy text-white' : 'bg-canvas text-ink'}`}>{c.n}</span>
        <Icon className="size-3.5 shrink-0 text-muted" />
        <span className="font-medium text-ink truncate" title={c.label}>{c.label}</span>
      </div>
      <blockquote className="mt-1.5 ml-6 pl-2 border-l-2 border-hair text-[12px] text-ink/85 line-clamp-4">{c.quote}</blockquote>
      {action && (
        <button onClick={() => onShow(c)} className="mt-1.5 ml-6 text-[11.5px] font-medium text-green hover:underline">
          {t(action)} →
        </button>
      )}
    </li>
  )
}
