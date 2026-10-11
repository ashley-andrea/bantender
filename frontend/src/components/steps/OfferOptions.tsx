import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { fmtChf, fmtPct } from '../../format'
import { useI18n, type Key } from '../../i18n'
import type { Pricing, WinCurve, WinScenario } from '../../types'
import { CHART_MARGIN, chfCompact, nearestIndex, pct } from '../../winFormat'
import { KeyDrivers } from '../KeyDrivers'
import { WinChart } from '../WinChart'

const SCENARIO: Record<WinScenario['name'], { label: Key; hint: Key }> = {
  Aggressive: { label: 'aiAggressive', hint: 'aiAggressiveHint' },
  Target: { label: 'aiTarget', hint: 'aiTargetHint' },
  Conservative: { label: 'aiConservative', hint: 'aiConservativeHint' },
}
const ORDER: WinScenario['name'][] = ['Aggressive', 'Target', 'Conservative']

const roundUp = (v: number, step: number) => Math.ceil(v / step - 1e-9) * step

interface Props {
  pricing: Pricing
  busy: boolean
  onChoose: (choice: { scenario: string; offer: number; margin_pct: number; win_probability: number | null }) => void
}

/** Step 4: the win-probability curve on the left, the three offers it recommends on the right. */
export function OfferOptions({ pricing, busy, onChoose }: Props) {
  const { t } = useI18n()
  const wc = pricing.win_curve
  if (!wc || !wc.points || !wc.scenarios || !wc.current || !wc.parameters) {
    return (
      <div className="h-full grid place-items-center">
        <div className="panel p-6 max-w-md text-center">
          <div className="text-[16px] font-semibold">{t('unavailable')}</div>
          {wc?.reason && <p className="mt-1 text-[12.5px] text-muted">{wc.reason}</p>}
        </div>
      </div>
    )
  }
  return <Options key={wc.current.offer} wc={wc as Required<WinCurve>} pricing={pricing} busy={busy} onChoose={onChoose} />
}

function Options({ wc, pricing, busy, onChoose }: { wc: Required<WinCurve> } & Props) {
  const { t } = useI18n()
  const step = wc.parameters.round_to_chf
  const [selected, setSelected] = useState(() => nearestIndex(wc.points, wc.current.offer)) // remounted (key) when the current offer changes
  const sel = wc.points[selected]
  const selOffer = roundUp(sel.offer, step)
  const choice = pricing.choice
  const chosenNow = (offer: number) => !!choice && Math.abs(pricing.project.selling_price - roundUp(offer, step)) < 0.5 && Math.abs(choice.offer - offer) < step
  const choose = (scenario: string, offer: number, margin: number, p: number) =>
    onChoose({ scenario, offer: roundUp(offer, step), margin_pct: Math.round(margin * 1e6) / 1e6, win_probability: p })
  const scenarios = ORDER.map((n) => wc.scenarios.find((s) => s.name === n)).filter(Boolean) as WinScenario[]

  return (
    <div className={`h-full flex gap-4 ${busy ? 'opacity-90' : ''}`}>
      <div className="flex-1 min-w-0 h-full overflow-auto scroll-thin panel p-5">
        <div className="flex items-baseline gap-3">
          <span className="title-hand text-[16px]">{t('aiTitle')}</span>
          {busy && <Loader2 className="size-4 animate-spin text-muted self-center" />}
          {wc.model !== 'ml' && <span className="ml-auto text-[12px] text-warn">{t('placeholderNote')}</span>}
        </div>
        <div data-cite="win:current" className="mt-4">
          <WinChart points={wc.points} scenarios={wc.scenarios} current={wc.current} selected={selected} onSelect={setSelected} />
        </div>
        <div style={{ paddingLeft: CHART_MARGIN.l, paddingRight: CHART_MARGIN.r }}>
          <input type="range" aria-label={t('explore')} min={0} max={wc.points.length - 1} step={1} value={selected}
            style={{ '--p': `${(selected / (wc.points.length - 1)) * 100}%` } as React.CSSProperties}
            onChange={(e) => setSelected(Number(e.target.value))} className="range mt-2" />
          <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-[13px]">
            <Stat label={t('offerPrice')} value={`CHF ${fmtChf(selOffer)}`} strong />
            <Stat label={t('margin')} value={fmtPct(Math.round(sel.margin_pct * 10) / 10)} />
            <Stat label={t('winChance')} value={pct(sel.win_probability)} sub={`${pct(sel.p_low)}–${pct(sel.p_high)}`} />
            <Stat label={t('profitIfWon')} value={fmtChf(selOffer - wc.baseline)} />
            <button disabled={busy || chosenNow(sel.offer)} onClick={() => choose('Custom', sel.offer, sel.margin_pct, sel.win_probability)}
              className="btn btn-green ml-auto px-4 py-2 text-[13px]">
              {chosenNow(sel.offer) ? t('chosen') : t('chooseOffer')}
            </button>
          </div>
          <KeyDrivers wc={wc} point={sel} />
        </div>
      </div>

      <div className="w-[360px] shrink-0 h-full overflow-auto scroll-thin flex flex-col gap-4">
        {scenarios.map((s) => (
          <OptionCard key={s.name} cite={`win:${s.name}`} label={t(SCENARIO[s.name].label)} hint={t(SCENARIO[s.name].hint)} recommended={s.name === 'Target'}
            offer={s.offer} margin={s.margin_pct} chance={s.win_probability} profit={s.offer - wc.baseline}
            chosen={chosenNow(s.offer)} busy={busy} onChoose={() => choose(s.name, s.offer, s.margin_pct, s.win_probability)} />
        ))}
      </div>
    </div>
  )
}

