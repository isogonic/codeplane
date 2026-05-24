// Rich custom-block rendering for TUI chat (mirrors the desktop UI's
// markdown-blocks module). The agent emits fenced code blocks tagged with
// languages like `chart`, `stock`, `tabs`, `callout` etc.; we split them out
// of the surrounding markdown and render each with native opentui primitives.
//
// Supported (mirrors packages/ui/src/components/markdown-blocks.ts):
//   chart, stock, kpi, tabs, choice, select, callout(+aliases), preview,
//   badge, progress, timeline, quote, table, file-tree, comparison, diff.
//
// Anything not recognised falls through to the regular markdown renderer.

import { For, Show, type JSX } from "solid-js"
import { useTheme } from "@/tui/context/theme"
import { SplitBorder } from "@/tui/component/border"
import type { SyntaxStyle, RGBA } from "@opentui/core"

// ---------------------------------------------------------------------------
// segment splitting
// ---------------------------------------------------------------------------

const blockLangs = new Set([
  "chart",
  "stock",
  "tabs",
  "choice",
  "select",
  "callout",
  "note",
  "info",
  "tip",
  "warning",
  "danger",
  "error",
  "success",
  "important",
  "preview",
  "kpi",
  "video",
  "timeline",
  "progress",
  "badge",
  "quote",
  "table",
  "file-tree",
  "tree",
  "image-grid",
  "gallery",
  "comparison",
  "diff",
])

export type RichBlockSegment =
  | { kind: "markdown"; text: string }
  | { kind: "block"; lang: string; code: string }

export function splitMarkdownBlocks(text: string): RichBlockSegment[] {
  const segments: RichBlockSegment[] = []
  // Match ``` or ~~~ fences with our recognised languages. Allow any number of
  // backticks/tildes (>=3) and require the closing fence to match opener length.
  const fenceRe = /(^|\n)([ \t]*)(`{3,}|~{3,})([ \t]*)([^\s`~]+)([^\n]*)\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|$)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = fenceRe.exec(text))) {
    const lang = (match[5] ?? "").trim().toLowerCase()
    if (!blockLangs.has(lang)) continue
    const start = match.index + (match[1] ? 1 : 0)
    if (start > lastIndex) {
      const md = text.slice(lastIndex, start)
      if (md.trim()) segments.push({ kind: "markdown", text: md })
    }
    segments.push({ kind: "block", lang, code: match[7] ?? "" })
    lastIndex = fenceRe.lastIndex
  }
  if (lastIndex < text.length) {
    const md = text.slice(lastIndex)
    if (md.trim()) segments.push({ kind: "markdown", text: md })
  }
  return segments
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function _internalsForTesting() {
  return { splitMarkdownBlocks, sparklineString, formatNumber, formatCurrency, stripInline }
}

