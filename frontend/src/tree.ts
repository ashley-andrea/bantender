import { LEVEL_RANK, fmtNum, fmtUnit } from './format'
import { tx, type Lang } from './i18n'
import type { Attribute, Level, PricedLine, SourceRow } from './types'

/** A row of the positions list: one position, or the virtual parent of its variants; with its children. */
export interface Entry {
  id: string // line id, or the variant group id ("g:<first line>")
  kind: 'line' | 'group'
  members: PricedLine[] // the line itself, or the variants
  children: Child[]
}
export interface Child {
  id: string
  line: PricedLine
  role: 'variant' | 'part'
}

export function buildTree(lines: PricedLine[]): Entry[] {
  const entries: Entry[] = []
  const byId = new Map<string, Entry>()
  const parts: PricedLine[] = []
  for (const l of lines) {
    const g = l.group
    if (g?.kind === 'part') {
      parts.push(l)
    } else if (g?.kind === 'variant') {
      let e = byId.get(g.id)
      if (!e) {
        e = { id: g.id, kind: 'group', members: [], children: [] }
        byId.set(g.id, e)
        entries.push(e)
      }
      e.members.push(l)
      e.children.push({ id: l.line_id, line: l, role: 'variant' })
    } else {
      const e: Entry = { id: l.line_id, kind: 'line', members: [l], children: [] }
      byId.set(l.line_id, e)
      entries.push(e)
    }
  }
  for (const p of parts) {
    const parent = byId.get((p.group as { parent: string }).parent)
    if (parent) parent.children.push({ id: p.line_id, line: p, role: 'part' })
    else entries.push({ id: p.line_id, kind: 'line', members: [p], children: [] })
  }
  return entries
}

export interface Selection {
  entry: Entry
  child: Child | null
}

export function resolve(tree: Entry[], id: string | null): Selection | null {
  if (!id) return null
  for (const e of tree) {
    if (e.id === id) return { entry: e, child: null }
    const c = e.children.find((x) => x.id === id)
    if (c) return { entry: e, child: c }
  }
  return null
}

/** The single line a selection prices (a child, or a plain position); null for a variant parent. */
export const selectedLine = (s: Selection | null) => (s ? (s.child ? s.child.line : s.entry.kind === 'line' ? s.entry.members[0] : null) : null)

export const entryTitle = (e: Entry, lang: Lang) => (lang === 'en' ? e.members[0].title_en : e.members[0].title_de)

/** Sum of the variants' quantities when they share a unit. */
export function entryQuantity(e: Entry, lang: Lang): string {
  const units = new Set(e.members.map((m) => m.decision.unit))
  if (units.size !== 1 || e.members.some((m) => m.decision.quantity == null)) return e.kind === 'group' ? `${e.members.length} ×` : '—'
  const q = e.members.reduce((s, m) => s + (m.decision.quantity ?? 0), 0)
  return `${fmtNum(q)} ${fmtUnit(e.members[0].decision.unit, lang)}`
}

// ---- graph model ----------------------------------------------------------------------------------

export interface ValueNode {
  key: string // unique within the graph
  label: string
  value: string
  level: Level
  sources: SourceRow[]
  why?: string
  page?: number
}
export interface GraphNode extends ValueNode {
  attrKey: string
  from: 'top' | 'mid'
  /** Set on a node that stands for several values (variants that differ, or the parts of an item). */
  values?: ValueNode[]
}
export interface GraphSpec {
  top: ValueNode // the type
  mid?: { label: string; sub: string; level: Level } // the selected variant or part
  nodes: GraphNode[]
}

const worst = (ls: Level[]): Level => ls.reduce<Level>((w, l) => (LEVEL_RANK[l] > LEVEL_RANK[w] ? l : w), 'read')
const SHORT: Record<string, { en: string; de: string }> = {
  quantity: { en: 'Qty', de: 'Menge' }, size: { en: 'Size', de: 'Grösse' }, airflow: { en: 'Airflow', de: 'Luft' },
  thickness: { en: 'Insul.', de: 'Dämm.' }, reference: { en: 'Make', de: 'Fabr.' }, system: { en: 'System', de: 'Anlage' },
  section: { en: 'Section', de: 'Abschn.' }, parts: { en: 'Parts', de: 'Teile' },
}
const short = (key: string, a: Attribute | undefined, lang: Lang) => SHORT[key]?.[lang] ?? (a ? tx(a.label, lang) : key)

function typeNode(lines: PricedLine[], lang: Lang): ValueNode {
  const attrs = lines.map((l) => l.attributes.find((a) => a.key === 'type')).filter(Boolean) as Attribute[]
  return {
    key: 'type', label: lang === 'en' ? 'Type' : 'Typ', value: lang === 'en' ? lines[0].title_en : lines[0].title_de,
    level: worst(attrs.map((a) => a.level)), sources: attrs.flatMap((a) => a.sources), why: attrs[0] ? tx(attrs[0].why, lang) : undefined,
  }
}