function OptionCard({ cite, label, hint, offer, margin, chance, profit, recommended, chosen, busy, onChoose }: {
  cite: string; label: string; hint: string; offer: number; margin: number; chance: number; profit: number
  recommended?: boolean; chosen?: boolean; busy?: boolean; onChoose: () => void
}) {
  const { t } = useI18n()
  return (
    <div data-cite={cite} className={`panel ${recommended ? 'panel-green' : ''} flex-1 min-h-[180px] p-5 flex flex-col relative`}>
      {recommended && <span className="hl-tag -top-3 right-4 text-green">{t('recommended')}</span>}
      <div className="flex items-baseline gap-3">
        <span className="text-[16px] font-semibold">{label}</span>
        <span className="ml-auto text-[20px] font-semibold num">CHF {fmtChf(offer)}</span>
      </div>
      <div className="text-[12px] text-muted">{hint}</div>
      {/* Same three columns in every card: margin left, chance centred, profit right. */}
      <div className="mt-3 mb-4 grid grid-cols-[1fr_1.3fr_1fr] gap-3 text-[11.5px] whitespace-nowrap">
        <div><div className="text-muted">{t('margin')}</div><div className="text-[15px] font-semibold num">{fmtPct(Math.round(margin * 10) / 10)}</div></div>
        <div className="text-center"><div className="text-muted">{t('winChance')}</div><div className="text-[15px] font-semibold num">{pct(chance)}</div></div>
        <div className="text-right"><div className="text-muted">{t('profitIfWon')}</div><div className="text-[15px] font-semibold num">{chfCompact(profit)}</div></div>
      </div>
      <button disabled={busy || chosen} onClick={onChoose} className={`btn mt-auto px-3 py-1.5 text-[13px] ${recommended ? 'btn-green' : 'btn-paper'}`}>
        {chosen ? `✓ ${t('chosen')}` : t('chooseOffer')}
      </button>
    </div>
  )
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11.5px] text-muted whitespace-nowrap">{label}</div>
      <div className={`num whitespace-nowrap ${strong ? 'text-[16px] font-semibold text-navy' : 'font-semibold'}`}>
        {value} {sub && <span className="text-[11.5px] font-normal text-muted">({sub})</span>}
      </div>
    </div>
  )
}
