/*
 * Three stat panels with ASCII-art-flavoured SVG illustrations sat
 * above their caption — the opencode.ai layout we're imitating uses
 * a thin line-graph, a dot grid, and a bar chart. The numbers here are
 * tuned to the fork's reality (small, honest, doesn't pretend to be
 * upstream's reach).
 */
export function StatsBoard() {
  return (
    <div className="grid grid-cols-1 gap-12 md:grid-cols-3">
      <Stat fig={1} numeric="5" label="Surfaces — TUI, desktop, web, iOS, server">
        <FigSurfaces />
      </Stat>
      <Stat fig={2} numeric="75+" label="LLM providers via OpenAI-compatible config">
        <FigDots />
      </Stat>
      <Stat fig={3} numeric="0" label="Bytes of telemetry sent home">
        <FigBars />
      </Stat>
    </div>
  )
}

function Stat({
  fig,
  numeric,
  label,
  children,
}: {
  fig: number
  numeric: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="h-[220px] w-full flex items-end justify-center text-ink-soft">
        {children}
      </div>
      <p className="mt-6 text-[13px] text-ink-2">
        <span className="text-ink-muted">Fig. {fig}.</span>{" "}
        <span className="font-bold text-ink">{numeric}</span> {label}
      </p>
    </div>
  )
}

/* Stairs / line-rise illustration. */
function FigSurfaces() {
  return (
    <svg viewBox="0 0 240 200" width="240" height="200" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1" fill="none">
        {/* stairs of horizontal segments climbing left-to-right */}
        {Array.from({ length: 24 }).map((_, i) => {
          const x1 = 8 + i * 9
          const x2 = x1 + 14
          const y = 188 - (i + 1) * 6
          return <line key={i} x1={x1} y1={y} x2={x2} y2={y} />
        })}
        {/* connecting curve */}
        <path d="M8 188 Q 120 60 232 30" strokeOpacity="0.35" />
      </g>
    </svg>
  )
}

/* Dot grid illustration. */
function FigDots() {
  const cols = 22
  const rows = 14
  return (
    <svg viewBox="0 0 240 200" width="240" height="200" aria-hidden="true">
      <g fill="currentColor">
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((_, c) => {
            const x = 12 + c * 10
            const y = 14 + r * 12
            // sparse pattern — drop ~30% to mimic the opencode dot field
            const seed = (r * 31 + c * 17) % 100
            const skip = seed < 30
            const size = seed < 12 ? 3 : 2
            if (skip) return null
            return <rect key={`${r}-${c}`} x={x} y={y} width={size} height={size} />
          }),
        )}
      </g>
    </svg>
  )
}

/* Bar-chart illustration. */
function FigBars() {
  const heights = [60, 90, 70, 130, 100, 150, 110, 160, 140, 170, 120, 180, 100, 90, 70, 80]
  return (
    <svg viewBox="0 0 240 200" width="240" height="200" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2">
        {heights.map((h, i) => {
          const x = 16 + i * 13
          return <line key={i} x1={x} y1={190} x2={x} y2={190 - h} />
        })}
      </g>
    </svg>
  )
}
