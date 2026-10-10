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
// One graph per parent. Closed: the parent's values. Open (a value clicked, or a child picked in the list): every
// value the children have differently gets their own values hanging under it, one small node per child.

export interface ValueNode {
  key: string // unique within the graph
  label: string
  value: string
  level: Level
  sources: SourceRow[]
  why?: string
  page?: number
}
/** One child's own value under a parent value. */
export interface SubValue extends ValueNode {
  childId: string
  index: number // 1-based, in list order
  selected: boolean
}
export interface AttrNode extends ValueNode {
  attrKey: string
  subs?: SubValue[] // set when the children differ here
}
export interface GraphSpec {
  top: ValueNode // the type
  typeSubs?: SubValue[] // parts: their own type next to the parent's
  nodes: AttrNode[]
  product?: AttrNode // catalogue step
  hours?: AttrNode
  open: boolean // a child is selected: show every child-specific value
}

const worst = (ls: Level[]): Level => ls.reduce<Level>((w, l) => (LEVEL_RANK[l] > LEVEL_RANK[w] ? l : w), 'read')
const SHORT: Record<string, { en: string; de: string }> = {
  quantity: { en: 'Qty', de: 'Menge' }, size: { en: 'Size', de: 'Grösse' }, airflow: { en: 'Airflow', de: 'Luft' },
  thickness: { en: 'Insul.', de: 'Dämm.' }, reference: { en: 'Make', de: 'Fabr.' }, system: { en: 'System', de: 'Anlage' },
  section: { en: 'Section', de: 'Abschn.' }, product: { en: 'Product', de: 'Produkt' }, hours: { en: 'Install', de: 'Montage' },
}
const short = (key: string, a: Attribute | undefined, lang: Lang) => SHORT[key]?.[lang] ?? (a ? tx(a.label, lang) : key)
const valueOf = (a: Attribute | undefined, lang: Lang) => (a ? tx(a.value, lang) || '—' : '—')
const plural: Record<string, { en: string; de: string }> = {
  size: { en: 'sizes', de: 'Grössen' }, airflow: { en: 'airflows', de: 'Luftmengen' }, reference: { en: 'makes', de: 'Fabrikate' },
}
const title = (l: PricedLine, lang: Lang) => (lang === 'en' ? l.title_en : l.title_de)

/** The parent's value for a key: the line's own, or what its variants share (a sum or a count where they differ). */
function parentValue(lines: PricedLine[], key: string, lang: Lang): { value: string; level: Level; sources: SourceRow[]; why?: string; attr?: Attribute } {
  const per = lines.map((l) => l.attributes.find((x) => x.key === key))
  const vals = per.map((a) => valueOf(a, lang))
  const first = per.find(Boolean)
  const level = worst(per.map((a) => a?.level ?? 'read'))
  const sources = per.flatMap((a) => a?.sources ?? [])
  if (vals.every((v) => v === vals[0])) return { value: vals[0], level, sources, why: first ? tx(first.why, lang) : undefined, attr: first }
  if (key === 'quantity' && new Set(lines.map((l) => l.decision.unit)).size === 1 && lines.every((l) => l.decision.quantity != null)) {
    return { value: `${fmtNum(lines.reduce((s, l) => s + (l.decision.quantity ?? 0), 0))} ${fmtUnit(lines[0].decision.unit, lang)}`, level, sources, attr: first }
  }
  return { value: `${new Set(vals).size} ${plural[key]?.[lang] ?? (lang === 'en' ? 'values' : 'Werte')}`, level, sources, attr: first }
}

function subsFor(sel: Selection, key: string, parent: string, get: (l: PricedLine) => { value: string; level: Level; sources: SourceRow[]; why?: string } | null, label: string): SubValue[] | undefined {
  const kids = sel.entry.children.map((c, i) => ({ c, i, v: get(c.line) })).filter((k) => k.v)
  if (!kids.length || kids.every((k) => k.v!.value === parent)) return undefined
  return kids.map((k) => ({ key: `${key}:${k.c.id}`, childId: k.c.id, index: k.i + 1, label, ...k.v!, page: k.c.line.page, selected: sel.child?.id === k.c.id }))
}

