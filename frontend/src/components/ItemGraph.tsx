import { LEVEL_COLOR, LEVEL_MARKER, fmtChf, fmtUnit } from '../format'
import { useI18n } from '../i18n'
import type { GraphNode, GraphSpec, ValueNode } from '../tree'
import type { Level } from '../types'

const W = 660
const TOP = 66
const R_TOP = 46
const R_MID = 34
const R = 27
const R_SMALL = 19
const DASH = '6 5' // one dash pattern for every level: the colour carries the meaning

export interface ProductNode {
  key: string
  id: string
  net: number
  unit: string | null
}

interface Props {
  spec: GraphSpec
  /** Catalogue step: the product(s) and installation time the position is priced with. */
  products?: ProductNode[]
  hours?: { value: number; unit: string } | null
  active: string | null
  onActive: (key: string) => void
}

function wrap(text: string, width: number, lines = 2): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/)) {
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

/** The type on top, what the tender says below; a child selection adds the variant or part in between. */
export function ItemGraph({ spec, products, hours, active, onActive }: Props) {
  const { lang } = useI18n()
  const catalog = products !== undefined
  const topX = catalog ? 140 : W / 2
  const midY = spec.mid ? 168 : 0
  const rowY = spec.mid ? 272 : 206
  const step = W / Math.max(spec.nodes.length, 1)
  const xOf = (i: number) => step * (i + 0.5)

  const prodX = 405
  const ruleX = 575
  const productGroup: GraphNode | null = products && products.length > 1
    ? { key: 'product', attrKey: 'product', from: 'top', label: lang === 'en' ? 'Products' : 'Produkte', value: `${products.length}`, level: 'read', sources: [],
        values: products.map((p) => ({ key: p.key, label: p.id, value: `${p.id} · ${fmtChf(p.net)}`, level: 'read' as Level, sources: [] })) }
    : null
  // A grouped node opens when it, or one of its values, is active.
  const groups: { node: GraphNode; x: number; y: number }[] = [
    ...spec.nodes.map((n, i) => ({ node: n, x: xOf(i), y: rowY })),
    ...(productGroup ? [{ node: productGroup, x: prodX, y: TOP }] : []),
  ]
  const open = groups.find((g) => g.node.values && (active === g.node.key || g.node.values.some((v) => v.key === active)))
  const expandY = rowY + 110
  const H = rowY + 66 + (open ? 106 : 0)

  const valuesX = (n: number, center: number) => {
    const gap = Math.min(92, (W - 40) / Math.max(n, 1))
    const start = Math.min(Math.max(center - ((n - 1) * gap) / 2, 26), W - 26 - (n - 1) * gap)
    return (i: number) => start + i * gap
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none overflow-visible" role="img" aria-label={spec.top.value}>
      {/* edges to the values */}
      {spec.nodes.map((n, i) => {
        const fromY = n.from === 'mid' && spec.mid ? midY + R_MID : TOP + R_TOP
        const x = xOf(i)
        const on = active === n.key || n.values?.some((v) => v.key === active)
        return (
          <path key={`e-${n.key}`} className={spec.mid && n.from === 'mid' ? 'rise' : undefined}
            d={`M ${topX} ${fromY} C ${topX} ${fromY + 55}, ${x} ${rowY - R - 55}, ${x} ${rowY - R}`}
            fill="none" stroke={ring(n.level)} strokeWidth={on ? 3 : 1.9} strokeOpacity={on ? 1 : 0.75} strokeDasharray={DASH}
            strokeLinecap="round" filter="url(#pencil)" />
        )
      })}

      {/* catalogue: product and installation time */}
      {catalog && products && products.length > 0 && (
        <g>
          <path d={`M ${topX + R_TOP} ${TOP} L ${prodX - 46} ${TOP}`} stroke="#008163" strokeWidth={2.6} strokeDasharray={DASH} filter="url(#pencil)" />
          {hours && <path d={`M ${prodX + 46} ${TOP} L ${ruleX - 30} ${TOP}`} stroke="#008163" strokeWidth={1.8} strokeOpacity={0.6} strokeDasharray={DASH} filter="url(#pencil)" />}
          {products.length === 1 ? (
            <g className="grow">
              <circle cx={prodX} cy={TOP} r={40} fill="#008163" stroke="#1c2933" strokeWidth={1.5} filter="url(#pencil)" />
              <text x={prodX} y={TOP - 4} textAnchor="middle" fontSize={10.5} fill="#d6efe4">{products[0].id}</text>
              <text x={prodX} y={TOP + 14} textAnchor="middle" fontSize={13.5} fontWeight={700} fill="#fff">{fmtChf(products[0].net)}</text>
              <text x={prodX} y={TOP + 60} textAnchor="middle" fontSize={11.5} fill="#5f6a72">{lang === 'en' ? 'net CHF' : 'netto CHF'} / {fmtUnit(products[0].unit, lang)}</text>
            </g>
          ) : (
            <GroupCircle x={prodX} y={TOP} r={40} label={lang === 'en' ? 'Products' : 'Produkte'} count={products.length} color="#008163"
              on={open?.node.key === 'product'} onClick={() => onActive('product')} />
          )}
          {hours && (
            <g className="grow" style={{ animationDelay: '80ms' }}>
              <circle cx={ruleX} cy={TOP} r={30} fill="#ffffff" stroke="#008163" strokeWidth={2.2} filter="url(#pencil)" />
              <text x={ruleX} y={TOP + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1c2933">{hours.value} h</text>
              <text x={ruleX} y={TOP + 50} textAnchor="middle" fontSize={11.5} fill="#5f6a72">{lang === 'en' ? 'install' : 'Montage'} / {fmtUnit(hours.unit, lang)}</text>
            </g>
          )}
        </g>
      )}

      {/* the type: main node, with its tag */}
      <g className="cursor-pointer" onMouseEnter={() => onActive('type')} onClick={() => onActive('type')}>
        <title>{spec.top.value}</title>
        <circle cx={topX} cy={TOP} r={R_TOP} fill="#002439" stroke={active === 'type' ? ring(spec.top.level) : '#1c2933'}
          strokeWidth={active === 'type' ? 4 : 1.5} filter="url(#pencil)" />
        {wrap(spec.top.value, 12, 3).map((t, i, all) => (
          <text key={i} x={topX} y={TOP + 4 - (all.length - 1) * 7.5 + i * 15} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="#fff">{t}</text>
        ))}
        <g transform={`translate(${topX} ${TOP - R_TOP - 9}) rotate(-3)`}>
          <rect x={-22} y={-10} width={44} height={19} rx={6} fill="#ffffff" stroke="#1c2933" strokeWidth={1.3} />
          <text x={0} y={4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#1c2933">{spec.top.label}</text>
        </g>
      </g>

      {/* the selected variant or part */}
      {spec.mid && (
        <g className="grow" key={spec.mid.label}>
          <path d={`M ${topX} ${TOP + R_TOP} L ${topX} ${midY - R_MID}`} stroke="#1c2933" strokeWidth={2} strokeDasharray={DASH} filter="url(#pencil)" />
          <circle cx={topX} cy={midY} r={R_MID} fill={LEVEL_MARKER[spec.mid.level]} stroke="#1c2933" strokeWidth={2} filter="url(#pencil)" />
          <text x={topX} y={midY + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1c2933">{spec.mid.label}</text>
          {spec.mid.sub && (
            <g>
              <rect x={topX + R_MID + 6} y={midY - 11} width={Math.min(260, spec.mid.sub.length * 7 + 14)} height={21} rx={6} fill="#ffffff" stroke="#1c2933" strokeWidth={1} />
              <text x={topX + R_MID + 13} y={midY + 4} fontSize={12} fill="#1c2933">{spec.mid.sub.length > 36 ? `${spec.mid.sub.slice(0, 35)}…` : spec.mid.sub}</text>
            </g>
          )}
        </g>
      )}

      {/* values */}
      {spec.nodes.map((n, i) => {
        const x = xOf(i)
        const on = active === n.key
        const label = wrap(n.value, Math.max(9, Math.floor(step / 7)), 2)
        if (n.values) {
          return (
            <g key={n.key}>
              <GroupCircle x={x} y={rowY} r={R} label={n.label} count={n.values.length} color={ring(n.level)} on={on || open?.node.key === n.key}
                onClick={() => onActive(n.key)} />
              {label.map((t, j) => (
                <text key={j} x={x} y={rowY + R + 21 + j * 14} textAnchor="middle" fontSize={11.5} fill="#5f6a72">{t}</text>
              ))}
            </g>
          )
        }
        return (
          <g key={n.key} className={`cursor-pointer ${spec.mid && n.from === 'mid' ? 'grow' : ''}`} onMouseEnter={() => onActive(n.key)} onClick={() => onActive(n.key)}>
            <title>{`${n.label}: ${n.value}`}</title>
            <circle cx={x} cy={rowY} r={on ? R + 3 : R} fill={on ? LEVEL_MARKER[n.level] : '#ffffff'} stroke={ring(n.level)} strokeWidth={2.6}
              filter="url(#pencil)" className="transition-all" />
            <text x={x} y={rowY + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1c2933">{n.label}</text>
            {label.map((t, j) => (
              <text key={j} x={x} y={rowY + R + 19 + j * 14} textAnchor="middle" fontSize={11.5} fill={on ? '#1c2933' : '#5f6a72'} fontWeight={on ? 600 : 400}>{t}</text>
            ))}
          </g>
        )
      })}

      {/* an opened group: one small node per variant, part or product */}
      {open && open.node.values && (() => {
        const vx = valuesX(open.node.values.length, open.x)
        const fromY = open.y + (open.node.key === 'product' ? 40 : R) + 5
        return open.node.values.map((v: ValueNode, i) => {
          const x = vx(i)
          const on = active === v.key
          return (
            <g key={v.key} className="cursor-pointer grow" style={{ animationDelay: `${i * 40}ms` }} onMouseEnter={() => onActive(v.key)} onClick={() => onActive(v.key)}>
              <title>{`${v.label}: ${v.value}`}</title>
              <path d={`M ${open.x} ${fromY} C ${open.x} ${fromY + 50}, ${x} ${expandY - 60}, ${x} ${expandY - R_SMALL}`} fill="none"
                stroke={ring(v.level)} strokeWidth={on ? 2.6 : 1.6} strokeDasharray={DASH} filter="url(#pencil)" />
              <circle cx={x} cy={expandY} r={on ? R_SMALL + 2 : R_SMALL} fill={on ? LEVEL_MARKER[v.level] : '#ffffff'} stroke={ring(v.level)} strokeWidth={2.2} filter="url(#pencil)" />
              <text x={x} y={expandY + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#1c2933">{i + 1}</text>
              {wrap(v.value, 13, 2).map((t, j) => (
                <text key={j} x={x} y={expandY + R_SMALL + 15 + j * 13} textAnchor="middle" fontSize={11} fill={on ? '#1c2933' : '#5f6a72'} fontWeight={on ? 600 : 400}>{t}</text>
              ))}
            </g>
          )
        })
      })()}
    </svg>
  )
}

function GroupCircle({ x, y, r, label, count, color, on, onClick }: {
  x: number; y: number; r: number; label: string; count: number; color: string; on: boolean; onClick: () => void
}) {
  return (
    <g className="cursor-pointer" onClick={onClick} onMouseEnter={onClick}>
      <circle cx={x} cy={y} r={r + 5} fill="none" stroke={color} strokeWidth={1.4} strokeDasharray="3 4" filter="url(#pencil)" />
      <circle cx={x} cy={y} r={r} fill={on ? `${color}33` : '#ffffff'} stroke={color} strokeWidth={2.6} filter="url(#pencil)" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1c2933">{label}</text>
      <g transform={`translate(${x + r * 0.8} ${y - r * 0.8})`}>
        <circle r={9} fill="#1c2933" />
        <text y={3.8} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#fff">{count}</text>
      </g>
    </g>
  )
}
