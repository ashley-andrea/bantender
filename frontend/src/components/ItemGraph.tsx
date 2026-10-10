import { LEVEL_COLOR, LEVEL_MARKER } from '../format'
import { useI18n } from '../i18n'
import type { AttrNode, GraphSpec, SubValue } from '../tree'
import type { Level } from '../types'

const W = 660
const TOP = 74
const R_TOP = 48
const R = 29
const R_SUB = 13
const SUB_GAP = 62
const DASH = '6 5' // one dash pattern for every level: the colour carries the meaning
const INK = '#1c2933'
const LINK = '#002439' // trunk and bus: Equans navy, never the grey that means "missing"

interface Props {
  spec: GraphSpec
  /** Catalogue step: show the product and installation time chained to the type. */
  catalog?: boolean
  active: string | null
  onActive: (key: string) => void
}

function wrap(text: string, width: number, lines = 2): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).flatMap((w) => (w.length > width && w.includes('-') ? w.split(/(?<=-)/) : [w]))) {
    if ((cur + ' ' + word).trim().length > width && cur) {
      out.push(cur)
      cur = word
    } else cur = (cur + ' ' + word).trim()
  }
  if (cur) out.push(cur)
  const clipped = out.map((l) => (l.length > width ? `${l.slice(0, width - 1)}…` : l))
  if (clipped.length > lines) return [...clipped.slice(0, lines - 1), `${clipped[lines - 1].slice(0, width - 1)}…`]
  return clipped
}

const ring = (l: Level) => LEVEL_COLOR[l]
/** Straight segments only; the pencil filter gives them the hand-drawn wobble. */
const seg = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ')

