/** SVG filters used across the app: `pencil` wobbles graph strokes, `marker` roughens highlighter edges. */
export function SketchDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <filter id="pencil" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="marker" x="-4%" y="-20%" width="108%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09 0.35" numOctaves="2" seed="2" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  )
}

/**
 * bantender wordmark. Placeholder until the real logo arrives: drop it in public/ and replace the text with an <img>.
 */
export function BantenderLogo({ className = '', size = 22 }: { className?: string; size?: number }) {
  return (
    <span className={`font-bold tracking-tight leading-none select-none ${className}`} style={{ fontSize: size }}>
      ban<span className="text-green">tender</span>
    </span>
  )
}
