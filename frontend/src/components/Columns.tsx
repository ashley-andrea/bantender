import { useCallback, useRef, useState, type ReactNode } from 'react'

/** Column widths the estimator set by dragging, kept per browser. */
const KEY = 'columns'
export type Widths = Record<string, number>

export function useWidths(defaults: Widths): [Widths, (key: string, w: number) => void] {
  const [widths, setWidths] = useState<Widths>(() => {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
    } catch {
      return defaults
    }
  })
  const set = useCallback((key: string, w: number) => {
    setWidths((prev) => {
      const next = { ...prev, [key]: w }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* widths are a convenience only */
      }
      return next
    })
  }, [])
  return [widths, set]
}

export const EASE = 'width 480ms cubic-bezier(0.4, 0, 0.2, 1)'

/**
 * A column whose width can animate to 0 without its content reflowing: the inner box keeps the full width,
 * the outer one clips it. `align="end"` makes it leave to the left, `"start"` makes it enter from the right.
 */
export function Col({ width, full, align = 'start', animate, children }: { width: number; full: number; align?: 'start' | 'end'; animate: boolean; children: ReactNode }) {
  return (
    <div className={`h-full shrink-0 overflow-hidden flex ${align === 'end' ? 'justify-end' : 'justify-start'}`}
      style={{ width, transition: animate ? EASE : 'none' }} aria-hidden={width === 0}>
      <div className="h-full shrink-0" style={{ width: full }}>{children}</div>
    </div>
  )
}

/** The gap between two columns; dragging it resizes one of them within [min, max]. */
export function Handle({ value, min, max, invert, onChange, onDrag, visible = true, animate }: {
  value: number; min: number; max: number; invert?: boolean; onChange: (w: number) => void; onDrag: (dragging: boolean) => void
  visible?: boolean; animate: boolean
}) {
  const start = useRef<{ x: number; w: number } | null>(null)
  return (
    <div
      role="separator" aria-orientation="vertical"
      className="group h-full shrink-0 cursor-col-resize flex justify-center touch-none"
      style={{ width: visible ? 12 : 0, transition: animate ? EASE : 'none' }}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, w: value }
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        onDrag(true)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const dx = (e.clientX - start.current.x) * (invert ? -1 : 1)
        onChange(Math.round(Math.min(max, Math.max(min, start.current.w + dx))))
      }}
      onPointerUp={() => {
        start.current = null
        onDrag(false)
      }}
    >
      {visible && <div className="w-[3px] my-8 rounded-full bg-transparent group-hover:bg-green/40 group-active:bg-green/70 transition-colors" />}
    </div>
  )
}