export function ItemGraph({ spec, catalog = false, active, onActive }: Props) {
  const { lang } = useI18n()
  const tx = catalog ? 200 : W / 2
  const px = 420
  const hx = 578
  const bus = catalog ? 214 : 196
  const rowY = bus + 50
  const step = W / Math.max(spec.nodes.length, 1)
  const xOf = (i: number) => step * (i + 0.5)
  const isOpen = (n: { key: string; subs?: SubValue[] }) =>
    !!n.subs && (spec.open || active === n.key || n.subs.some((s) => s.key === active))
  const maxSubs = Math.max(0, ...spec.nodes.filter(isOpen).map((n) => n.subs!.length))
  const H = rowY + R + 44 + (maxSubs ? maxSubs * SUB_GAP + 6 : 0)
  const dim = (s: SubValue) => spec.open && !s.selected && active !== s.key
  const labelW = Math.max(9, Math.floor(step / 7))

  const xs = spec.nodes.map((_, i) => xOf(i))
  const busFrom = Math.min(tx, ...xs)
  const busTo = Math.max(tx, ...xs)
  const typeOpen = !!spec.typeSubs && (spec.open || active === 'type' || spec.typeSubs.some((s) => s.key === active))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none overflow-visible" role="img" aria-label={spec.top.value}>
      {/* trunk and bus from the type to the values */}
      <path d={seg([[tx, TOP + R_TOP], [tx, bus]])} stroke={LINK} strokeOpacity={0.85} strokeWidth={1.6} strokeDasharray={DASH} fill="none" filter="url(#pencil)" />
      <path d={seg([[busFrom, bus], [busTo, bus]])} stroke={LINK} strokeOpacity={0.85} strokeWidth={1.6} strokeDasharray={DASH} fill="none" filter="url(#pencil)" />
      {spec.nodes.map((n, i) => {
        const on = active === n.key || n.subs?.some((s) => s.key === active)
        return (
          <path key={`e-${n.key}`} d={seg([[xOf(i), bus], [xOf(i), rowY - R]])} fill="none" stroke={ring(n.level)}
            strokeWidth={on ? 3 : 2} strokeDasharray={DASH} strokeLinecap="round" filter="url(#pencil)" />
        )
      })}

      {/* catalogue: type → product → installation time */}
      {catalog && spec.product && (
        <ChainNode node={spec.product} x={px} fromX={tx + R_TOP} lang={lang} active={active} onActive={onActive} open={isOpen(spec.product)} dim={dim} filled />
      )}
      {catalog && spec.hours && (
        <ChainNode node={spec.hours} x={hx} fromX={spec.product ? px + 44 : tx + R_TOP} lang={lang} active={active} onActive={onActive} open={isOpen(spec.hours)} dim={dim} />
      )}

      {/* parts: their own type beside the parent's */}
      {typeOpen && spec.typeSubs && spec.typeSubs.map((s, i, all) => {
        const y = TOP + (i - (all.length - 1) / 2) * 56
        const x = Math.max(70, tx - 130)
        const sel = s.selected || active === s.key
        return (
          <g key={s.key} className="grow cursor-pointer" opacity={dim(s) ? 0.5 : 1} onMouseEnter={() => onActive(s.key)} onClick={() => onActive(s.key)}>
            <path d={seg([[tx - R_TOP, TOP], [tx - 80, TOP], [tx - 80, y], [x + R_SUB, y]])} fill="none" stroke={ring(s.level)} strokeWidth={1.8} strokeDasharray={DASH} filter="url(#pencil)" />
            <circle cx={x} cy={y} r={sel ? R_SUB + 2 : R_SUB} fill={sel ? LEVEL_MARKER[s.level] : '#ffffff'} stroke={ring(s.level)} strokeWidth={2.2} filter="url(#pencil)" />
            <text x={x} y={y + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={INK}>{s.index}</text>
            {wrap(s.value, 18, 2).map((t, j) => (
              <text key={j} x={x} y={y + R_SUB + 14 + j * 13} textAnchor="middle" fontSize={11} fill={INK} fontWeight={sel ? 600 : 400}
                stroke="#ffffff" strokeWidth={4} paintOrder="stroke">{t}</text>
            ))}
          </g>
        )
      })}

      {/* the type */}
      <g className="cursor-pointer" onMouseEnter={() => onActive('type')} onClick={() => onActive('type')}>
        <title>{spec.top.value}</title>
        <circle cx={tx} cy={TOP} r={R_TOP} fill="#002439" stroke={active === 'type' ? ring(spec.top.level) : INK} strokeWidth={active === 'type' ? 4 : 1.5} filter="url(#pencil)" />
        {wrap(spec.top.value, 11, 3).map((t, i, all) => (
          <text key={i} x={tx} y={TOP + 4 - (all.length - 1) * 7.5 + i * 15} textAnchor="middle" fontSize={12} fontWeight={600} fill="#fff">{t}</text>
        ))}
        <g transform={`translate(${tx} ${TOP - R_TOP - 9}) rotate(-3)`}>
          <rect x={-22} y={-10} width={44} height={19} rx={6} fill="#ffffff" stroke={INK} strokeWidth={1.3} />
          <text x={0} y={4} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={INK}>{spec.top.label}</text>
        </g>
      </g>

      {/* the values, and under each the children's own where they differ */}
      {spec.nodes.map((n, i) => {
        const x = xOf(i)
        const on = active === n.key
        const open = isOpen(n)
        const many = !!n.subs
        return (
          <g key={n.key}>
            {open && n.subs && (
              <path d={seg([[x, rowY + R], [x, rowY + R + 50 + (n.subs.length - 1) * SUB_GAP - R_SUB]])} fill="none" stroke={ring(n.level)}
                strokeWidth={1.8} strokeDasharray={DASH} filter="url(#pencil)" className="rise" />
            )}
            <g className="cursor-pointer" onMouseEnter={() => onActive(n.key)} onClick={() => onActive(n.key)}>
              <title>{`${n.label}: ${n.value}`}</title>
              {many && <circle cx={x} cy={rowY} r={R + 5} fill="none" stroke={ring(n.level)} strokeWidth={1.3} strokeDasharray="3 4" filter="url(#pencil)" />}
              <circle cx={x} cy={rowY} r={on ? R + 2 : R} fill={on || open ? LEVEL_MARKER[n.level] : '#ffffff'} stroke={ring(n.level)} strokeWidth={2.6} filter="url(#pencil)" className="transition-all" />
              <text x={x} y={rowY + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={INK}>{n.label}</text>
              {many && (
                <g transform={`translate(${x + R * 0.82} ${rowY - R * 0.82})`}>
                  <circle r={8.5} fill={INK} />
                  <text y={3.6} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">{n.subs!.length}</text>
                </g>
              )}
              {wrap(n.value, labelW, 2).map((t, j) => (
                <text key={j} x={x} y={rowY + R + 17 + j * 13} textAnchor="middle" fontSize={11.5} fill={on ? INK : '#5f6a72'} fontWeight={on ? 600 : 400}
                  stroke="#ffffff" strokeWidth={4} paintOrder="stroke">{t}</text>
              ))}
            </g>
            {open && n.subs!.map((s, j) => {
              const y = rowY + R + 50 + j * SUB_GAP
              const sel = s.selected || active === s.key
              return (
                <g key={s.key} className="grow cursor-pointer" style={{ animationDelay: `${j * 40}ms` }} opacity={dim(s) ? 0.5 : 1}
                  onMouseEnter={() => onActive(s.key)} onClick={() => onActive(s.key)}>
                  <title>{`${s.label} ${s.index}: ${s.value}`}</title>
                  <circle cx={x} cy={y} r={sel ? R_SUB + 2 : R_SUB} fill={sel ? LEVEL_MARKER[s.level] : '#ffffff'} stroke={ring(s.level)} strokeWidth={2.2} filter="url(#pencil)" />
                  <text x={x} y={y + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={INK}>{s.index}</text>
                  {wrap(s.value, labelW, 2).map((t, k) => (
                    <text key={k} x={x} y={y + R_SUB + 14 + k * 13} textAnchor="middle" fontSize={11} fill={sel ? INK : '#5f6a72'} fontWeight={sel ? 600 : 400}
                      stroke="#ffffff" strokeWidth={4} paintOrder="stroke">{t}</text>
                  ))}
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

/** Product or installation time in the catalogue chain; its children's own values in a row underneath. */
function ChainNode({ node, x, fromX, lang, active, onActive, open, dim, filled }: {
  node: AttrNode; x: number; fromX: number; lang: 'en' | 'de'; active: string | null; onActive: (k: string) => void
  open: boolean; dim: (s: SubValue) => boolean; filled?: boolean
}) {
  const r = filled ? 44 : 31
  const [main, sub] = node.value.split(' · ')
  const on = active === node.key
  const subY = TOP + r + 46
  const gap = 78
  const subs = node.subs ?? []
  const x0 = x - ((subs.length - 1) * gap) / 2
  return (
    <g>
      <path d={seg([[fromX, TOP], [x - r, TOP]])} stroke="#008163" strokeWidth={2.4} strokeDasharray={DASH} fill="none" filter="url(#pencil)" />
      {open && subs.length > 0 && (
        <path d={seg([[x, TOP + r], [x, subY - 26], ...(subs.length > 1 ? [[x0, subY - 26], [x0 + (subs.length - 1) * gap, subY - 26]] as [number, number][] : [])])}
          stroke="#008163" strokeWidth={1.6} strokeDasharray={DASH} fill="none" filter="url(#pencil)" />
      )}
      <g className="cursor-pointer grow" onMouseEnter={() => onActive(node.key)} onClick={() => onActive(node.key)}>
        <title>{node.value}</title>
        {subs.length > 0 && <circle cx={x} cy={TOP} r={r + 5} fill="none" stroke="#008163" strokeWidth={1.3} strokeDasharray="3 4" filter="url(#pencil)" />}
        <circle cx={x} cy={TOP} r={on ? r + 2 : r} fill={filled ? '#008163' : '#ffffff'} stroke={filled ? INK : '#008163'} strokeWidth={filled ? 1.5 : 2.2} filter="url(#pencil)" />
        {sub !== undefined ? (
          <>
            <text x={x} y={TOP - 4} textAnchor="middle" fontSize={main.length > 9 ? 9.5 : 10.5} fill={filled ? '#d6efe4' : '#5f6a72'}>{main}</text>
            <text x={x} y={TOP + 14} textAnchor="middle" fontSize={13.5} fontWeight={700} fill={filled ? '#fff' : INK}>{sub}</text>
          </>
        ) : (
          <text x={x} y={TOP + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill={filled ? '#fff' : INK}>{main}</text>
        )}
        <text x={x} y={TOP - r - 8} textAnchor="middle" fontSize={11} fill="#5f6a72">
          {node.attrKey === 'product' ? (lang === 'en' ? 'net CHF / unit' : 'netto CHF / Einheit') : (lang === 'en' ? 'install / unit' : 'Montage / Einheit')}
        </text>
      </g>
      {open && subs.map((s, i) => {
        const sx = x0 + i * gap
        const sel = s.selected || active === s.key
        const [, price] = s.value.split(' · ')
        return (
          <g key={s.key} className="grow cursor-pointer" opacity={dim(s) ? 0.5 : 1} onMouseEnter={() => onActive(s.key)} onClick={() => onActive(s.key)}>
            <title>{s.value}</title>
            <path d={seg([[sx, subY - 26], [sx, subY - R_SUB]])} stroke="#008163" strokeWidth={1.6} strokeDasharray={DASH} fill="none" filter="url(#pencil)" />
            <circle cx={sx} cy={subY} r={sel ? R_SUB + 2 : R_SUB} fill={sel ? LEVEL_MARKER.read : '#ffffff'} stroke="#008163" strokeWidth={2.2} filter="url(#pencil)" />
            <text x={sx} y={subY + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={INK}>{s.index}</text>
            <text x={sx} y={subY + R_SUB + 14} textAnchor="middle" fontSize={11} fill={sel ? INK : '#5f6a72'} fontWeight={sel ? 600 : 400}
              stroke="#ffffff" strokeWidth={4} paintOrder="stroke">{price ?? s.value}</text>
          </g>
        )
      })}
    </g>
  )
}