function valueOf(a: Attribute | undefined, lang: Lang) {
  return a ? tx(a.value, lang) || '—' : '—'
}

const pluralKey: Record<string, { en: string; de: string }> = {
  size: { en: 'sizes', de: 'Grössen' }, airflow: { en: 'airflows', de: 'Luftmengen' }, reference: { en: 'makes', de: 'Fabrikate' },
}

/** Attributes of several lines: one node where they agree, a grouped node where the variants differ. */
function mergedNodes(lines: PricedLine[], lang: Lang): { nodes: GraphNode[]; differing: Set<string> } {
  const keys: string[] = []
  for (const l of lines) for (const a of l.attributes) if (a.key !== 'type' && !keys.includes(a.key)) keys.push(a.key)
  const differing = new Set<string>()
  const nodes = keys.map((key): GraphNode => {
    const per = lines.map((l) => ({ line: l, a: l.attributes.find((x) => x.key === key) }))
    const vals = per.map((p) => valueOf(p.a, lang))
    const first = per.find((p) => p.a)?.a
    if (lines.length === 1 || vals.every((v) => v === vals[0])) {
      return {
        key, attrKey: key, from: 'top', label: short(key, first, lang), value: vals[0], level: worst(per.map((p) => p.a?.level ?? 'read')),
        sources: per.flatMap((p) => p.a?.sources ?? []), why: first ? tx(first.why, lang) : undefined,
      }
    }
    differing.add(key)
    const values = per.map((p, i): ValueNode => ({
      key: `${key}:${p.line.line_id}`, label: short(key, p.a, lang), value: vals[i], level: p.a?.level ?? 'missing',
      sources: p.a?.sources ?? [], why: p.a ? tx(p.a.why, lang) : undefined, page: p.line.page,
    }))
    let summary = `${new Set(vals).size} ${pluralKey[key]?.[lang] ?? (lang === 'en' ? 'values' : 'Werte')}`
    if (key === 'quantity') {
      const units = new Set(lines.map((l) => l.decision.unit))
      if (units.size === 1 && lines.every((l) => l.decision.quantity != null)) {
        summary = `${fmtNum(lines.reduce((s, l) => s + (l.decision.quantity ?? 0), 0))} ${fmtUnit(lines[0].decision.unit, lang)}`
      }
    }
    return { key, attrKey: key, from: 'top', label: short(key, first, lang), value: summary, level: worst(values.map((v) => v.level)),
      sources: values.flatMap((v) => v.sources), values }
  })
  return { nodes, differing }
}

function partsNode(entry: Entry, lang: Lang): GraphNode | null {
  const parts = entry.children.filter((c) => c.role === 'part')
  if (!parts.length) return null
  const values = parts.map((c): ValueNode => {
    const t = c.line.attributes.find((a) => a.key === 'type')
    return { key: `parts:${c.id}`, label: short('parts', undefined, lang), value: lang === 'en' ? c.line.title_en : c.line.title_de,
      level: t?.level ?? 'read', sources: t?.sources ?? [], page: c.line.page }
  })
  return { key: 'parts', attrKey: 'parts', from: 'top', label: short('parts', undefined, lang), value: `${parts.length}`,
    level: worst(values.map((v) => v.level)), sources: values.flatMap((v) => v.sources), values }
}

/** Graph of a selection: the parent's type on top; for a child, the child in the middle with its own values. */
export function graphOf(sel: Selection, lang: Lang): GraphSpec {
  const { entry, child } = sel
  const top = typeNode(entry.members, lang)
  if (!child) {
    const { nodes } = mergedNodes(entry.members, lang)
    const parts = partsNode(entry, lang)
    return { top, nodes: parts ? [...nodes, parts] : nodes }
  }
  const line = child.line
  if (child.role === 'part') {
    const own = mergedNodes([line], lang).nodes.map((n) => ({ ...n, from: 'mid' as const }))
    return { top, mid: { label: lang === 'en' ? 'Part' : 'Teil', sub: lang === 'en' ? line.title_en : line.title_de, level: 'read' }, nodes: own }
  }
  // A variant: what the variants share hangs off the parent, what makes this one different off the variant.
  const { differing } = mergedNodes(entry.members, lang)
  const own = mergedNodes([line], lang).nodes.map((n) => ({ ...n, from: differing.has(n.attrKey) ? ('mid' as const) : ('top' as const) }))
  const sub = own.filter((n) => n.from === 'mid').map((n) => n.value).join(' · ')
  const idx = (line.group as { index: number; count: number })
  return {
    top, nodes: own,
    mid: { label: `${idx.index + 1} / ${idx.count}`, sub: `${lang === 'en' ? 'Variant' : 'Variante'} · ${sub}`, level: worst(own.filter((n) => n.from === 'mid').map((n) => n.level)) },
  }
}
