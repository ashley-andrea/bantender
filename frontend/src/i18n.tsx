import { createContext, useContext, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'de'

const STRINGS = {
  // app
  tagline: { en: 'From tender to first price.', de: 'Von der Ausschreibung zum ersten Preis.' },
  subline: {
    en: 'Drop a tender PDF. Every line, quantity and price stays linked to the page it came from.',
    de: 'Ausschreibung als PDF ablegen. Jede Position, Menge und jeder Preis bleibt mit der Quellseite verknüpft.',
  },
  dropHere: { en: 'Drop the tender PDF here', de: 'Ausschreibungs-PDF hier ablegen' },
  orClick: { en: 'or click to choose a file', de: 'oder klicken, um eine Datei zu wählen' },
  choosePdf: { en: 'Choose PDF', de: 'PDF wählen' },
  recent: { en: 'Recent tenders', de: 'Letzte Ausschreibungen' },
  open: { en: 'Open', de: 'Öffnen' },
  stageUpload: { en: 'Uploading tender', de: 'Ausschreibung hochladen' },
  stageRead: { en: 'Reading every page', de: 'Alle Seiten lesen' },
  stageLines: { en: 'Finding priceable lines', de: 'Kalkulierbare Positionen finden' },
  stageFlags: { en: 'Checking for red flags', de: 'Auf Unstimmigkeiten prüfen' },
  deterministic: { en: 'Deterministic parsing, no AI involved.', de: 'Regelbasierte Auswertung, ohne KI.' },
  pages: { en: 'Pages', de: 'Seiten' },
  systems: { en: 'Systems', de: 'Anlagen' },
  linesFound: { en: 'Lines found', de: 'Positionen' },
  redFlags: { en: 'Red flags', de: 'Unstimmigkeiten' },
  // workspace
  tabLines: { en: 'Lines', de: 'Positionen' },
  tabPrice: { en: 'Price build-up', de: 'Preisaufbau' },
  indicativePrice: { en: 'Indicative price', de: 'Richtpreis' },
  priced: { en: 'Priced', de: 'Kalkuliert' },
  needsPrice: { en: 'Need a price', de: 'Ohne Preis' },
  allLots: { en: 'All lots', de: 'Alle Lose' },
  lot: { en: 'Lot', de: 'Los' },
  allSources: { en: 'All lines', de: 'Alle Zeilen' },
  tenderLines: { en: 'Tender lines', de: 'LV-Positionen' },
  cadLines: { en: 'From CAD lists', de: 'Aus Bauteilliste' },
  pricedOf: { en: 'priced', de: 'kalkuliert' },
  ofLines: { en: 'of', de: 'von' },
  linesToPrice: { en: 'tender lines priced', de: 'LV-Positionen kalkuliert' },
  calculatedWord: { en: 'calculated', de: 'berechnet' },
  provisionalWord: { en: 'provisional', de: 'provisorisch' },
  unpricedWord: { en: 'unpriced', de: 'ohne Preis' },
  excludedWord: { en: 'excluded', de: 'ausgeschlossen' },
  statusHelp: {
    en: 'Calculated: priced with no open question. Provisional: priced, but a supplier quote, an assumption or a review is still open. Unpriced: no catalogue item or no quantity yet. Excluded lines (covered elsewhere or not priceable) are not counted.',
    de: 'Berechnet: kalkuliert, keine offene Frage. Provisorisch: kalkuliert, aber Offerte, Annahme oder Prüfung offen. Ohne Preis: kein Katalogartikel oder keine Menge. Ausgeschlossene Positionen werden nicht gezählt.',
  },
  atMargin: { en: 'at', de: 'bei' },
  marginWord: { en: 'margin', de: 'Marge' },
  lineCost: { en: 'line cost', de: 'Positionskosten' },
  bySystemNote: { en: 'Direct line costs (material + labour), before allowances, overhead and margin.', de: 'Direkte Positionskosten (Material + Montage), vor Zuschlägen, Gemeinkosten und Marge.' },
  chooseProduct: { en: 'Choose a catalogue product', de: 'Katalogprodukt wählen' },
  searchCatalog: { en: 'Search catalogue, e.g. valve DN160', de: 'Katalog durchsuchen, z.B. Ventil DN160' },
  invalidNumber: { en: 'Enter a number, e.g. 12.5', de: 'Zahl eingeben, z.B. 12.5' },
  loading: { en: 'Loading tender…', de: 'Ausschreibung wird geladen…' },
  mountingHeight: { en: 'Mounting height per system', de: 'Montagehöhe pro Anlage' },
  noLines: { en: 'No lines match these filters.', de: 'Keine Positionen für diese Filter.' },
  awardMissing: { en: 'The tender states no price-scoring rule.', de: 'Die Ausschreibung nennt keine Preisbewertung.' },
  search: { en: 'Search, e.g. valve, DN160, 78', de: 'Suchen, z.B. Tellerventil, DN160, 78' },
  linesShown: { en: 'lines shown · ↑↓ to move', de: 'Positionen · ↑↓ zum Wechseln' },
  colLine: { en: 'Line', de: 'Pos.' },
  colItem: { en: 'Item', de: 'Gegenstand' },
  colQty: { en: 'Qty', de: 'Menge' },
  colUnit: { en: 'Unit', de: 'Einh.' },
  colProduct: { en: 'Product', de: 'Produkt' },
  colChf: { en: 'CHF', de: 'CHF' },
  colStatus: { en: 'Status', de: 'Status' },
  fromCad: { en: 'from CAD list', de: 'aus Bauteilliste' },
  whyPrice: { en: 'Why this price', de: 'Warum dieser Preis' },
  checks: { en: 'Checks', de: 'Prüfungen' },
  calculation: { en: 'Calculation', de: 'Berechnung' },
  assumptions: { en: 'Assumptions', de: 'Annahmen' },
  tenderText: { en: 'Tender text (German original)', de: 'Ausschreibungstext' },
  alternatives: { en: 'Alternatives', de: 'Alternativen' },
  use: { en: 'Use', de: 'Übernehmen' },
  confirm: { en: 'Confirm', de: 'Bestätigen' },
  setPrice: { en: 'Set unit price', de: 'Einheitspreis setzen' },
  labourOnly: { en: 'Labour only', de: 'Nur Montage' },
  exclude: { en: 'Exclude', de: 'Ausschliessen' },
  reset: { en: 'Reset', de: 'Zurücksetzen' },
  editQty: { en: 'Quantity', de: 'Menge' },
  save: { en: 'Save', de: 'Speichern' },
  edited: { en: 'edited', de: 'geändert' },
  material: { en: 'Material', de: 'Material' },
  labour: { en: 'Labour', de: 'Montage' },
  direct: { en: 'Direct cost', de: 'Direkte Kosten' },
  notPriced: { en: 'Not priced', de: 'Nicht kalkuliert' },
  confidence: { en: 'Confidence', de: 'Sicherheit' },
  pageWord: { en: 'p.', de: 'S.' },
  // price build-up
  buildUp: { en: 'From lines to selling price', de: 'Von den Positionen zum Verkaufspreis' },
  parameters: { en: 'Parameters', de: 'Parameter' },
  margin: { en: 'Target margin', de: 'Zielmarge' },
  risk: { en: 'Risk allowance (CHF)', de: 'Risikozuschlag (CHF)' },
  siteEfficiency: { en: 'Site efficiency', de: 'Baustelleneffizienz' },
  includeCad: { en: 'Include ductwork from CAD lists', de: 'Kanäle aus Bauteilliste einrechnen' },
  includeProject: { en: 'Include project costs', de: 'Projektkosten einrechnen' },
  scenarios: { en: 'Recommended bid range', de: 'Empfohlene Angebotsspanne' },
  winProb: { en: 'Win probability', de: 'Zuschlagschance' },
  contribution: { en: 'Expected contribution', de: 'Erwarteter Deckungsbeitrag' },
  awardTitle: { en: 'Award points for price', de: 'Preispunkte gemäss Ausschreibung' },
  placeholderModel: { en: 'Win model supplied by Equans (placeholder).', de: 'Zuschlagsmodell von Equans (Platzhalter).' },
  bySystem: { en: 'By system', de: 'Nach Anlage' },
  close: { en: 'Close', de: 'Schliessen' },
  flagsIntro: {
    en: 'Inconsistencies found in the tender itself. Each one links to its page.',
    de: 'In der Ausschreibung gefundene Unstimmigkeiten, jeweils mit Seitenverweis.',
  },
} as const

export type Key = keyof typeof STRINGS

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => {} })

