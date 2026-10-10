import { fmtChf, fmtUnit } from '../format'
import { certaintyColor } from '../format'
import { tx, useI18n } from '../i18n'
import type { Attribute, CatalogContext, PricedLine } from '../types'

const W = 660
const NODE_H = 48
const GAP = 10

interface Props {
  line: PricedLine
  stage: 'extract' | 'catalog'
  catalog?: CatalogContext | null
  active: string | null
  onActive: (key: string | null) => void
}

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** Left → right: what the tender says (attributes) → the item → (catalogue product → net price, installation rule). */
export function ItemGraph({ line, stage, catalog, active, onActive }: Props) {
  const { lang } = useI18n()
  const attrs = line.attributes
  const H = Math.max(attrs.length * (NODE_H + GAP) + 24, 250)
  const midY = H / 2
  const attrX = 10, attrW = 220
  const itemX = stage === 'extract' ? 330 : 262, itemW = stage === 'extract' ? 300 : 170
  const prodX = 470, prodW = 180
  const y = (i: number) => 12 + i * (NODE_H + GAP)
  const title = lang === 'en' ? line.title_en : line.title_de
  const qty = line.decision.quantity != null ? `${fmtChf(line.decision.quantity, Number.isInteger(line.decision.quantity) ? 0 : 2)} ${fmtUnit(line.decision.unit)}` : '—'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label={title}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#c7c7cc" />
        </marker>
      </defs>

      {/* edges: attributes → item */}
      {attrs.map((a, i) => {
        const y0 = y(i) + NODE_H / 2
        const on = active === a.key
        return (
          <path key={`e-${a.key}`} d={`M${attrX + attrW} ${y0} C ${attrX + attrW + 40} ${y0}, ${itemX - 40} ${midY}, ${itemX} ${midY}`}
            fill="none" stroke={on ? certaintyColor(a.certainty) : '#d1d1d6'} strokeWidth={on ? 2.2 : 1.2} markerEnd="url(#arrow)" className="transition-all" />
        )
      })}

      {/* attribute nodes */}
      {attrs.map((a: Attribute, i) => {
        const c = certaintyColor(a.certainty)
        const on = active === a.key
        const value = tx(a.value, lang) || '—'
        return (
          <g key={a.key} className="rise cursor-pointer" style={{ animationDelay: `${i * 60}ms` }}
            onMouseEnter={() => onActive(a.key)} onClick={() => onActive(a.key)}>
            <title>{`${tx(a.label, lang)}: ${value}\n${tx(a.why, lang)} (${Math.round(a.certainty * 100)} %)`}</title>
            <rect x={attrX} y={y(i)} width={attrW} height={NODE_H} rx={10} fill={on ? `${c}1f` : '#ffffff'} stroke={on ? c : '#e5e5ea'} strokeWidth={on ? 2 : 1} />
            <rect x={attrX} y={y(i)} width={5} height={NODE_H} rx={2.5} fill={c} />
            <text x={attrX + 16} y={y(i) + 18} fontSize={11} fill="#6e6e73">{tx(a.label, lang)}</text>
            <text x={attrX + 16} y={y(i) + 36} fontSize={13.5} fontWeight={600} fill="#1d1d1f">{clip(value, 26)}</text>
            <circle cx={attrX + attrW - 16} cy={y(i) + 15} r={4.5} fill={c} />
          </g>
        )
      })}

      {/* item node */}
      <g className="rise" style={{ animationDelay: '120ms' }}>
        <rect x={itemX} y={midY - 46} width={itemW} height={92} rx={14} fill="#1d1d1f" />
        <text x={itemX + 16} y={midY - 20} fontSize={11} fill="#a1a1a6">{line.line_id} · p.{line.page}</text>
        <text x={itemX + 16} y={midY + 2} fontSize={15} fontWeight={700} fill="#ffffff">{clip(title, stage === 'extract' ? 32 : 19)}</text>
        <text x={itemX + 16} y={midY + 26} fontSize={13} fill="#f0b90b" fontWeight={600}>{qty}</text>
      </g>

      {/* catalogue stage: item → product → net price; product → installation rule */}
      {stage === 'catalog' && catalog && (
        <>
          <path d={`M${itemX + itemW} ${midY} L ${prodX} ${midY - 40}`} stroke="#0a84ff" strokeWidth={2} fill="none" markerEnd="url(#arrow)" />
          <g className="rise" style={{ animationDelay: '220ms' }}>
            <rect x={prodX} y={midY - 86} width={prodW} height={92} rx={14} fill="#0a84ff14" stroke="#0a84ff" strokeWidth={1.5} />
            <text x={prodX + 14} y={midY - 64} fontSize={11} fill="#0a84ff" fontWeight={600}>{catalog.item.product_id}</text>
            <text x={prodX + 14} y={midY - 46} fontSize={12} fill="#1d1d1f">{clip(catalog.item.description, 26)}</text>
            <text x={prodX + 14} y={midY - 22} fontSize={11} fill="#6e6e73">net / {fmtUnit(catalog.item.unit)}</text>
            <text x={prodX + prodW - 14} y={midY - 20} fontSize={17} fontWeight={700} fill="#1d1d1f" textAnchor="end">
              {fmtChf(catalog.item.net_cost_chf, 2)}
            </text>
          </g>
          {catalog.rule && catalog.rule.base_hours_per_unit > 0 && (
            <>
              <path d={`M${itemX + itemW} ${midY + 10} L ${prodX} ${midY + 52}`} stroke="#c7c7cc" strokeWidth={1.5} fill="none" markerEnd="url(#arrow)" />
              <g className="rise" style={{ animationDelay: '300ms' }}>
                <rect x={prodX} y={midY + 22} width={prodW} height={62} rx={12} fill="#ffffff" stroke="#e5e5ea" />
                <text x={prodX + 14} y={midY + 42} fontSize={11} fill="#6e6e73">{catalog.rule.install_code}</text>
                <text x={prodX + 14} y={midY + 64} fontSize={13} fontWeight={600} fill="#1d1d1f">
                  {catalog.rule.base_hours_per_unit} h / {fmtUnit(catalog.rule.unit)} · CHF {catalog.rule.default_hourly_rate_chf}/h
                </text>
              </g>
            </>
          )}
        </>
      )}
    </svg>
  )
}
