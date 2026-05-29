/*
 * Three stat cards, each pairing a big number with a small, *meaningful*
 * diagram (not the old random scribbles):
 *   - Surfaces  → a hub-and-spoke: one server, five surfaces.
 *   - Providers → a tidy 15×5 dot matrix (= 75 dots, "75+").
 *   - Telemetry → a flat line pinned at zero.
 * Cards use the app's warm raised surface + soft rounding.
 */
export function StatsBoard() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard value="5" label="Surfaces — terminal, desktop, web, iOS, and the server itself">
        <FigSurfaces />
      </StatCard>
      <StatCard value="75+" label="LLM providers via OpenAI-compatible config">
        <FigProviders />
      </StatCard>
      <StatCard value="0" label="Bytes of telemetry ever sent home">
        <FigTelemetry />
      </StatCard>
    </div>
  )
}

function StatCard({
  value,
  label,
  children,
}: {
  value: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col rounded-[var(--radius-xl)] border border-line bg-surface-2 p-6">
      <div className="h-24 w-full text-ink-soft">{children}</div>
      <div className="mt-5 text-[clamp(30px,3.4vw,40px)] font-semibold leading-none tracking-[-0.02em] text-ink">
        {value}
      </div>
      <p className="mt-2 text-[13px] leading-snug text-ink-muted">{label}</p>
    </div>
  )
}

/* One server (filled centre node) wired to five surfaces. */
function FigSurfaces() {
  const cx = 100
  const cy = 44
  const r = 30
  const nodes = [-90, -18, 54, 126, 198].map((deg) => {
    const a = (deg * Math.PI) / 180
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  })
  return (
    <svg viewBox="0 0 200 96" className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {nodes.map((n, i) => (
          <line key={i} x1={cx} y1={cy} x2={n.x} y2={n.y} strokeOpacity="0.55" />
        ))}
      </g>
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r="5" fill="var(--surface-2)" stroke="currentColor" strokeWidth="1.5" />
      ))}
      <circle cx={cx} cy={cy} r="7" fill="var(--ink)" />
    </svg>
  )
}

/* A tidy 15×5 matrix = 75 dots, with a handful lit to read as "and more". */
function FigProviders() {
  const cols = 15
  const rows = 5
  const lit = new Set(["0-14", "1-13", "2-14", "3-12", "4-13", "4-14", "0-0", "2-2"])
  const dots: { x: number; y: number; on: boolean }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      dots.push({
        x: 14 + (c * (200 - 28)) / (cols - 1),
        y: 16 + (r * (80 - 16)) / (rows - 1),
        on: lit.has(`${r}-${c}`),
      })
    }
  }
  return (
    <svg viewBox="0 0 200 96" className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.on ? 2.6 : 2.1}
          fill={d.on ? "var(--ink)" : "currentColor"}
          fillOpacity={d.on ? 1 : 0.5}
        />
      ))}
    </svg>
  )
}

/* A flat line pinned at zero against faint gridlines — nothing leaves. */
function FigTelemetry() {
  const gx = [40, 80, 120, 160]
  const baseY = 62
  return (
    <svg viewBox="0 0 200 96" className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1" strokeOpacity="0.25">
        {gx.map((x) => (
          <line key={x} x1={x} y1="14" x2={x} y2={baseY} />
        ))}
        <line x1="14" y1={baseY} x2="186" y2={baseY} strokeOpacity="0.35" />
      </g>
      <line x1="16" y1={baseY} x2="184" y2={baseY} stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy={baseY} r="3" fill="var(--ink)" />
    </svg>
  )
}
