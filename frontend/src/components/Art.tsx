import type { Step } from '../route'

/** Drawn glyphs, one per step; they inherit the text colour. */
export function StepGlyph({ step, className = 'size-4' }: { step: Step; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <Glyph step={step} />
    </svg>
  )
}

function Glyph({ step }: { step: Step }) {
  switch (step) {
    case 'extract': // a page under a lens
      return (
        <>
          <path d="M14 3H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h5" />
          <path d="M8.5 8h6M8.5 11.5h3" />
          <circle cx="16" cy="15" r="3.6" />
          <path d="m18.7 17.7 2.6 2.6" />
        </>
      )
    case 'catalog': // a grid of items, one picked
      return (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1" fill="currentColor" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
        </>
      )
    case 'price': // a price tag
      return (
        <>
          <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z" />
          <circle cx="8.3" cy="8.3" r="1.6" fill="currentColor" />
        </>
      )
    case 'offers': // a target
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="1.3" fill="currentColor" />
        </>
      )
    case 'export': // a paper plane
      return (
        <>
          <path d="M21 3 3 10.5l7 2.5 2.5 7z" />
          <path d="m10 13 11-10" />
        </>
      )
  }
}

const STATIONS: { step: Step; fill: string; x: number; y: number }[] = [
  { step: 'extract', fill: 'var(--color-cyan)', x: 56, y: 132 },
  { step: 'catalog', fill: 'var(--color-peri)', x: 168, y: 70 },
  { step: 'price', fill: 'var(--color-lime)', x: 280, y: 138 },
  { step: 'offers', fill: 'var(--color-pink)', x: 392, y: 72 },
  { step: 'export', fill: 'var(--color-lilac)', x: 504, y: 128 },
]

/** Each station has its own silhouette, centred on (0, 0), about 80 px wide. */
function Silhouette({ step, fill }: { step: Step; fill: string }) {
  const p = { fill, stroke: 'var(--color-ink)', strokeWidth: 2 }
  switch (step) {
    case 'extract':
      return <circle r={40} {...p} />
    case 'catalog':
      return <rect x={-34} y={-34} width={68} height={68} rx={6} transform="rotate(-8)" {...p} />
    case 'price': // an arch
      return <path d="M-38 36V0a38 38 0 0 1 76 0v36z" {...p} />
    case 'offers': { // an eight-lobed flower
      const lobes = Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4
        return `${(Math.cos(a) * 30).toFixed(1)} ${(Math.sin(a) * 30).toFixed(1)}`
      })
      const d = lobes.map((pt, i) => `${i ? 'A12 12 0 0 1' : 'M'} ${pt}`).join(' ') + ` A12 12 0 0 1 ${lobes[0]}Z`
      return <path d={d} {...p} strokeLinejoin="round" />
    }
    case 'export': // a diamond
      return <path d="M0-42 40 0 0 42-40 0z" {...p} strokeLinejoin="round" />
  }
}

function Sparkle({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <path transform={`translate(${x} ${y}) scale(${s})`} d="M0-10C1 -3 3-1 10 0 3 1 1 3 0 10-1 3-3 1-10 0-3-1-1-3 0-10z" fill="var(--color-ink)" />
}

/** Home: the five steps as stations on one dashed line, from tender to offer. */
export function JourneyArt({ className }: { className?: string }) {
  const path = `M ${STATIONS.map((s, i) => (i ? `S ${s.x - 56} ${s.y} ${s.x} ${s.y}` : `${s.x} ${s.y}`)).join(' ')}`
  return (
    <svg viewBox="0 0 560 210" className={className} aria-hidden>
      <path d={path} fill="none" stroke="var(--color-ink)" strokeWidth={2} strokeDasharray="2 10" strokeLinecap="round" className="march" />
      <Sparkle x={112} y={36} s={0.9} />
      <Sparkle x={338} y={30} s={0.6} />
      <Sparkle x={540} y={40} s={1.1} />
      <circle cx={230} cy={184} r={5} fill="var(--color-ink)" />
      <circle cx={452} cy={176} r={9} fill="none" stroke="var(--color-ink)" strokeWidth={2} />
      {STATIONS.map((s, i) => (
        <g key={s.step} transform={`translate(${s.x} ${s.y})`}>
          <g className="bob" style={{ animationDelay: `${i * -0.6}s` }}>
            <Silhouette step={s.step} fill={s.fill} />
            <svg x={-15} y={s.step === 'price' ? -9 : -15} width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="var(--color-ink)"
              strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" color="var(--color-ink)">
              <Glyph step={s.step} />
            </svg>
            <text y={-50} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--color-ink)">0{i + 1}</text>
          </g>
        </g>
      ))}
    </svg>
  )
}

/** Upload: a fan of tender sheets with the upload button floating on top. */
export function DropArt({ className }: { className?: string }) {
  const ink = { stroke: 'var(--color-ink)', strokeWidth: 2, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 220 170" className={className} aria-hidden>
      <rect x={58} y={22} width={92} height={120} rx={4} fill="var(--color-pink)" transform="rotate(-14 104 82)" {...ink} />
      <rect x={70} y={20} width={92} height={120} rx={4} fill="var(--color-lime)" transform="rotate(9 116 80)" {...ink} />
      <g transform="rotate(-2 110 84)">
        <rect x={64} y={24} width={92} height={120} rx={4} fill="#fff" {...ink} />
        <rect x={76} y={38} width={40} height={7} rx={1} fill="var(--color-ink)" />
        {[56, 66, 76, 92, 102, 112].map((y, i) => (
          <line key={y} x1={76} x2={i % 3 === 2 ? 118 : 144} y1={y} y2={y} stroke="var(--color-ink)" strokeWidth={2} strokeLinecap="round" strokeOpacity={0.25} />
        ))}
        <rect x={112} y={124} width={32} height={10} rx={1} fill="var(--color-cyan)" {...ink} strokeWidth={1.5} />
      </g>
      <Sparkle x={36} y={40} s={0.9} />
      <Sparkle x={192} y={30} s={0.6} />
      <g className="bob">
        <circle cx={168} cy={128} r={24} fill="var(--color-ink)" />
        <path d="M168 139v-21m-8 8 8-8 8 8" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
