/*
 * "codeplane" wordmark — chunky monospace caps with a 3D drop-bevel
 * matching the look of the opencode.ai wordmark. Each glyph is rendered
 * as two stacked rectangles: a darker back layer offset by 2px, and the
 * face layer on top. `currentColor` paints the face, `--ink-soft` paints
 * the bevel — both inherit from the surrounding header so the same SVG
 * works on cream and on dark.
 *
 * Sized for the header (height 22 by default); pass `size` to scale.
 * The viewBox is 320×40 — 9 glyphs at 32px each plus a 16px tail for
 * letter-spacing.
 */
export function Wordmark({ size = 26, className = "" }: { size?: number; className?: string }) {
  const w = size * (308 / 40)
  return (
    <svg
      viewBox="0 0 308 40"
      width={w}
      height={size}
      className={className}
      aria-label="codeplane"
      role="img"
    >
      <g fontFamily="JetBrains Mono, IBM Plex Mono, monospace" fontWeight="800" fontSize="36">
        {/* Back layer — bevel */}
        <text x="2" y="32" fill="var(--ink-soft)" letterSpacing="-0.5">codeplane</text>
        {/* Front layer — face */}
        <text x="0" y="30" fill="currentColor" letterSpacing="-0.5">codeplane</text>
      </g>
    </svg>
  )
}
