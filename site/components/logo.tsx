/*
 * Codeplane wordmark + lozenge logo. Black-on-white in light mode, white-
 * on-black in dark mode — `currentColor` on the rect picks up the inherited
 * text colour, the inner stroke is hardcoded to the opposite end of the
 * scale so the mark stays readable in either mode.
 */
export function Logo({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" />
      <path
        d="M9 8.5L7 12l2 3.5M15 8.5l2 3.5-2 3.5"
        stroke="var(--surface)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
