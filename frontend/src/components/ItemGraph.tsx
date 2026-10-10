import { LEVEL_COLOR, fmtChf, fmtUnit } from '../format'
import { tx, useI18n } from '../i18n'
import type { Attribute, CatalogContext, Level, PricedLine } from '../types'

const W = 640
const TOP = 70 // centre line of the top row (item, product, installation)
const BOTTOM = 232 // centre line of the attribute row
const H = 300
const R_ITEM = 50
const R_ATTR = 27

const SHORT: Record<string, { en: string; de: string }> = {
  type: { en: 'Type', de: 'Art' }, quantity: { en: 'Qty', de: 'Menge' }, size: { en: 'Size', de: 'Grösse' },
  airflow: { en: 'Airflow', de: 'Luft' }, thickness: { en: 'Insul.', de: 'Dämm.' }, reference: { en: 'Make', de: 'Fabr.' },
  system: { en: 'System', de: 'Anlage' }, section: { en: 'Section', de: 'Abschn.' },
}

// Edge style per level: solid = read, dashed = derived, dotted = assumed / missing / not needed.
const DASH: Record<Level, string | undefined> = { read: undefined, derived: '6 4', assumed: '2 4', missing: '2 4', 'n/a': '2 4' }

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

interface Props {
  line: PricedLine
  stage: 'extract' | 'catalog'
  catalog?: CatalogContext | null
  active: string | null
  onActive: (key: string) => void
}

/** The position on top, what the tender says about it below; edges show how each value was obtained. */
export function ItemGraph({ line, stage, catalog, active, onActive }: Props) {
  const { lang } = useI18n()
  const attrs = line.attributes
  const itemX = stage === 'catalog' ? 150 : W / 2
  const step = W / Math.max(attrs.length, 1)
  const ax = (i: number) => step * (i + 0.5)
  const title = lang === 'en' ? line.title_en : line.title_de
  const q = line.decision.quantity
  const qty = q != null ? `${fmtChf(q, Number.isInteger(q) ? 0 : 2)} ${fmtUnit(line.decision.unit, lang)}` : '—'
  const prodX = 395
  const ruleX = 560
  const rule = catalog?.rule && catalog.rule.base_hours_per_unit > 0 ? catalog.rule : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label={title}>
      {/* edges: item → attributes */}
      {attrs.map((a, i) => {
        const on = active === a.key
        const x = ax(i)
        return (
          <path key={`e-${a.key}`} d={`M ${itemX} ${TOP + R_ITEM} C ${itemX} ${TOP + R_ITEM + 60}, ${x} ${BOTTOM - R_ATTR - 60}, ${x} ${BOTTOM - R_ATTR}`}
            fill="none" stroke={LEVEL_COLOR[a.level]} strokeOpacity={on ? 1 : 0.55} strokeWidth={on ? 3 : 1.8}
            strokeDasharray={DASH[a.level]} strokeLinecap="round" />
        )
      })}

      {/* catalogue stage: item → product → installation time */}
      {stage === 'catalog' && catalog && (
        <>
          <line x1={itemX + R_ITEM} y1={TOP} x2={prodX - 40} y2={TOP} stroke="#008163" strokeWidth={3} />
          {rule && <line x1={prodX + 40} y1={TOP} x2={ruleX - 30} y2={TOP} stroke="#008163" strokeOpacity={0.5} strokeWidth={2} />}
          <g className="rise">
            <circle cx={prodX} cy={TOP} r={40} fill="#008163" />
            <text x={prodX} y={TOP - 4} textAnchor="middle" fontSize={10.5} fill="#cfe9dd">{catalog.item.product_id}</text>
            <text x={prodX} y={TOP + 13} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">{fmtChf(catalog.item.net_cost_chf)}</text>
            <text x={prodX} y={TOP + 58} textAnchor="middle" fontSize={11.5} fill="#5d6b75">
              {lang === 'en' ? 'net CHF' : 'netto CHF'} / {fmtUnit(catalog.item.unit, lang)}
            </text>
          </g>
          {rule && (
            <g className="rise" style={{ animationDelay: '80ms' }}>
              <circle cx={ruleX} cy={TOP} r={30} fill="#fff" stroke="#008163" strokeWidth={2} />
              <text x={ruleX} y={TOP + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#0f1f2b">{rule.base_hours_per_unit} h</text>
              <text x={ruleX} y={TOP + 48} textAnchor="middle" fontSize={11.5} fill="#5d6b75">
                {lang === 'en' ? 'install' : 'Montage'} / {fmtUnit(rule.unit, lang)}
              </text>
            </g>
          )}
        </>
      )}

      {/* the position */}
      <g>
        <circle cx={itemX} cy={TOP} r={R_ITEM} fill="#002439" />
        {wrap(title, 13, 2).map((t, i, all) => (
          <text key={i} x={itemX} y={TOP - (all.length - 1) * 8 + i * 16 - 4} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="#fff">{t}</text>
        ))}
        <text x={itemX} y={TOP + 27} textAnchor="middle" fontSize={12} fontWeight={600} fill="#70bd95">{qty}</text>
      </g>

      {/* what the tender says */}
      {attrs.map((a: Attribute, i) => {
        const on = active === a.key
        const c = LEVEL_COLOR[a.level]
        const x = ax(i)
        const value = tx(a.value, lang) || '—'
        return (
          <g key={a.key} className="cursor-pointer" onMouseEnter={() => onActive(a.key)} onClick={() => onActive(a.key)}>
            <title>{`${tx(a.label, lang)}: ${value}`}</title>
            <circle cx={x} cy={BOTTOM} r={on ? R_ATTR + 3 : R_ATTR} fill={on ? c : '#fff'} stroke={c} strokeWidth={3} className="transition-all" />
            <text x={x} y={BOTTOM + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={on ? '#fff' : '#0f1f2b'}>
              {SHORT[a.key]?.[lang] ?? tx(a.label, lang)}
            </text>
            {wrap(value, Math.max(9, Math.floor(step / 7)), 2).map((t, j) => (
              <text key={j} x={x} y={BOTTOM + R_ATTR + 18 + j * 14} textAnchor="middle" fontSize={11.5}
                fill={on ? '#0f1f2b' : '#5d6b75'} fontWeight={on ? 600 : 400}>{t}</text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}
