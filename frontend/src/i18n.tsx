import { createContext, useContext, useState, type ReactNode } from 'react'
import type { PricedLine, SystemInfo } from './types'

export type Lang = 'en' | 'de'

const STRINGS = {
  // upload
  tagline: { en: 'From tender to filled-in offer', de: 'Von der Ausschreibung zur ausgefüllten Offerte' },
  subline: {
    en: 'Upload the tender PDF. Positions are read, priced from the catalogue and written back into the original document.',
    de: 'Ausschreibung als PDF hochladen. Positionen werden gelesen, aus dem Katalog bepreist und ins Originaldokument geschrieben.',
  },
  dropHere: { en: 'Drop the tender PDF here', de: 'Ausschreibungs-PDF hier ablegen' },
  choosePdf: { en: 'Choose file', de: 'Datei wählen' },
  reading: { en: 'Reading the PDF', de: 'PDF wird gelesen' },
  recent: { en: 'Recent tenders', de: 'Letzte Ausschreibungen' },
  pages: { en: 'pages', de: 'Seiten' },
  positions: { en: 'positions', de: 'Positionen' },
  // steps
  step1: { en: 'Extraction', de: 'Erfassung' },
  step2: { en: 'Catalogue', de: 'Katalog' },
  step3: { en: 'Price', de: 'Preis' },
  step4: { en: 'Offer options', de: 'Varianten' },
  step5: { en: 'Export', de: 'Export' },
  back: { en: 'Back', de: 'Zurück' },
  // extraction
  search: { en: 'Search', de: 'Suchen' },
  read: { en: 'Read', de: 'Gelesen' },
  derived: { en: 'Derived', de: 'Abgeleitet' },
  assumed: { en: 'Assumed', de: 'Angenommen' },
  missing: { en: 'Missing', de: 'Fehlt' },
  'n/a': { en: 'Not needed', de: 'Nicht nötig' },
  fromCad: { en: 'CAD list', de: 'Bauteilliste' },
  // catalogue
  noProduct: { en: 'No catalogue product: included elsewhere or no quantity.', de: 'Kein Katalogprodukt: anderweitig enthalten oder keine Menge.' },
  supplierQuote: { en: 'Supplier quote needed', de: 'Lieferantenofferte nötig' },
  quotePrice: { en: 'Quoted net price', de: 'Offerierter Nettopreis' },
  save: { en: 'Save', de: 'Speichern' },
  reset: { en: 'Reset', de: 'Zurücksetzen' },
  netPrice: { en: 'Net', de: 'Netto' },
  listPrice: { en: 'List', de: 'Liste' },
  discount: { en: 'Discount', de: 'Rabatt' },
  awaitQuote: { en: 'need a supplier quote', de: 'brauchen eine Lieferantenofferte' },
  // price
  quantity: { en: 'Quantity', de: 'Menge' },
  hoursPerUnit: { en: 'Hours per unit', de: 'Stunden je Einheit' },
  unitPrice: { en: 'Unit price', de: 'Einheitspreis' },
  amount: { en: 'Amount', de: 'Betrag' },
  included: { en: 'incl.', de: 'inkl.' },
  includedNote: { en: 'Included in another position', de: 'In anderer Position enthalten' },
  cadNote: { en: 'Priced in the material list row of its system', de: 'Im Materialauszug der Anlage enthalten' },
  edit: { en: 'Correct this value', de: 'Wert korrigieren' },
  parameters: { en: 'Parameters', de: 'Parameter' },
  resetAll: { en: 'Reset all', de: 'Alle zurücksetzen' },
  undo: { en: 'Back to the company value', de: 'Zurück zum Firmenwert' },
  stepsTitle: { en: 'From net price to unit price', de: 'Vom Nettopreis zum Einheitspreis' },
  stepNet: { en: 'Catalogue net price', de: 'Katalog-Nettopreis' },
  labour: { en: 'Installation', de: 'Montage' },
  labourInE: { en: 'goes to section E (installation), as the form asks', de: 'steht in Abschnitt E (Montage), wie im Formular verlangt' },
  factorM: { en: 'factor', de: 'Faktor' },
  factorWhy: { en: 'project costs, overhead, risk, margin', de: 'Projektkosten, Gemeinkosten, Risiko, Marge' },
  offerPrice: { en: 'Offer price', de: 'Angebotspreis' },
  directCost: { en: 'Direct cost', de: 'Direkte Kosten' },
  overheadRisk: { en: 'Overhead and risk', de: 'Gemeinkosten und Risiko' },
  margin: { en: 'Margin', de: 'Marge' },
  gFactors: { en: 'Productivity', de: 'Leistung' },
  gAllowances: { en: 'Allowances', de: 'Zuschläge' },
  gProject: { en: 'Project costs', de: 'Projektkosten' },
  gCommercial: { en: 'Commercial', de: 'Kommerziell' },
  gLocations: { en: 'Mounting height by system', de: 'Montagehöhe je Anlage' },
  // offer options (AI, placeholder)
  aiTitle: { en: 'Offer options', de: 'Angebotsvarianten' },
  aiBody: {
    en: 'More aggressive and more conservative offers, each with its estimated chance of winning. Coming with the AI module.',
    de: 'Aggressivere und vorsichtigere Angebote, je mit geschätzter Zuschlagschance. Folgt mit dem KI-Modul.',
  },
  aiButton: { en: 'Generate options', de: 'Varianten erzeugen' },
  aiAggressive: { en: 'Aggressive', de: 'Aggressiv' },
  aiConservative: { en: 'Conservative', de: 'Vorsichtig' },
  currentOffer: { en: 'Current', de: 'Aktuell' },
  // export
  filledPages: { en: 'Filled pages', de: 'Ausgefüllte Seiten' },
  fields: { en: 'fields', de: 'Felder' },
  notFilled: { en: 'Left for you', de: 'Für Sie offen' },
  notFilledBody: {
    en: 'Company details, signatures, change-order rate sheets (pp. 4–6) and make/model declarations.',
    de: 'Firmenangaben, Unterschriften, Einheitspreise für Mehr-/Minderkosten (S. 4–6) und Fabrikat/Typ.',
  },
  conditions: { en: 'Conditions', de: 'Konditionen' },
  download: { en: 'Download PDF', de: 'PDF herunterladen' },
  cGross: { en: 'Gross', de: 'Brutto' },
  cashDiscount: { en: 'Cash discount', de: 'Skonto' },
  cDeductions: { en: 'Deductions', de: 'Abzüge' },
  cVat: { en: 'VAT', de: 'MWST' },
  cNet: { en: 'Net incl. VAT', de: 'Netto inkl. MWST' },
  pConditions: { en: 'Offer total and conditions', de: 'Angebotssumme und Konditionen' },
  pSummary: { en: 'Cost summary', de: 'Kostenzusammenstellung' },
  pSystemSummary: { en: 'cost summary', de: 'Kostenzusammenstellung' },
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

/** Text from the API: a plain string or {en, de}. */
export function tx(v: string | { en: string; de: string } | null | undefined, lang: Lang): string {
  if (v == null) return ''
  return typeof v === 'string' ? v : v[lang] || v.en
}

export const lineTitle = (l: PricedLine, lang: Lang) => (lang === 'en' ? l.title_en : l.title_de)
export const sectionName = (l: PricedLine, lang: Lang) => (lang === 'en' ? l.section_name_en || l.section_name : l.section_name)
export const systemName = (s: SystemInfo | undefined, lang: Lang) => (s ? (lang === 'en' ? s.name_en || s.name : s.name) : '')

export function humanize(key: string) {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export const PARAM_LABELS: Record<string, { en: string; de: string }> = {
  site_efficiency: { en: 'Site efficiency', de: 'Baustelleneffizienz' },
  school_logistics: { en: 'School logistics', de: 'Logistik Schulhaus' },
  mounting_height_school: { en: 'Height, school', de: 'Höhe Schulhaus' },
  mounting_height_sports_hall: { en: 'Height, sports hall', de: 'Höhe Turnhalle' },
  timber_interface: { en: 'Timber interface', de: 'Schnittstelle Holzbau' },
  material_waste_pct: { en: 'Material waste', de: 'Verschnitt' },
  small_material_pct: { en: 'Small material', de: 'Kleinmaterial' },
  transport_equipment_pct: { en: 'Transport', de: 'Transport' },
  supplier_package_contingency_pct: { en: 'Supplier reserve', de: 'Reserve Lieferanten' },
  engineering_hours: { en: 'Engineering', de: 'Engineering' },
  engineering_rate_chf_per_h: { en: 'Engineering rate', de: 'Ansatz Engineering' },
  commissioning_hours: { en: 'Commissioning', de: 'Inbetriebnahme' },
  commissioning_rate_chf_per_h: { en: 'Commissioning rate', de: 'Ansatz Inbetriebnahme' },
  hygiene_inspection_chf: { en: 'Hygiene inspection', de: 'Hygieneprüfung' },
  documentation_chf: { en: 'Documentation', de: 'Dokumentation' },
  overhead_pct: { en: 'Overhead', de: 'Gemeinkosten' },
  margin_pct: { en: 'Margin', de: 'Marge' },
  risk_allowance_chf: { en: 'Risk', de: 'Risiko' },
}

export const LOCATION_LABEL: Record<string, { en: string; de: string }> = {
  default: { en: 'Standard', de: 'Standard' },
  school: { en: 'School', de: 'Schulhaus' },
  sports_hall: { en: 'Sports hall', de: 'Turnhalle' },
}

export function LangToggle({ dark }: { dark?: boolean }) {
  const { lang, setLang } = useI18n()
  return (
    <div className={`inline-flex rounded-md p-0.5 text-[12px] font-semibold ${dark ? 'bg-white/10' : 'bg-hair/60'}`}>
      {(['en', 'de'] as Lang[]).map((l) => (
        <button key={l} onClick={() => setLang(l)}
          className={`px-2 py-0.5 rounded uppercase ${lang === l ? (dark ? 'bg-white text-navy' : 'bg-surface text-ink') : dark ? 'text-white/70' : 'text-muted'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}