function tryParse<T = unknown>(code: string): T | null {
  try {
    return JSON.parse(code.trim()) as T
  } catch {
    return null
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

function sparklineString(data: number[], width: number): string {
  if (data.length === 0) return ""
  const chars = "▁▂▃▄▅▆▇█"
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  // Resample to fit width
  const out: string[] = []
  const slots = Math.max(1, Math.min(width, data.length * 2))
  for (let i = 0; i < slots; i++) {
    const idx = (i / Math.max(1, slots - 1)) * (data.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    const t = idx - lo
    const v = data[lo]! * (1 - t) + (data[hi] ?? data[lo]!) * t
    const norm = (v - min) / range
    const ch = chars[clamp(Math.floor(norm * chars.length), 0, chars.length - 1)]!
    out.push(ch)
  }
  return out.join("")
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—"
  if (Math.abs(v) >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 10_000) return `${(v / 1_000).toFixed(1)}k`
  if (Number.isInteger(v)) return v.toLocaleString()
  return v.toFixed(Math.abs(v) < 1 ? 2 : 1)
}

function formatCurrency(v: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(v)
  } catch {
    return `${v.toFixed(2)} ${currency}`
  }
}

// Strip markdown emphasis, render bare text. Inline formatting is too noisy
// inside narrow terminal blocks; the renderer keeps the literal content but
// drops `*` / `**` markers so it does not look broken.
function stripInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
}

// ---------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------

interface RichBlockProps {
  text: string
  syntax: SyntaxStyle
  conceal?: boolean
  streaming?: boolean
  experimental?: boolean
}

export function RichBlockText(props: RichBlockProps): JSX.Element {
  const { theme } = useTheme()
  const segments = () => splitMarkdownBlocks(props.text)
  // flexGrow={1} ensures we expand to fill the parent's main axis even when
  // the parent is a row container — otherwise our column wrapper sizes to
  // its content width and markdown / rich blocks render in a narrow column
  // hugging the left edge.  width="100%" handles the (correct) case where
  // the parent is itself a column container.
  return (
    <box flexDirection="column" flexShrink={0} flexGrow={1} width="100%">
      <For each={segments()}>
        {(seg) =>
          seg.kind === "markdown" ? (
            <Show when={seg.text.trim()}>
              {props.experimental ? (
                <markdown
                  syntaxStyle={props.syntax}
                  streaming={props.streaming ?? true}
                  content={seg.text.trim()}
                  conceal={props.conceal ?? true}
                  fg={theme.markdownText}
                  bg={theme.background}
                />
              ) : (
                <code
                  filetype="markdown"
                  drawUnstyledText={false}
                  streaming={props.streaming ?? true}
                  syntaxStyle={props.syntax}
                  content={seg.text.trim()}
                  conceal={props.conceal ?? true}
                  fg={theme.text}
                />
              )}
            </Show>
          ) : (
            <RichBlock lang={seg.lang} code={seg.code} />
          )
        }
      </For>
    </box>
  )
}

function RichBlock(props: { lang: string; code: string }) {
  switch (props.lang) {
    case "chart":
      return <ChartBlock code={props.code} />
    case "stock":
      return <StockBlock code={props.code} />
    case "kpi":
      return <KpiBlock code={props.code} />
    case "tabs":
      return <TabsBlock code={props.code} />
    case "choice":
      return <ChoiceBlock code={props.code} multi={false} />
    case "select":
      return <ChoiceBlock code={props.code} multi={true} />
    case "callout":
    case "note":
    case "info":
    case "tip":
    case "important":
    case "warning":
    case "danger":
    case "error":
    case "success":
      return <CalloutBlock code={props.code} variant={props.lang} />
    case "preview":
      return <PreviewBlock code={props.code} />
    case "badge":
      return <BadgeBlock code={props.code} />
    case "progress":
      return <ProgressBlock code={props.code} />
    case "timeline":
      return <TimelineBlock code={props.code} />
    case "quote":
      return <QuoteBlock code={props.code} />
    case "table":
      return <TableBlock code={props.code} />
    case "file-tree":
    case "tree":
      return <FileTreeBlock code={props.code} />
    case "comparison":
      return <ComparisonBlock code={props.code} />
    case "diff":
      return <DiffBlock code={props.code} />
    case "image-grid":
    case "gallery":
      return <ImageGridBlock code={props.code} />
    case "video":
      return <VideoBlock code={props.code} />
    default:
      return <ErrorBlock kind={props.lang} message="not implemented" />
  }
}

function ErrorBlock(props: { kind: string; message: string }) {
  const { theme } = useTheme()
  return (
    <box
      flexShrink={0}
      marginTop={1}
      paddingLeft={1}
      paddingRight={1}
      border={["left"]}
      borderColor={theme.error}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <text fg={theme.error}>
        {props.kind} block — {props.message}
      </text>
    </box>
  )
}

function BlockTitle(props: { text: string }) {
  const { theme } = useTheme()
  return (
    <text fg={theme.text}>
      <span style={{ bold: true }}>{props.text}</span>
    </text>
  )
}

function BlockCard(props: {
  title?: string
  subtitle?: string
  borderColor?: RGBA
  children: JSX.Element
}) {
  const { theme } = useTheme()
  return (
    <box
      flexShrink={0}
      flexDirection="column"
      marginTop={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={props.borderColor ?? theme.border}
      backgroundColor={theme.backgroundPanel}
    >
      <Show when={props.title}>
        <text fg={theme.text}>
          <span style={{ bold: true }}>{props.title}</span>
        </text>
      </Show>
      <Show when={props.subtitle}>
        <text fg={theme.textMuted}>{props.subtitle}</text>
      </Show>
      {props.children}
    </box>
  )
}

// ---------------------------------------------------------------------------
// chart
// ---------------------------------------------------------------------------

interface ChartConfig {
  type?: string
  title?: string
  subtitle?: string
  labels?: string[]
  series?: Array<{ name?: string; data?: number[] }>
  data?: number[]
  format?: "number" | "currency" | "percent"
  currency?: string
}

function ChartBlock(props: { code: string }) {
  const { theme } = useTheme()
  const cfg = tryParse<ChartConfig>(props.code)
  if (!cfg) return <ErrorBlock kind="chart" message="invalid JSON" />
  const series: Array<{ name?: string; data: number[] }> = []
  for (const s of cfg.series ?? []) {
    if (Array.isArray(s.data) && s.data.length > 0) {
      series.push({ name: s.name, data: s.data.map((v) => Number(v)).filter(Number.isFinite) })
    }
  }
  if (series.length === 0 && Array.isArray(cfg.data) && cfg.data.length > 0) {
    series.push({ data: cfg.data.map((v) => Number(v)).filter(Number.isFinite) })
  }
  if (series.length === 0) return <ErrorBlock kind="chart" message="no data" />

  const fmt = (v: number) => {
    if (cfg.format === "currency") return formatCurrency(v, cfg.currency)
    if (cfg.format === "percent") return `${(v * 100).toFixed(0)}%`
    return formatNumber(v)
  }

  const type = cfg.type ?? "line"
  const colors = [theme.markdownLink, theme.warning, theme.secondary, theme.success, theme.error]

  return (
    <BlockCard title={cfg.title} subtitle={cfg.subtitle}>
      <Show when={type === "pie" || type === "donut"}>
        <PieChartBody data={series[0]!.data} labels={cfg.labels ?? []} fmt={fmt} colors={colors} />
      </Show>
      <Show when={type === "bar"}>
        <BarChartBody series={series} labels={cfg.labels ?? []} fmt={fmt} colors={colors} />
      </Show>
      <Show when={type === "line" || type === "area" || type === "sparkline" || (type !== "pie" && type !== "donut" && type !== "bar")}>
        <LineChartBody series={series} fmt={fmt} colors={colors} />
      </Show>
    </BlockCard>
  )
}

function LineChartBody(props: {
  series: Array<{ name?: string; data: number[] }>
  fmt: (v: number) => string
  colors: RGBA[]
}) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" marginTop={1}>
      <For each={props.series}>
        {(s, i) => {
          const color = props.colors[i() % props.colors.length] ?? theme.text
          const min = Math.min(...s.data)
          const max = Math.max(...s.data)
          const last = s.data[s.data.length - 1]!
          return (
            <box flexDirection="column" marginBottom={i() < props.series.length - 1 ? 1 : 0}>
              <text>
                <span style={{ fg: color }}>■ </span>
                <span style={{ fg: theme.text, bold: true }}>{s.name ?? "value"}</span>
                <span style={{ fg: theme.textMuted }}>  last </span>
                <span style={{ fg: theme.text }}>{props.fmt(last)}</span>
                <span style={{ fg: theme.textMuted }}>  range </span>
                <span style={{ fg: theme.textMuted }}>
                  {props.fmt(min)} – {props.fmt(max)}
                </span>
              </text>
              <text>
                <span style={{ fg: color }}>{sparklineString(s.data, 60)}</span>
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function BarChartBody(props: {
  series: Array<{ name?: string; data: number[] }>
  labels: string[]
  fmt: (v: number) => string
  colors: RGBA[]
}) {
  const { theme } = useTheme()
  // Only show first series for bar chart in TUI. Multi-series bars are too
  // noisy at terminal widths.
  const data = props.series[0]?.data ?? []
  const max = Math.max(0, ...data)
  const labelW = Math.max(...props.labels.map((l) => l.length), 4)
  const barW = 36
  return (
    <box flexDirection="column" marginTop={1}>
      <For each={data}>
        {(v, i) => {
          const fillCount = max > 0 ? Math.round((v / max) * barW) : 0
          const fill = "█".repeat(fillCount)
          const empty = "░".repeat(barW - fillCount)
          const label = (props.labels[i()] ?? "").padEnd(labelW, " ")
          const color = props.colors[0] ?? theme.text
          return (
            <text>
              <span style={{ fg: theme.textMuted }}>{label}  </span>
              <span style={{ fg: color }}>{fill}</span>
              <span style={{ fg: theme.borderSubtle }}>{empty}</span>
              <span style={{ fg: theme.text }}>  {props.fmt(v)}</span>
            </text>
          )
        }}
      </For>
    </box>
  )
}

function PieChartBody(props: {
  data: number[]
  labels: string[]
  fmt: (v: number) => string
  colors: RGBA[]
}) {
  const { theme } = useTheme()
  const total = props.data.reduce((a, b) => a + Math.max(0, b), 0)
  const isPercent = total >= 99.5 && total <= 100.5
  const barW = 30
  return (
    <box flexDirection="column" marginTop={1}>
      <For each={props.data}>
        {(v, i) => {
          const pct = total > 0 ? (v / total) * 100 : 0
          const fillCount = Math.round((pct / 100) * barW)
          const label = (props.labels[i()] ?? `slice ${i() + 1}`).padEnd(14, " ")
          const color = props.colors[i() % props.colors.length] ?? theme.text
          const fill = "█".repeat(fillCount)
          const empty = "░".repeat(barW - fillCount)
          return (
            <text>
              <span style={{ fg: theme.textMuted }}>{label}  </span>
              <span style={{ fg: color }}>{fill}</span>
              <span style={{ fg: theme.borderSubtle }}>{empty}</span>
              <span style={{ fg: theme.text }}>  {pct.toFixed(0)}%</span>
              <Show when={!isPercent}>
                <span style={{ fg: theme.textMuted }}>  ({props.fmt(v)})</span>
              </Show>
            </text>
          )
        }}
      </For>
    </box>
  )
}

// ---------------------------------------------------------------------------
// stock
// ---------------------------------------------------------------------------

interface StockConfig {
  ticker?: string
  symbol?: string
  name?: string
  exchange?: string
  price?: number
  change?: number
  changePercent?: number
  currency?: string
  history?: number[]
  asOf?: string
}

function StockBlock(props: { code: string }) {
  const { theme } = useTheme()
  const cfg = tryParse<StockConfig>(props.code)
  if (!cfg) return <ErrorBlock kind="stock" message="invalid JSON" />
  const ticker = cfg.ticker ?? cfg.symbol
  if (!ticker) return <ErrorBlock kind="stock" message="missing ticker" />
  const change = Number(cfg.change ?? 0)
  const dir = change > 0 ? "up" : change < 0 ? "down" : "flat"
  const color = dir === "up" ? theme.success : dir === "down" ? theme.error : theme.textMuted
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "■"
  const sign = change > 0 ? "+" : change < 0 ? "−" : ""
  const absChange = Math.abs(change).toFixed(2)
  const absPct = Math.abs(Number(cfg.changePercent ?? 0)).toFixed(2)
  const history = Array.isArray(cfg.history) ? cfg.history.map(Number).filter(Number.isFinite) : []
  return (
    <BlockCard borderColor={color}>
      <text>
        <span style={{ fg: theme.text, bold: true }}>{ticker.toUpperCase()}</span>
        <Show when={cfg.name}>
          <span style={{ fg: theme.textMuted }}>  {cfg.name}</span>
        </Show>
        <Show when={cfg.exchange}>
          <span style={{ fg: theme.textMuted }}>  · {cfg.exchange}</span>
        </Show>
      </text>
      <Show when={cfg.price !== undefined}>
        <text>
          <span style={{ fg: theme.text, bold: true }}>{formatCurrency(Number(cfg.price), cfg.currency)}</span>
          <Show when={cfg.change !== undefined || cfg.changePercent !== undefined}>
            <span style={{ fg: color }}>
              {"  "}
              {arrow} {cfg.change !== undefined ? `${sign}${absChange}` : ""}
              {cfg.changePercent !== undefined ? ` (${sign}${absPct}%)` : ""}
            </span>
          </Show>
        </text>
      </Show>
      <Show when={history.length >= 2}>
        <text>
          <span style={{ fg: color }}>{sparklineString(history, 60)}</span>
        </text>
      </Show>
      <Show when={cfg.asOf}>
        <text fg={theme.textMuted}>As of {cfg.asOf}</text>
      </Show>
    </BlockCard>
  )
}

// ---------------------------------------------------------------------------
// kpi
// ---------------------------------------------------------------------------

interface KpiTile {
  label?: string
  value?: number | string
  unit?: string
  delta?: number
  deltaPercent?: number
  trend?: "up" | "down" | "flat"
  history?: number[]
  hint?: string
}

function KpiBlock(props: { code: string }) {
  const { theme } = useTheme()
  const raw = tryParse<unknown>(props.code)
  const tiles: KpiTile[] = Array.isArray(raw)
    ? (raw as KpiTile[])
    : raw && typeof raw === "object" && Array.isArray((raw as { tiles?: KpiTile[] }).tiles)
      ? (raw as { tiles: KpiTile[] }).tiles
      : []
  if (tiles.length === 0) return <ErrorBlock kind="kpi" message="no tiles" />
  return (
    <box flexDirection="row" flexWrap="wrap" marginTop={1} flexShrink={0} gap={1}>
      <For each={tiles}>
        {(tile) => {
          const trend =
            tile.trend ??
            (typeof tile.delta === "number"
              ? tile.delta > 0
                ? "up"
                : tile.delta < 0
                  ? "down"
                  : "flat"
              : "flat")
          const color = trend === "up" ? theme.success : trend === "down" ? theme.error : theme.textMuted
          const valueText =
            typeof tile.value === "number" ? formatNumber(tile.value) : (tile.value ?? "—")
          const deltaParts: string[] = []
          if (typeof tile.delta === "number") deltaParts.push(`${tile.delta > 0 ? "+" : ""}${formatNumber(tile.delta)}`)
          if (typeof tile.deltaPercent === "number")
            deltaParts.push(`${tile.deltaPercent > 0 ? "+" : ""}${tile.deltaPercent.toFixed(1)}%`)
          const history = Array.isArray(tile.history)
            ? tile.history.map(Number).filter(Number.isFinite)
            : []
          return (
            <box
              flexDirection="column"
              flexShrink={0}
              minWidth={22}
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
              paddingBottom={1}
              border={["left"]}
              customBorderChars={SplitBorder.customBorderChars}
              borderColor={color}
              backgroundColor={theme.backgroundPanel}
            >
              <Show when={tile.label}>
                <text fg={theme.textMuted}>{tile.label!.toUpperCase()}</text>
              </Show>
              <text>
                <span style={{ fg: theme.text, bold: true }}>{valueText}</span>
                <Show when={tile.unit}>
                  <span style={{ fg: theme.textMuted }}> {tile.unit}</span>
                </Show>
                <Show when={deltaParts.length > 0}>
                  <span style={{ fg: color }}>  {deltaParts.join(" ")}</span>
                </Show>
              </text>
              <Show when={history.length >= 2}>
                <text>
                  <span style={{ fg: color }}>{sparklineString(history, 22)}</span>
                </text>
              </Show>
              <Show when={tile.hint}>
                <text fg={theme.textMuted}>{tile.hint}</text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------

interface TabsConfig {
  tabs?: Array<{ label?: string; title?: string; content?: string; body?: string }>
  default?: number | string
}

function TabsBlock(props: { code: string }) {
  const { theme } = useTheme()
  const cfg = tryParse<TabsConfig>(props.code)
  if (!cfg) return <ErrorBlock kind="tabs" message="invalid JSON" />
  const tabs = (cfg.tabs ?? []).filter((t) => t && (t.content || t.body))
  if (tabs.length === 0) return <ErrorBlock kind="tabs" message="no tabs" />
  return (
    <BlockCard>
      <text>
        <For each={tabs}>
          {(t, i) => {
            const label = t.label ?? t.title ?? `Tab ${i() + 1}`
            const active = i() === 0
            return (
              <span
                style={{
                  fg: active ? theme.background : theme.textMuted,
                  bg: active ? theme.primary : undefined,
                  bold: active,
                }}
              >
                {" "}
                {label}{" "}
              </span>
            )
          }}
        </For>
      </text>
      <text fg={theme.textMuted}>{"─".repeat(40)}</text>
      <For each={tabs}>
        {(t, i) => (
          <Show when={i() === 0}>
            <text fg={theme.text}>{stripInline(t.content ?? t.body ?? "")}</text>
          </Show>
        )}
      </For>
    </BlockCard>
  )
}

// ---------------------------------------------------------------------------
// choice / select
// ---------------------------------------------------------------------------

interface ChoiceOption {
  label?: string
  value?: string
  hint?: string
  description?: string
}

interface ChoiceConfig {
  question?: string
  prompt?: string
  hint?: string
  options?: ChoiceOption[]
  default?: string | string[]
}

function ChoiceBlock(props: { code: string; multi: boolean }) {
  const { theme } = useTheme()
  const cfg = tryParse<ChoiceConfig>(props.code)
  if (!cfg) return <ErrorBlock kind={props.multi ? "select" : "choice"} message="invalid JSON" />
  const options = (cfg.options ?? []).filter((o) => o && (o.label || o.value))
  if (options.length === 0)
    return <ErrorBlock kind={props.multi ? "select" : "choice"} message="no options" />
  const defaults = new Set<string>(
    Array.isArray(cfg.default) ? cfg.default.map(String) : cfg.default !== undefined ? [String(cfg.default)] : [],
  )
  return (
    <BlockCard title={cfg.question ?? cfg.prompt} subtitle={cfg.hint}>
      <For each={options}>
        {(opt, i) => {
          const value = String(opt.value ?? opt.label ?? i())
          const checked = defaults.has(value)
          const marker = props.multi ? (checked ? "[✓]" : "[ ]") : checked ? "●" : "○"
          const color = checked ? theme.primary : theme.textMuted
          return (
            <box flexDirection="column" marginTop={i() === 0 ? 0 : 1}>
              <text>
                <span style={{ fg: color }}>{marker} </span>
                <span style={{ fg: theme.text, bold: checked }}>{opt.label ?? value}</span>
              </text>
              <Show when={opt.hint || opt.description}>
                <text fg={theme.textMuted}>    {opt.hint ?? opt.description}</text>
              </Show>
            </box>
          )
        }}
      </For>
    </BlockCard>
  )
}

// ---------------------------------------------------------------------------
// callout
// ---------------------------------------------------------------------------

const calloutAliases: Record<string, { variant: string; defaultTitle: string; icon: string }> = {
  callout: { variant: "info", defaultTitle: "Info", icon: "ℹ" },
  note: { variant: "info", defaultTitle: "Note", icon: "ℹ" },
  info: { variant: "info", defaultTitle: "Info", icon: "ℹ" },
  tip: { variant: "tip", defaultTitle: "Tip", icon: "✦" },
  important: { variant: "info", defaultTitle: "Important", icon: "❗" },
  warning: { variant: "warning", defaultTitle: "Warning", icon: "⚠" },
  caution: { variant: "warning", defaultTitle: "Caution", icon: "⚠" },
  danger: { variant: "danger", defaultTitle: "Danger", icon: "✕" },
  error: { variant: "danger", defaultTitle: "Error", icon: "✕" },
  success: { variant: "success", defaultTitle: "Success", icon: "✓" },
}

function CalloutBlock(props: { code: string; variant: string }) {
  const { theme } = useTheme()
  const meta = calloutAliases[props.variant] ?? calloutAliases.info
  const colors: Record<string, RGBA> = {
    info: theme.primary,
    tip: theme.secondary,
    warning: theme.warning,
    danger: theme.error,
    success: theme.success,
  }
  const color = colors[meta.variant] ?? theme.primary
  const trimmed = props.code.replace(/^\s+|\s+$/g, "")
  if (!trimmed) return <ErrorBlock kind="callout" message="empty body" />
  // Optional title on first line as `# Title` or `Title\n` followed by blank.
  const lines = trimmed.split("\n")
  let title: string | undefined
  let body = trimmed
  if (lines.length > 1) {
    const first = lines[0]!
    const titleMatch = first.match(/^#{1,6}\s+(.+)$/)
    if (titleMatch) {
      title = titleMatch[1]!.trim()
      body = lines.slice(1).join("\n").replace(/^\n+/, "")
    } else if (lines[1]!.trim() === "") {
      title = first.trim()
      body = lines.slice(2).join("\n")
    }
  }
  if (!title && props.variant !== "callout") title = meta.defaultTitle
  return (
    <box
      flexShrink={0}
      flexDirection="column"
      marginTop={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={color}
      backgroundColor={theme.backgroundPanel}
    >
      <text>
        <span style={{ fg: color, bold: true }}>{meta.icon} </span>
        <Show when={title} fallback={<span style={{ fg: theme.text }}>{stripInline(body)}</span>}>
          <span style={{ fg: theme.text, bold: true }}>{title}</span>
        </Show>
      </text>
      <Show when={title}>
        <text fg={theme.text}>{stripInline(body)}</text>
      </Show>
    </box>
  )
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

interface PreviewConfig {
  url?: string
  title?: string
  description?: string
  site?: string
}

function PreviewBlock(props: { code: string }) {
  const { theme } = useTheme()
  const cfg = tryParse<PreviewConfig>(props.code)
  if (!cfg || !cfg.url) return <ErrorBlock kind="preview" message="missing url" />
  return (
    <BlockCard>
      <Show when={cfg.site}>
        <text fg={theme.textMuted}>{cfg.site}</text>
      </Show>
      <Show when={cfg.title}>
        <text>
          <span style={{ fg: theme.text, bold: true }}>{cfg.title}</span>
        </text>
      </Show>
      <Show when={cfg.description}>
        <text fg={theme.text}>{cfg.description}</text>
      </Show>
      <text>
        <span style={{ fg: theme.markdownLink, underline: true }}>{cfg.url}</span>
      </text>
    </BlockCard>
  )
}

// ---------------------------------------------------------------------------
// badge
// ---------------------------------------------------------------------------

interface BadgeItem {
  label?: string
  variant?: string
}

function BadgeBlock(props: { code: string }) {
  const { theme } = useTheme()
  const raw = tryParse<unknown>(props.code)
  const items: BadgeItem[] = Array.isArray(raw)
    ? (raw as BadgeItem[])
    : raw && typeof raw === "object" && Array.isArray((raw as { badges?: BadgeItem[] }).badges)
      ? (raw as { badges: BadgeItem[] }).badges
      : []
  if (items.length === 0) return <ErrorBlock kind="badge" message="no items" />
  const colors: Record<string, RGBA> = {
    info: theme.primary,
    success: theme.success,
    warning: theme.warning,
    danger: theme.error,
    neutral: theme.textMuted,
    default: theme.text,
  }
  return (
    <box flexShrink={0} marginTop={1}>
      <text>
        <For each={items}>
          {(b, i) => {
            const c = colors[b.variant ?? "default"] ?? theme.text
            return (
              <span style={{ fg: c }}>
                {i() > 0 ? " " : ""}[{b.label ?? ""}]
              </span>
            )
          }}
        </For>
      </text>
    </box>
  )
}

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------

interface ProgressBar {
  label?: string
  value?: number
  max?: number
  hint?: string
  variant?: string
}

function ProgressBlock(props: { code: string }) {
  const { theme } = useTheme()
  const raw = tryParse<unknown>(props.code)
  const bars: ProgressBar[] = Array.isArray(raw)
    ? (raw as ProgressBar[])
    : raw && typeof raw === "object" && Array.isArray((raw as { items?: ProgressBar[] }).items)
      ? (raw as { items: ProgressBar[] }).items
      : raw && typeof raw === "object" && (raw as ProgressBar).value !== undefined
        ? [raw as ProgressBar]
        : []
  if (bars.length === 0) return <ErrorBlock kind="progress" message="no items" />
  const colors: Record<string, RGBA> = {
    success: theme.success,
    warning: theme.warning,
    danger: theme.error,
    default: theme.primary,
  }
  return (
    <BlockCard>
      <For each={bars}>
        {(bar, i) => {
          const max = Number(bar.max ?? 100)
          const value = clamp(Number(bar.value ?? 0), 0, max)
          const pct = max > 0 ? (value / max) * 100 : 0
          const w = 36
          const fillCount = Math.round((pct / 100) * w)
          const fill = "█".repeat(fillCount)
          const empty = "░".repeat(w - fillCount)
          const color = colors[bar.variant ?? "default"] ?? theme.primary
          const valueLabel = max === 100 ? `${pct.toFixed(0)}%` : `${value} / ${max}`
          return (
            <box flexDirection="column" marginTop={i() === 0 ? 0 : 1}>
              <text>
                <span style={{ fg: theme.text, bold: true }}>{bar.label ?? ""}</span>
                <span style={{ fg: theme.textMuted }}>  {valueLabel}</span>
              </text>
              <text>
                <span style={{ fg: color }}>{fill}</span>
                <span style={{ fg: theme.borderSubtle }}>{empty}</span>
              </text>
              <Show when={bar.hint}>
                <text fg={theme.textMuted}>{bar.hint}</text>
              </Show>
            </box>
          )
        }}
      </For>
    </BlockCard>
  )
}

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

interface TimelineEvent {
  time?: string
  date?: string
  title?: string
  description?: string
  body?: string
  status?: "done" | "current" | "pending" | "failed"
}

function TimelineBlock(props: { code: string }) {
  const { theme } = useTheme()
  const raw = tryParse<unknown>(props.code)
  const events: TimelineEvent[] = Array.isArray(raw)
    ? (raw as TimelineEvent[])
    : raw && typeof raw === "object" && Array.isArray((raw as { events?: TimelineEvent[] }).events)
      ? (raw as { events: TimelineEvent[] }).events
      : []
  if (events.length === 0) return <ErrorBlock kind="timeline" message="no events" />
  return (
    <box flexShrink={0} marginTop={1} flexDirection="column">
      <For each={events}>
        {(evt, i) => {
          const status = evt.status ?? "done"
          const marker =
            status === "done" ? "●" : status === "current" ? "◉" : status === "failed" ? "✕" : "○"
          const color =
            status === "done"
              ? theme.success
              : status === "current"
                ? theme.primary
                : status === "failed"
                  ? theme.error
                  : theme.textMuted
          const time = evt.time ?? evt.date
          const body = evt.description ?? evt.body
          const last = i() === events.length - 1
          return (
            <box flexDirection="row">
              <box flexDirection="column" minWidth={3} flexShrink={0}>
                <text>
                  <span style={{ fg: color, bold: true }}>{marker}</span>
                </text>
                <Show when={!last}>
                  <text fg={theme.borderSubtle}>│</text>
                </Show>
              </box>
              <box flexDirection="column" paddingLeft={1} marginBottom={last ? 0 : 1}>
                <Show when={time}>
                  <text fg={theme.textMuted}>{time}</text>
                </Show>
                <Show when={evt.title}>
                  <text>
                    <span style={{ fg: theme.text, bold: true }}>{evt.title}</span>
                  </text>
                </Show>
                <Show when={body}>
                  <text fg={theme.text}>{stripInline(body!)}</text>
                </Show>
              </box>
            </box>
          )
        }}
      </For>
    </box>
  )
}

// ---------------------------------------------------------------------------
// quote
// ---------------------------------------------------------------------------

interface QuoteConfig {
  text?: string
  body?: string
  author?: string
  role?: string
  source?: string
}

function QuoteBlock(props: { code: string }) {
  const { theme } = useTheme()
  const cfg = tryParse<QuoteConfig>(props.code)
  if (!cfg) return <ErrorBlock kind="quote" message="invalid JSON" />
  const text = cfg.text ?? cfg.body
  if (!text) return <ErrorBlock kind="quote" message="missing text" />
  return (
    <box
      flexShrink={0}
      flexDirection="column"
      marginTop={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.markdownBlockQuote}
      backgroundColor={theme.backgroundPanel}
    >
      <text>
        <span style={{ fg: theme.markdownBlockQuote, bold: true }}>❝ </span>
        <span style={{ fg: theme.text, italic: true }}>{stripInline(text)}</span>
      </text>
      <Show when={cfg.author || cfg.source}>
        <text>
          <span style={{ fg: theme.textMuted }}>— </span>
          <Show when={cfg.author}>
            <span style={{ fg: theme.text, bold: true }}>{cfg.author}</span>
          </Show>
          <Show when={cfg.role}>
            <span style={{ fg: theme.textMuted }}>, {cfg.role}</span>
          </Show>
          <Show when={cfg.source}>
            <span style={{ fg: theme.textMuted }}> · {cfg.source}</span>
          </Show>
        </text>
      </Show>
    </box>
  )
}

// ---------------------------------------------------------------------------
// table
// ---------------------------------------------------------------------------

interface TableConfig {
  caption?: string
  columns?: Array<{ key?: string; label?: string; align?: string; format?: string; currency?: string }>
  rows?: Array<Record<string, unknown> | unknown[]>
  total?: boolean
}

function TableBlock(props: { code: string }) {
  const { theme } = useTheme()
  const cfg = tryParse<TableConfig>(props.code)
  if (!cfg) return <ErrorBlock kind="table" message="invalid JSON" />
  const cols = cfg.columns ?? []
  const rows = cfg.rows ?? []
  if (cols.length === 0) return <ErrorBlock kind="table" message="no columns" />

  const cellOf = (row: Record<string, unknown> | unknown[], col: NonNullable<TableConfig["columns"]>[number], idx: number): unknown => {
    if (Array.isArray(row)) return row[idx]
    if (col.key) return (row as Record<string, unknown>)[col.key]
    return undefined
  }

  const fmt = (v: unknown, col: NonNullable<TableConfig["columns"]>[number]): string => {
    if (v === undefined || v === null) return ""
    if (typeof v === "number") {
      if (col.format === "currency") return formatCurrency(v, col.currency)
      if (col.format === "percent") return `${(v * 100).toFixed(0)}%`
      if (col.format === "number") return v.toLocaleString()
      return String(v)
    }
    return stripInline(String(v))
  }

  const dataRows = rows.map((row) => cols.map((col, i) => fmt(cellOf(row, col, i), col)))
  const headerCells = cols.map((c) => c.label ?? c.key ?? "")

  const totalsRow: string[] = cfg.total
    ? cols.map((col, idx) => {
        if (col.format === "number" || col.format === "currency") {
          let sum = 0
          for (const row of rows) {
            const v = cellOf(row, col, idx)
            if (typeof v === "number") sum += v
          }
          return fmt(sum, col)
        }
        return idx === 0 ? "Total" : ""
      })
    : []

  const widths = cols.map((_, i) => {
    let w = headerCells[i]!.length
    for (const r of dataRows) w = Math.max(w, r[i]!.length)
    if (cfg.total) w = Math.max(w, totalsRow[i]!.length)
    return w
  })

  const align = (s: string, w: number, a: string) => {
    if (a === "right") return s.padStart(w, " ")
    if (a === "center") return s.padStart(Math.floor((w + s.length) / 2), " ").padEnd(w, " ")
    return s.padEnd(w, " ")
  }

  return (
    <BlockCard title={cfg.caption}>
      <text>
        <For each={headerCells}>
          {(h, i) => {
            const a = cols[i()]?.align ?? "left"
            return (
              <span style={{ fg: theme.textMuted }}>
                {align(h.toUpperCase(), widths[i()]!, a)}
                {i() < headerCells.length - 1 ? "  " : ""}
              </span>
            )
          }}
        </For>
      </text>
      <text fg={theme.borderSubtle}>{"─".repeat(widths.reduce((a, b) => a + b + 2, 0))}</text>
      <For each={dataRows}>
        {(row) => (
          <text>
            <For each={row}>
              {(cell, i) => {
                const a = cols[i()]?.align ?? "left"
                return (
                  <span style={{ fg: theme.text }}>
                    {align(cell, widths[i()]!, a)}
                    {i() < row.length - 1 ? "  " : ""}
                  </span>
                )
              }}
            </For>
          </text>
        )}
      </For>
      <Show when={cfg.total}>
        <text fg={theme.borderSubtle}>{"─".repeat(widths.reduce((a, b) => a + b + 2, 0))}</text>
        <text>
          <For each={totalsRow}>
            {(cell, i) => {
              const a = cols[i()]?.align ?? "left"
              return (
                <span style={{ fg: theme.text, bold: true }}>
                  {align(cell, widths[i()]!, a)}
                  {i() < totalsRow.length - 1 ? "  " : ""}
                </span>
              )
            }}
          </For>
        </text>
      </Show>
    </BlockCard>
  )
}

// ---------------------------------------------------------------------------
// file-tree
// ---------------------------------------------------------------------------

interface FileNode {
  name?: string
  type?: string
  children?: FileNode[]
  hint?: string
  status?: "added" | "modified" | "deleted" | "unchanged"
}

function FileTreeBlock(props: { code: string }) {
  const { theme } = useTheme()
  const raw = tryParse<unknown>(props.code)
  const root: FileNode[] = Array.isArray(raw)
    ? (raw as FileNode[])
    : raw && typeof raw === "object"
      ? (Array.isArray((raw as { nodes?: FileNode[] }).nodes)
        ? (raw as { nodes: FileNode[] }).nodes
        : Array.isArray((raw as { tree?: FileNode[] }).tree)
          ? (raw as { tree: FileNode[] }).tree
          : [])
      : []
  if (root.length === 0) return <ErrorBlock kind="file-tree" message="no nodes" />
  const lines: Array<{ name: string; folder: boolean; hint?: string; status?: string; prefix: string }> = []
  const walk = (nodes: FileNode[], prefix: string) => {
    nodes.forEach((node, i) => {
      const isLast = i === nodes.length - 1
      const isFolder =
        node.type === "folder" || node.type === "dir" || (Array.isArray(node.children) && node.children.length > 0)
      const branch = prefix + (isLast ? "└─ " : "├─ ")
      lines.push({
        name: node.name ?? "",
        folder: isFolder,
        hint: node.hint,
        status: node.status,
        prefix: branch,
      })
      if (isFolder && Array.isArray(node.children)) {
        walk(node.children, prefix + (isLast ? "   " : "│  "))
      }
    })
  }
  walk(root, "")
  return (
    <BlockCard>
      <For each={lines}>
        {(line) => (
          <text>
            <span style={{ fg: theme.borderSubtle }}>{line.prefix}</span>
            <span style={{ fg: line.folder ? theme.warning : theme.text, bold: line.folder }}>{line.name}</span>
            <Show when={line.hint}>
              <span style={{ fg: theme.textMuted }}>  {line.hint}</span>
            </Show>
            <Show when={line.status}>
              <span
                style={{
                  fg:
                    line.status === "added"
                      ? theme.success
                      : line.status === "deleted"
                        ? theme.error
                        : line.status === "modified"
                          ? theme.warning
                          : theme.textMuted,
                }}
              >
                {"  "}
                {line.status === "added"
                  ? "A"
                  : line.status === "modified"
                    ? "M"
                    : line.status === "deleted"
                      ? "D"
                      : "·"}
              </span>
            </Show>
          </text>
        )}
      </For>
    </BlockCard>
  )
}

// ---------------------------------------------------------------------------
// comparison
// ---------------------------------------------------------------------------

interface ComparisonConfig {
  title?: string
  left?: { label?: string; content?: string }
  right?: { label?: string; content?: string }
  before?: { label?: string; content?: string }
  after?: { label?: string; content?: string }
}

function ComparisonBlock(props: { code: string }) {
  const { theme } = useTheme()
  const cfg = tryParse<ComparisonConfig>(props.code)
  if (!cfg) return <ErrorBlock kind="comparison" message="invalid JSON" />
  const left = cfg.left ?? cfg.before
  const right = cfg.right ?? cfg.after
  if (!left || !right) return <ErrorBlock kind="comparison" message="missing left/right" />
  return (
    <BlockCard title={cfg.title}>
      <box flexDirection="row" gap={2} marginTop={1}>
        <box flexDirection="column" flexGrow={1} flexBasis={0}>
          <text fg={theme.textMuted}>{(left.label ?? "Before").toUpperCase()}</text>
          <text fg={theme.text}>{stripInline(left.content ?? "")}</text>
        </box>
        <box flexDirection="column" flexGrow={1} flexBasis={0}>
          <text fg={theme.textMuted}>{(right.label ?? "After").toUpperCase()}</text>
          <text fg={theme.text}>{stripInline(right.content ?? "")}</text>
        </box>
      </box>
    </BlockCard>
  )
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

function DiffBlock(props: { code: string }) {
  const { theme } = useTheme()
  const lines = props.code.replace(/\r\n?/g, "\n").split("\n")
  let add = 0
  let del = 0
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) add++
    else if (line.startsWith("-")) del++
  }
  return (
    <BlockCard>
      <text>
        <span style={{ fg: theme.success, bold: true }}>+{add}</span>
        <span style={{ fg: theme.textMuted }}>  </span>
        <span style={{ fg: theme.error, bold: true }}>−{del}</span>
      </text>
      <For each={lines}>
        {(line) => {
          let kind: "add" | "del" | "hunk" | "meta" | "ctx" = "ctx"
          if (line.startsWith("+++") || line.startsWith("---")) kind = "meta"
          else if (line.startsWith("@@")) kind = "hunk"
          else if (line.startsWith("+")) kind = "add"
          else if (line.startsWith("-")) kind = "del"
          const fg =
            kind === "add"
              ? theme.success
              : kind === "del"
                ? theme.error
                : kind === "hunk" || kind === "meta"
                  ? theme.textMuted
                  : theme.text
          return <text fg={fg}>{line}</text>
        }}
      </For>
    </BlockCard>
  )
}

// ---------------------------------------------------------------------------
// image-grid / video — TUI cannot show raster images, list URLs instead
// ---------------------------------------------------------------------------

interface ImageGridItem {
  src?: string
  url?: string
  alt?: string
  caption?: string
}

function ImageGridBlock(props: { code: string }) {
  const { theme } = useTheme()
  const raw = tryParse<unknown>(props.code)
  const items: ImageGridItem[] = Array.isArray(raw)
    ? (raw as ImageGridItem[])
    : raw && typeof raw === "object" && Array.isArray((raw as { images?: ImageGridItem[] }).images)
      ? (raw as { images: ImageGridItem[] }).images
      : []
  if (items.length === 0) return <ErrorBlock kind="image-grid" message="no images" />
  return (
    <BlockCard title={`Images (${items.length})`}>
      <For each={items}>
        {(it) => (
          <text>
            <span style={{ fg: theme.markdownLink, underline: true }}>{it.src ?? it.url ?? ""}</span>
            <Show when={it.caption ?? it.alt}>
              <span style={{ fg: theme.textMuted }}>  {it.caption ?? it.alt}</span>
            </Show>
          </text>
        )}
      </For>
    </BlockCard>
  )
}

interface VideoConfig {
  src?: string
  url?: string
  title?: string
  caption?: string
}

function VideoBlock(props: { code: string }) {
  const { theme } = useTheme()
  const cfg = tryParse<VideoConfig>(props.code)
  if (!cfg) return <ErrorBlock kind="video" message="invalid JSON" />
  const url = cfg.src ?? cfg.url
  if (!url) return <ErrorBlock kind="video" message="missing url" />
  return (
    <BlockCard title={cfg.title}>
      <text>
        <span style={{ fg: theme.markdownLink, underline: true }}>{url}</span>
      </text>
      <Show when={cfg.caption}>
        <text fg={theme.textMuted}>{cfg.caption}</text>
      </Show>
    </BlockCard>
  )
}
