/*
 * Codeplane brand mark — the canonical paper-plane glyph used in the
 * favicon, app icon, README, and every other surface. Drawing the path
 * with `currentColor` lets the same component sit on any background
 * (light header → black plane, dark footer → white plane) without
 * shipping two separate SVGs.
 */
export function Logo({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path
        d="M64 64L448 256L64 448V320L256 256L64 192V64Z"
        fill="currentColor"
      />
    </svg>
  )
}