function initialLang(): Lang {
  try {
    return localStorage.getItem('lang') === 'de' ? 'de' : 'en'
  } catch {
    return 'en'
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const setLang = (l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem('lang', l)
    } catch {
      /* storage unavailable: keep in memory */
    }
  }
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>
}

export function useI18n() {
  const { lang, setLang } = useContext(LangContext)
  const t = (k: Key) => STRINGS[k][lang]
  return { lang, setLang, t }
}

/** Text from the API: either a plain string or {en, de}. */
export function tx(v: string | { en: string; de: string } | null | undefined, lang: Lang): string {
  if (v == null) return ''
  return typeof v === 'string' ? v : v[lang] || v.en
}

export function awardNote(a: { weight: number; total_points: number; zero_at_ratio: number; points_per_pct: number; page: number }, lang: Lang) {
  const zero = Math.round(a.zero_at_ratio * 100)
  const per = a.points_per_pct.toLocaleString(lang === 'de' ? 'de-CH' : 'en-GB', { maximumFractionDigits: 2 })
  return lang === 'de'
    ? `Der Preis zählt ${a.weight} von ${a.total_points} Punkten: volle Punktzahl beim tiefsten Angebot, 0 bei ${zero} % davon. Jedes 1 % über dem tiefsten Angebot kostet ${per} Punkte (Ausschreibung S. ${a.page}).`
    : `Price is worth ${a.weight} of ${a.total_points} points: full points at the lowest offer, 0 at ${zero} % of it. Each 1 % above the lowest offer costs ${per} points (tender p.${a.page}).`
}

