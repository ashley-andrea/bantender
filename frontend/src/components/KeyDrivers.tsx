import { fmtChf } from '../format'
import { useI18n, type Lang } from '../i18n'
import type { WinCurve, WinPoint } from '../types'

const TOP = 5

// Model features, named as an estimator knows them.
const LABEL: Record<string, Record<Lang, string>> = {
  price_position: { en: 'Price position', de: 'Preisposition' }, // offer ÷ our cost
  price_position_x_sensitivity: { en: 'Price position × price weighting', de: 'Preisposition × Preisgewichtung' },
  price_sensitivity: { en: 'Price weighting', de: 'Preisgewichtung' },
  bkp_trade: { en: 'Trade', de: 'Gewerk' },
  building_type: { en: 'Building type', de: 'Gebäudetyp' },
  canton: { en: 'Canton', de: 'Kanton' },
  client_type: { en: 'Client type', de: 'Bauherrentyp' },
  procedure: { en: 'Procedure', de: 'Verfahren' },
  log_project_cost: { en: 'Project size', de: 'Projektgrösse' },
  trade_building: { en: 'Trade × building type', de: 'Gewerk × Gebäudetyp' },
  n_lots: { en: 'Number of lots', de: 'Anzahl Lose' },
  log_n_bidders: { en: 'Number of bidders', de: 'Anzahl Anbieter' },
  competitive_intensity: { en: 'Competitive intensity', de: 'Wettbewerbsintensität' },
  strategic_appetite: { en: 'Strategic appetite', de: 'Strategisches Interesse' },
  available_capacity_pct: { en: 'Available capacity', de: 'Verfügbare Kapazität' },
  incumbent_present: { en: 'Incumbent', de: 'Bisheriger Anbieter' },
  prior_wins_capped: { en: 'Prior wins with client', de: 'Frühere Zuschläge' },
  technical_score_expected: { en: 'Expected technical score', de: 'Erwartete Technikbewertung' },
}
const TEXT = {
  title: { en: 'Key drivers', de: 'Haupteinflüsse' },
  at: { en: 'at', de: 'bei' },
  other: { en: 'Other factors', de: 'Weitere Faktoren' },
}

/** Highlighter stroke, as on the tender PDF; stronger ink for a larger share. */
const marker = (alpha: number) => `rgb(127 211 160 / ${alpha.toFixed(2)})`
const GREY = 'rgb(199 205 210 / 0.7)'

/**
 * What the model's estimate rests on at the offer chosen on the slider: each feature's share of the total influence
 * (|SHAP| ÷ Σ|SHAP|, exact for this linear model), largest first, the rest folded into one row.
 */
export function KeyDrivers({ wc, point }: { wc: WinCurve; point: WinPoint }) {
  const { lang } = useI18n()
  const shap = wc.shap
  if (!shap) return null
  const values: Record<string, number> = { ...shap.fixed }
  for (const k of shap.per_point) values[k.replace(/^shap_/, '')] = Number((point as unknown as Record<string, number>)[k] ?? 0)

  const total = Object.values(values).reduce((s, v) => s + Math.abs(v), 0) || 1
  const ranked = Object.entries(values).map(([feature, v]) => ({ feature, share: Math.abs(v) / total })).sort((a, b) => b.share - a.share)
  const top = ranked.slice(0, TOP)
  const rest = ranked.slice(TOP)
  const restShare = rest.reduce((s, r) => s + r.share, 0)
  const max = Math.max(top[0]?.share ?? 0, restShare, 1e-9)

  const rows = [
    ...top.map((r) => ({ key: r.feature, label: LABEL[r.feature]?.[lang] ?? r.feature, share: r.share, color: marker(0.45 + 0.5 * (r.share / max)) })),
    ...(rest.length ? [{ key: 'other', label: `${TEXT.other[lang]} (${rest.length})`, share: restShare, color: GREY }] : []),
  ]

  return (
    <div data-cite="win:drivers" className="mt-6">
      <div className="flex items-baseline gap-3">
        <span className="title-hand">{TEXT.title[lang]}</span>
        <span className="text-[12px] text-muted num">{TEXT.at[lang]} CHF {fmtChf(point.offer)}</span>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(150px,220px)_1fr_48px] items-center gap-x-4 gap-y-2.5 text-[13px]">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <span className={`truncate ${r.key === 'other' ? 'text-muted' : ''}`}>{r.label}</span>
            <div className="h-3.5">
              <div className="h-full"
                style={{
                  width: `${Math.max(1.5, (r.share / max) * 100)}%`, background: r.color, mixBlendMode: 'multiply',
                  borderRadius: '3px 9px 4px 8px / 7px 3px 8px 4px', transform: 'skewX(-4deg)', filter: 'url(#marker)',
                  transition: 'width 160ms ease, background-color 160ms ease',
                }} />
            </div>
            <span className="text-right font-semibold num">{Math.round(r.share * 100)} %</span>
          </div>
        ))}
      </div>
    </div>
  )
}
