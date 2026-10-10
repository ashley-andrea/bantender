import type { EditField } from '../../api'
import { LEVEL_COLOR, fmtUnit } from '../../format'
import { lineTitle, sectionName, systemName, useI18n, type Key } from '../../i18n'
import { entryQuantity, entryTitle, findNode, graphOf, selectedLine, type Selection } from '../../tree'
import type { Level, Parsed } from '../../types'
import { InlineNumber } from '../InlineNumber'
import { ItemGraph } from '../ItemGraph'

interface PanelProps {
  sel: Selection
  systems: Parsed['systems']
  active: string | null
  onActive: (k: string) => void
  onEdit: (field: EditField, v: number | null) => void
  busy: boolean
}

export function ExtractionPanel({ sel, systems, active, onActive, onEdit, busy }: PanelProps) {
  const { t, lang } = useI18n()
  const spec = graphOf(sel, lang)
  const node = findNode(spec, active)
  const line = selectedLine(sel)
  return (
    <div className="h-full min-h-0 overflow-auto scroll-thin panel p-5">
      <SelectionHeader sel={sel} systems={systems} />
      <Legend className="mt-5" />
      <div className="mt-6" key={sel.entry.id}>
        <ItemGraph spec={spec} active={active} onActive={onActive} />
      </div>
      <div className="mt-3 min-h-[64px] border-t border-dashed border-hair pt-3 text-[13px]">
        {node && (
          <div className="flex items-start gap-3" key={node.key}>
            <span className="mt-1 size-2.5 rounded-full shrink-0" style={{ background: LEVEL_COLOR[node.level] }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-muted">{node.label}</span>
                {line && line.source === 'lv' && (active === `quantity:${line.line_id}` || (active === 'quantity' && !sel.child && sel.entry.kind === 'line')) ? (
                  <InlineNumber value={line.decision.quantity} suffix={fmtUnit(line.decision.unit, lang)} edited={line.decision.overridden.includes('quantity')}
                    busy={busy} onSave={(v) => onEdit('quantity', v)} onReset={() => onEdit('quantity', null)} />
                ) : (
                  <span className="font-semibold">{node.value}</span>
                )}
              </div>
              <div className="text-muted text-[12.5px]">
                {t(levelKey(node.level))}{node.why ? ` · ${node.why}` : ''}{(node.page ?? node.sources[0]?.page) ? ` · p.${node.page ?? node.sources[0].page}` : ''}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const levelKey = (l: Level): Key => (l === 'n/a' ? 'missing' : l)

export function SelectionHeader({ sel, systems }: { sel: Selection; systems: Parsed['systems'] }) {
  const { t, lang } = useI18n()
  const line = sel.child?.line ?? sel.entry.members[0]
  const pages = [...new Set(sel.entry.members.map((m) => m.page))]
  return (
    <div>
      {sel.child && <div className="text-[12px] text-muted">{entryTitle(sel.entry, lang)} ›</div>}
      <div className="text-[19px] font-semibold leading-snug">
        {sel.child ? lineTitle(sel.child.line, lang) : entryTitle(sel.entry, lang)}
        {!sel.child && sel.entry.kind === 'group' && (
          <span className="ml-2 text-[13px] font-semibold text-green">{sel.entry.members.length} {t('variants')} · {entryQuantity(sel.entry, lang)}</span>
        )}
      </div>
      <div className="text-[12.5px] text-muted">
        {line.system} {systemName(systems[line.system], lang)} · {line.section} {sectionName(line, lang)} · p.{sel.child ? line.page : pages.join(', ')}
      </div>
    </div>
  )
}

/** How a value was obtained: one colour each, the same dashes as the graph edges. */
export function Legend({ className = '' }: { className?: string }) {
  const { t } = useI18n()
  const items: [Level, Key][] = [['read', 'read'], ['derived', 'derived'], ['assumed', 'assumed'], ['missing', 'missing']]
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted ${className}`}>
      {items.map(([l, k]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <svg width="26" height="8"><line x1="2" y1="4" x2="24" y2="4" stroke={LEVEL_COLOR[l]} strokeWidth="2.4" strokeDasharray="6 5" strokeLinecap="round" /></svg>
          {t(k)}
        </span>
      ))}
    </div>
  )
}
