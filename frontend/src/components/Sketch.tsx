/** SVG filters used across the app: `pencil` wobbles graph strokes, `marker` roughens highlighter edges. */
export function SketchDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {/* User-space region in absolute units (ItemGraph's viewBox is 660 wide): percentages here resolve against this
            0×0 svg in some browsers, which leaves an empty region and hides every filtered stroke. Not objectBoundingBox:
            straight lines have a zero-width/height box and would vanish too. */}
        <filter id="pencil" filterUnits="userSpaceOnUse" x="-200" y="-200" width="1100" height="2400">
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

/** The bantender logo (public/bantender-logo.png, cropped from bantender_logo_transparent.png). */
export function BantenderLogo({ className = '', height = 26 }: { className?: string; height?: number }) {
  return <img src="/bantender-logo.png" alt="bantender" draggable={false} className={`block w-auto select-none ${className}`} style={{ height }} />
}