export function humanize(key: string) {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export const FLAG_LABELS: Record<string, { en: string; de: string }> = {
  header_system_mismatch: { en: 'Page header mislabelled', de: 'Seitenkopf falsch beschriftet' },
  implausible_size: { en: 'Implausible size', de: 'Unplausible Grösse' },
  reader_disagreement: { en: 'Readers disagree', de: 'Leser uneinig' },
  quantity_missing: { en: 'Quantity missing', de: 'Menge fehlt' },
}

export const SECTION_EN: Record<string, string> = {
  Apparate: 'Equipment', 'Kanäle': 'Ductwork', 'Armaturen und Instrumente': 'Fittings and instruments', Regulierung: 'Controls',
  'Montage, Dienstleistungen': 'Installation and services', 'Dämmungen': 'Insulation',
}

export function LangToggle() {
  const { lang, setLang } = useI18n()
  return (
    <div className="inline-flex rounded-[9px] bg-[#e8e8ed] p-0.5 text-[12px] font-semibold">
      {(['en', 'de'] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2.5 py-1 rounded-[7px] uppercase ${lang === l ? 'bg-surface shadow-sm text-ink' : 'text-muted'}`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

export const STATUS_META: Record<string, { en: string; de: string; tone: string }> = {
  calculated: { en: 'Calculated', de: 'Berechnet', tone: 'bg-good/12 text-[#078a57]' },
  supplier_quote_required: { en: 'Supplier quote', de: 'Offerte nötig', tone: 'bg-warn/15 text-[#b36b00]' },
  assumption_applied: { en: 'Assumption', de: 'Annahme', tone: 'bg-sel/10 text-sel' },
  review_required: { en: 'Review', de: 'Prüfen', tone: 'bg-brand/20 text-[#8a6500]' },
  needs_price: { en: 'Needs price', de: 'Preis fehlt', tone: 'bg-bad/10 text-bad' },
  insufficient_information: { en: 'Missing info', de: 'Angaben fehlen', tone: 'bg-bad/10 text-bad' },
  out_of_scope: { en: 'Excluded', de: 'Nicht im Umfang', tone: 'bg-[#e8e8ed] text-muted' },
  non_priceable: { en: 'Not priced', de: 'Nicht kalkuliert', tone: 'bg-[#e8e8ed] text-muted' },
}