export function graphOf(sel: Selection, lang: Lang): GraphSpec {
  const parents = sel.entry.members
  const typeAttrs = parents.map((l) => l.attributes.find((a) => a.key === 'type')).filter(Boolean) as Attribute[]
  const top: ValueNode = {
    key: 'type', label: lang === 'en' ? 'Type' : 'Typ', value: title(parents[0], lang), level: worst(typeAttrs.map((a) => a.level)),
    sources: typeAttrs.flatMap((a) => a.sources), why: typeAttrs[0] ? tx(typeAttrs[0].why, lang) : undefined,
  }
  const typeSubs = subsFor(sel, 'type', top.value, (l) => {
    const a = l.attributes.find((x) => x.key === 'type')
    return { value: title(l, lang), level: a?.level ?? 'read', sources: a?.sources ?? [], why: a ? tx(a.why, lang) : undefined }
  }, top.label)

  const keys: string[] = []
  for (const l of [...parents, ...sel.entry.children.map((c) => c.line)]) for (const a of l.attributes) if (a.key !== 'type' && !keys.includes(a.key)) keys.push(a.key)
  const nodes = keys.map((key): AttrNode => {
    const p = parentValue(parents, key, lang)
    const label = short(key, p.attr, lang)
    const subs = subsFor(sel, key, p.value, (l) => {
      const a = l.attributes.find((x) => x.key === key)
      return a ? { value: valueOf(a, lang), level: a.level, sources: a.sources, why: tx(a.why, lang) } : null
    }, label)
    return { key, attrKey: key, label, value: p.value, level: p.level, sources: p.sources, why: p.why, subs }
  })

  // Catalogue: the product and the installation time, with the children's own where they differ.
  const prod = (l: PricedLine) => (l.decision.product_id && l.cost ? { value: `${l.decision.product_id} · ${fmtNum(l.cost.net_unit_cost)}`, level: 'read' as Level, sources: [] } : null)
  const hrs = (l: PricedLine) => (l.cost && l.decision.install_code ? { value: `${fmtNum(l.cost.base_hours)} h`, level: 'read' as Level, sources: [] } : null)
  type Got = { value: string; level: Level; sources: SourceRow[] }
  const merged = (get: (l: PricedLine) => Got | null, key: string): AttrNode | undefined => {
    const vals = parents.map(get).filter(Boolean) as Got[]
    if (!vals.length) return undefined
    const same = vals.every((v) => v.value === vals[0].value)
    const n = new Set(vals.map((v) => v.value)).size
    const value = same ? vals[0].value : `${n} ${key === 'product' ? (lang === 'en' ? 'products' : 'Produkte') : lang === 'en' ? 'values' : 'Werte'}`
    const label = SHORT[key][lang]
    return { key, attrKey: key, label, value, level: 'read', sources: [], subs: subsFor(sel, key, value, get, label) }
  }
  return { top, typeSubs, nodes, product: merged(prod, 'product'), hours: merged(hrs, 'hours'), open: !!sel.child }
}

/** Any node by key: the type, a value, a child's own value, the product or the hours. */
export function findNode(spec: GraphSpec, key: string | null): ValueNode | null {
  if (!key) return null
  const all: AttrNode[] = [...spec.nodes, ...(spec.product ? [spec.product] : []), ...(spec.hours ? [spec.hours] : [])]
  if (key === 'type') return spec.top
  for (const s of spec.typeSubs ?? []) if (s.key === key) return s
  for (const n of all) {
    if (n.key === key) return n
    const v = n.subs?.find((x) => x.key === key)
    if (v) return v
  }
  return null
}
