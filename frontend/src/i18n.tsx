import { createContext, useContext, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'de'

const STRINGS = {
  // upload
  tagline: { en: 'From tender to filled-in offer.', de: 'Von der Ausschreibung zur ausgefüllten Offerte.' },
  subline: {
    en: 'Drop the tender PDF. Every position is read, priced from your catalogue and written back into the original LV — each number traceable to its source.',
    de: 'Ausschreibung als PDF ablegen. Jede Position wird gelesen, aus Ihrem Katalog bepreist und ins Original-LV zurückgeschrieben — jede Zahl mit Quelle.',
  },
  dropHere: { en: 'Drop the tender PDF here', de: 'Ausschreibungs-PDF hier ablegen' },
  orClick: { en: 'or click to choose a file', de: 'oder klicken, um eine Datei zu wählen' },
  choosePdf: { en: 'Choose PDF', de: 'PDF wählen' },
  recent: { en: 'Recent tenders', de: 'Letzte Ausschreibungen' },
  open: { en: 'Open', de: 'Öffnen' },
  pages: { en: 'pages', de: 'Seiten' },
  positions: { en: 'positions', de: 'Positionen' },
  // steps
  step1: { en: 'Extraction', de: 'Erfassung' },
  step2: { en: 'Catalogue', de: 'Katalog' },
  step3: { en: 'Price', de: 'Preis' },
  step4: { en: 'Offer options', de: 'Angebotsvarianten' },
  step5: { en: 'Fill & export', de: 'Ausfüllen & Export' },
  step1Hint: { en: 'What the tender asks for, read straight from the PDF', de: 'Was die Ausschreibung verlangt, direkt aus dem PDF gelesen' },
  step2Hint: { en: 'Each position connected to its net price in your catalogue', de: 'Jede Position mit ihrem Nettopreis aus Ihrem Katalog verbunden' },
  step3Hint: { en: 'The formula applied, with every parameter adjustable', de: 'Die Formel angewendet, jeder Parameter einstellbar' },
  step4Hint: { en: 'AI-generated offer variants (in development)', de: 'KI-generierte Angebotsvarianten (in Entwicklung)' },
  step5Hint: { en: 'Prices written into the original LV, ready to send', de: 'Preise ins Original-LV geschrieben, bereit zum Versand' },
  back: { en: 'Back', de: 'Zurück' },
  // extraction animation
  reading: { en: 'Reading page', de: 'Lese Seite' },
  found: { en: 'positions found', de: 'Positionen gefunden' },
  skip: { en: 'Skip', de: 'Überspringen' },
  // lists and panels
  search: { en: 'Search positions', de: 'Positionen suchen' },
  certainty: { en: 'Certainty', de: 'Sicherheit' },
  high: { en: 'read directly', de: 'direkt gelesen' },
  medium: { en: 'derived', de: 'abgeleitet' },
  low: { en: 'assumed', de: 'angenommen' },
  clickNode: { en: 'Hover or click a node to see its source in the PDF.', de: 'Knoten anfahren oder anklicken, um die Quelle im PDF zu sehen.' },
  fromCad: { en: 'from CAD component list', de: 'aus der Bauteilliste' },
  family: { en: 'Same family in your catalogue', de: 'Gleiche Familie im Katalog' },
  matchedBecause: { en: 'Matched because', de: 'Zugeordnet, weil' },
  netPrice: { en: 'Net price', de: 'Nettopreis' },
  listPrice: { en: 'List', de: 'Liste' },
  discount: { en: 'Discount', de: 'Rabatt' },
  noProduct: { en: 'No catalogue product (included elsewhere or no quantity).', de: 'Kein Katalogprodukt (anderweitig enthalten oder keine Menge).' },
  supplierQuote: { en: 'Supplier quote', de: 'Lieferantenofferte' },
  supplierNote: {
    en: 'Placeholder price from the catalogue. Enter the supplier’s net price when the quote arrives.',
    de: 'Richtpreis aus dem Katalog. Nettopreis der Lieferantenofferte eintragen, sobald sie vorliegt.',
  },
  enterQuote: { en: 'Quoted net price', de: 'Offerierter Nettopreis' },
  save: { en: 'Save', de: 'Speichern' },
  reset: { en: 'Reset', de: 'Zurücksetzen' },
  // pricing
  material: { en: 'Material', de: 'Material' },
  labour: { en: 'Installation', de: 'Montage' },
  lineCost: { en: 'Direct cost', de: 'Direkte Kosten' },
  onTheForm: { en: 'On the offer form', de: 'Im Angebotsformular' },
  unitPrice: { en: 'Unit price', de: 'Einheitspreis' },
  amount: { en: 'Amount', de: 'Betrag' },
  markup: { en: 'Surcharge factor', de: 'Zuschlagsfaktor' },
  markupWhy: {
    en: 'Project costs, overhead, risk and margin are included in the unit prices (SIA 118 Art. 39), with one factor for all positions.',
    de: 'Projektkosten, Gemeinkosten, Risiko und Marge sind in den Einheitspreisen enthalten (SIA 118 Art. 39), mit einem Faktor für alle Positionen.',
  },
  labourInE: { en: 'Installation is entered in section E "Montage und Transport" of this system.', de: 'Die Montage steht in Abschnitt E «Montage und Transport» dieser Anlage.' },
  parameters: { en: 'Parameters', de: 'Parameter' },
  offerPrice: { en: 'Offer price', de: 'Angebotspreis' },
  buildUp: { en: 'From positions to offer price', de: 'Von den Positionen zum Angebotspreis' },
  // offers (AI)
  aiTitle: { en: 'Offer options', de: 'Angebotsvarianten' },
  aiBody: {
    en: 'Here the AI loop will propose more aggressive and more conservative offers, predict the acceptance probability of each from historical bids, and explain the trade-offs. Your choice feeds future predictions.',
    de: 'Hier schlägt die KI-Schleife aggressivere und vorsichtigere Angebote vor, schätzt die Zuschlagswahrscheinlichkeit aus historischen Offerten und erklärt die Abwägungen. Ihre Wahl fliesst in künftige Prognosen ein.',
  },
  aiButton: { en: 'Generate other offers', de: 'Weitere Angebote erzeugen' },
  aiSoon: { en: 'In development', de: 'In Entwicklung' },
  currentOffer: { en: 'Current offer', de: 'Aktuelles Angebot' },
  // export
  whatIsFilled: { en: 'What is written into the tender', de: 'Was ins LV geschrieben wird' },
  conditions: { en: 'Conditions (form p.', de: 'Konditionen (Formular S.' },
  download: { en: 'Download filled-in offer (PDF)', de: 'Ausgefüllte Offerte herunterladen (PDF)' },
  onlyNumbers: {
    en: 'Only numbers are added; the original LV text stays untouched, as the tender requires.',
    de: 'Es werden nur Zahlen ergänzt; der Originaltext des LV bleibt unverändert, wie verlangt.',
  },
  jumpTo: { en: 'Jump to', de: 'Springe zu' },
  costSummary: { en: 'Cost summary', de: 'Kostenzusammenstellung' },
  firstPosition: { en: 'First position', de: 'Erste Position' },
  // flow
  systems: { en: 'systems', de: 'Anlagen' },
  cadRows: { en: 'CAD rows', de: 'Bauteilzeilen' },
  withPrice: { en: 'with a price', de: 'mit Preis' },
  awaitQuote: { en: 'await a supplier quote', de: 'warten auf Lieferantenofferte' },
  uploading: { en: 'Reading the PDF…', de: 'PDF wird gelesen…' },
  includedHere: { en: 'Included in another position, written as "inkl." on the form.', de: 'In einer anderen Position enthalten, im Formular als «inkl.» eingetragen.' },
  cadOnForm: { en: 'From the CAD list: part of the "Materialauszug" row of this system; installation in section E.', de: 'Aus der Bauteilliste: Teil der Zeile «Materialauszug» dieser Anlage; Montage in Abschnitt E.' },
  tLineMaterial: { en: 'Material of all positions', de: 'Material aller Positionen' },
  tLineLabour: { en: 'Installation of all positions', de: 'Montage aller Positionen' },
  tTransport: { en: 'Transport / equipment', de: 'Transport / Inventar' },
  tSmall: { en: 'Small material', de: 'Kleinmaterial' },
  tContingency: { en: 'Supplier contingency', de: 'Reserve Lieferanten' },
  tEngineering: { en: 'Engineering', de: 'Engineering' },
  tCommissioning: { en: 'Commissioning', de: 'Inbetriebnahme' },
  tHygiene: { en: 'Hygiene inspection', de: 'Hygieneprüfung' },
  tDocumentation: { en: 'Documentation', de: 'Dokumentation' },
  tRisk: { en: 'Risk / opportunities', de: 'Risiken / Chancen' },
  tOverhead: { en: 'Overhead', de: 'Gemeinkosten' },
  tBaseline: { en: 'Cost baseline', de: 'Kostenbasis' },
  gFactors: { en: 'Productivity factors', de: 'Leistungsfaktoren' },
  gAllowances: { en: 'Allowances', de: 'Zuschläge' },
  gProject: { en: 'Project costs', de: 'Projektkosten' },
  gCommercial: { en: 'Commercial', de: 'Kommerziell' },
  gLocations: { en: 'Location per system (mounting height)', de: 'Ort je Anlage (Montagehöhe)' },
  paramsChanged: { en: 'changed from the company parameters', de: 'geändert gegenüber den Firmenparametern' },
  resetAll: { en: 'Reset all', de: 'Alle zurücksetzen' },
  edit: { en: 'Correct this value', de: 'Wert korrigieren' },
  hoursPerUnit: { en: 'Hours per unit', de: 'Stunden je Einheit' },
  quantity: { en: 'Quantity', de: 'Menge' },
  margin: { en: 'Margin', de: 'Marge' },
  aiAggressive: { en: 'Aggressive', de: 'Aggressiv' },
  aiConservative: { en: 'Conservative', de: 'Vorsichtig' },
  fPositions: { en: 'Unit prices and amounts of the positions', de: 'Einheitspreise und Beträge der Positionen' },
  fIncluded: { en: '"inkl." for positions included elsewhere', de: '«inkl.» für anderweitig enthaltene Positionen' },
  fSections: { en: 'Section totals, installation, services, CAD material, days', de: 'Abschnittstotale, Montage, Dienstleistungen, Materialauszug, Tage' },
  fSummary: { en: 'Cost summary per system and lot', de: 'Kostenzusammenstellung je Anlage und Los' },
  fConditions: { en: 'Offer total and conditions', de: 'Angebotssumme und Konditionen' },
  positionsPriced: { en: 'positions priced', de: 'Positionen bepreist' },
  fieldsTotal: { en: 'fields filled', de: 'Felder ausgefüllt' },
  roundingNote: { en: 'Sum of the rounded unit prices; offer price', de: 'Summe der gerundeten Einheitspreise; Angebotspreis' },
  cGross: { en: 'Gross total', de: 'Total brutto' },
  cSubtotal: { en: 'Subtotal', de: 'Zwischentotal' },
  cashDiscount: { en: 'Cash discount', de: 'Skonto' },
  cDeductions: { en: 'Deductions', de: 'Abzüge' },
  cVat: { en: 'VAT', de: 'MWST' },
  cNet: { en: 'Net total incl. VAT', de: 'Total netto inkl. MWST' },
  deductionsWhy: { en: 'Deduction and VAT rates are read from the tender form.', de: 'Abzüge und MWST-Satz stammen aus dem Formular der Ausschreibung.' },
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

export function humanize(key: string) {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}


export const PARAM_LABELS: Record<string, { en: string; de: string }> = {
  site_efficiency: { en: 'Site efficiency', de: 'Baustelleneffizienz' },
  school_logistics: { en: 'School logistics', de: 'Logistik Schulhaus' },
  mounting_height_school: { en: 'Mounting height (school)', de: 'Montagehöhe (Schulhaus)' },
  mounting_height_sports_hall: { en: 'Mounting height (sports hall)', de: 'Montagehöhe (Turnhalle)' },
  timber_interface: { en: 'Timber construction interface', de: 'Schnittstelle Holzbau' },
  material_waste_pct: { en: 'Material waste', de: 'Verschnitt' },
  small_material_pct: { en: 'Small material', de: 'Kleinmaterial' },
  transport_equipment_pct: { en: 'Transport / equipment', de: 'Transport / Inventar' },
  supplier_package_contingency_pct: { en: 'Supplier contingency', de: 'Reserve Lieferanten' },
  engineering_hours: { en: 'Engineering hours', de: 'Engineering-Stunden' },
  commissioning_hours: { en: 'Commissioning hours', de: 'Inbetriebnahme-Stunden' },
  hygiene_inspection_chf: { en: 'Hygiene inspection', de: 'Hygieneprüfung' },
  documentation_chf: { en: 'Documentation', de: 'Dokumentation' },
  overhead_pct: { en: 'Overhead', de: 'Gemeinkosten' },
  margin_pct: { en: 'Margin', de: 'Marge' },
  risk_allowance_chf: { en: 'Risk allowance', de: 'Risikozuschlag' },
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
