// Rich custom-block renderers for chat markdown.
//
// The agent emits fenced code blocks tagged with one of these languages and
// the rendered HTML lands inside [data-component="markdown"]. The HTML uses
// data-* hooks so the markdown decorate() step can hydrate interactive
// behaviour (tab switching, etc.) — and DOMPurify keeps the output safe.
//
// Supported languages:
//   chart       — line / bar / area / pie / donut / sparkline (JSON config)
//   stock       — quote card with sparkline (JSON config)
//   tabs        — tabbed panels (JSON config, content is inline-formatted)
//   choice      — radio multi-choice question (JSON config)
//   select      — multi-select checkbox group (JSON config)
//   callout     — admonition box; aliases: note, info, tip, warning, danger,
//                 success, error, important — body uses inline markdown
//   preview     — URL/link preview card (JSON config)
//   kpi         — metric tile grid (JSON config)
//   video       — embedded video player (JSON config, https-only)
//
// Each renderer returns a string of pre-sanitized HTML rooted at
// [data-component="markdown-block"]. Returning null means the block is not
// custom and should fall through to the regular code-block highlighter.

import { checksum } from "@codeplane-ai/shared/util/encode"

// Curated palette tuned for both light and dark surfaces. Picks lean slightly
// desaturated so adjacent series stay distinguishable without clashing.
const palette = [
  "#5b8def", // soft blue
  "#f5a35a", // amber
  "#c79dee", // lilac
  "#5cc4a3", // teal
  "#e98ba5", // rose
  "#f4cf5a", // wheat
  "#7aa9f7", // sky
  "#ef6b56", // coral
]

export type BlockLang =
  | "chart"
  | "stock"
  | "tabs"
  | "choice"
  | "select"
  | "callout"
  | "note"
  | "info"
  | "tip"
  | "warning"
  | "danger"
  | "error"
  | "success"
  | "important"
  | "preview"
  | "kpi"
  | "video"
  | "timeline"
  | "progress"
  | "badge"
  | "quote"
  | "table"
  | "file-tree"
  | "tree"
  | "image-grid"
  | "gallery"
  | "comparison"
  | "diff"

const blockLangs = new Set<string>([
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

export function isMarkdownBlockLang(lang?: string | null): boolean {
  if (!lang) return false
  return blockLangs.has(lang.toLowerCase())
}

export function renderMarkdownBlock(code: string, lang: string): string | null {
  const key = lang.toLowerCase()
  const hash = checksum(`${key}:${code}`) ?? ""
  let html: string | null = null
  switch (key) {
    case "chart":
      html = safeRender("chart", () => renderChart(parseJson(code)))
      break
    case "stock":
      html = safeRender("stock", () => renderStock(parseJson(code)))
      break
    case "tabs":
      html = safeRender("tabs", () => renderTabs(parseJson(code)))
      break
    case "choice":
      html = safeRender("choice", () => renderChoice(parseJson(code)))
      break
    case "select":
      html = safeRender("select", () => renderSelect(parseJson(code)))
      break
    case "callout":
    case "note":
    case "info":
    case "tip":
    case "warning":
    case "danger":
    case "error":
    case "success":
    case "important":
      html = safeRender("callout", () => renderCallout(code, key))
      break
    case "preview":
      html = safeRender("preview", () => renderPreview(parseJson(code)))
      break
    case "kpi":
      html = safeRender("kpi", () => renderKpi(parseJson(code)))
      break
    case "video":
      html = safeRender("video", () => renderVideo(parseJson(code)))
      break
    case "timeline":
      html = safeRender("timeline", () => renderTimeline(parseJson(code)))
      break
    case "progress":
      html = safeRender("progress", () => renderProgress(parseJson(code)))
      break
    case "badge":
      html = safeRender("badge", () => renderBadge(parseJson(code)))
      break
    case "quote":
      html = safeRender("quote", () => renderQuote(parseJson(code)))
      break
    case "table":
      html = safeRender("table", () => renderRichTable(parseJson(code)))
      break
    case "file-tree":
    case "tree":
      html = safeRender("file-tree", () => renderFileTree(parseJson(code)))
      break
    case "image-grid":
    case "gallery":
      html = safeRender("image-grid", () => renderImageGrid(parseJson(code)))
      break
    case "comparison":
      html = safeRender("comparison", () => renderComparison(parseJson(code)))
      break
    case "diff":
      html = safeRender("diff", () => renderDiff(code))
      break
    default:
      return null
  }
  if (!html) return null
  // Tag the outer container with the source hash so morphdom can skip subtree
  // updates while the block is unchanged — preserving user state (selected
  // tab, checked option) across streaming re-renders.
  return html.replace(/^(<[a-z]+ data-component="markdown-block")/i, `$1 data-block-hash="${hash}"`)
}

function safeRender(kind: string, fn: () => string): string {
  try {
    return fn()
  } catch (err) {
    return renderError(kind, err instanceof Error ? err.message : String(err))
  }
}

function renderError(kind: string, message: string): string {
  return [
    `<div data-component="markdown-block" data-block-type="error" data-block-kind="${escape(kind)}">`,
    `<div data-slot="block-error-title">${escape(kind)} block failed to render</div>`,
    `<div data-slot="block-error-message">${escape(message)}</div>`,
    `</div>`,
  ].join("")
}

function escape(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function safeNum(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function safeUrl(href: unknown, allowedProtocols = ["https:", "http:"]): string | undefined {
  if (typeof href !== "string" || !href) return
  try {
    const url = new URL(href)
    if (!allowedProtocols.includes(url.protocol)) return
    return url.toString()
  } catch {
    return
  }
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function parseJson(code: string): unknown {
  const trimmed = code.trim()
  if (!trimmed) throw new Error("empty payload")
  try {
    return JSON.parse(trimmed)
  } catch (err) {
    throw new Error(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Inline markdown formatter — handles **bold**, *italic*, `code`, [link](url),
// and newline → <br>. Fully escaped so it is safe to inject inside other
// rendered blocks (tabs, callouts, etc.) without going through the main parser.
function formatInline(text: string): string {
  let out = escape(text).replace(/\r\n?/g, "\n")
  // links
  out = out.replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (_, label, href) => {
    const url = safeUrl(href)
    if (!url) return label
    return `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer" class="external-link">${label}</a>`
  })
  // inline code first so `**` inside backticks survives
  out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>")
  // bold
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
  out = out.replace(/__([^_\n]+?)__/g, "<strong>$1</strong>")
  // italic
  out = out.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
  out = out.replace(/(^|[^_\w])_([^_\n]+?)_(?!_)/g, "$1<em>$2</em>")
  // line breaks → <br>; double-newlines collapse into paragraph spacing via CSS
  out = out.replace(/\n{2,}/g, '</p><p data-slot="inline-paragraph">')
  out = out.replace(/\n/g, "<br>")
  return `<p data-slot="inline-paragraph">${out}</p>`
}

// ---------------------------------------------------------------------------
// chart
// ---------------------------------------------------------------------------

type ChartType = "line" | "bar" | "area" | "pie" | "donut" | "sparkline"

interface ChartSeries {
  name?: string
  data: number[]
  color?: string
}

interface ChartConfig {
  type?: ChartType
  title?: string
  subtitle?: string
  labels?: string[]
  series?: ChartSeries[]
  data?: number[]
  height?: number
  format?: "number" | "currency" | "percent"
  currency?: string
  yMin?: number
  yMax?: number
  showGrid?: boolean
  showLegend?: boolean
}

function renderChart(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("chart payload must be an object")
  const cfg = payload as ChartConfig
  const type = (cfg.type ?? "line") as ChartType

  const series: ChartSeries[] = []
  const declared = Array.isArray(cfg.series) ? cfg.series : []
  for (const s of declared) {
    if (s && Array.isArray(s.data) && s.data.length > 0) {
      series.push({ name: s.name, data: s.data.map((v) => safeNum(v)), color: s.color })
    }
  }
  if (series.length === 0 && Array.isArray(cfg.data) && cfg.data.length > 0) {
    series.push({ data: cfg.data.map((v) => safeNum(v)) })
  }
  if (series.length === 0) throw new Error("chart needs series or data")

  const labels = Array.isArray(cfg.labels) ? cfg.labels.map((l) => String(l)) : []
  const w = 640
  const height = clamp(safeNum(cfg.height, 220), 100, 480)
  const showGrid = cfg.showGrid !== false
  // Pie / donut want a per-SLICE legend (one entry per category) even when
  // there is only a single series.  Other chart types use a per-SERIES
  // legend and only render it when there is something to disambiguate
  // (multiple series, or a single named series).
  const isPie = type === "pie" || type === "donut"
  const showLegend =
    cfg.showLegend !== false &&
    (isPie ? series[0]!.data.some((v) => safeNum(v) > 0) : series.length > 1 || !!series[0]?.name)
  const formatter = makeFormatter(cfg.format, cfg.currency)

  let svgInner = ""
  switch (type) {
    case "pie":
    case "donut":
      svgInner = renderPieBody(series[0]!.data, labels, w, height, type === "donut", formatter)
      break
    case "bar":
      svgInner = renderBarBody(series, labels, w, height, showGrid, formatter, cfg)
      break
    case "sparkline":
      svgInner = renderSparklineBody(series[0]!.data, w, height)
      break
    case "area":
    case "line":
    default:
      svgInner = renderLineBody(series, labels, w, height, showGrid, type === "area", formatter, cfg)
      break
  }

  const titleHtml = cfg.title ? `<div data-slot="chart-title">${escape(cfg.title)}</div>` : ""
  const subtitleHtml = cfg.subtitle ? `<div data-slot="chart-subtitle">${escape(cfg.subtitle)}</div>` : ""
  const legendHtml = showLegend ? renderLegend(type, series, labels, formatter) : ""

  return [
    `<div data-component="markdown-block" data-block-type="chart" data-chart-type="${escape(type)}">`,
    titleHtml,
    subtitleHtml,
    `<div data-slot="chart-canvas">`,
    `<svg viewBox="0 0 ${w} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escape(cfg.title ?? `${type} chart`)}">${svgInner}</svg>`,
    `</div>`,
    legendHtml,
    `</div>`,
  ].join("")
}

function makeFormatter(format?: ChartConfig["format"], currency?: string) {
  return (v: number): string => {
    if (!Number.isFinite(v)) return ""
    if (format === "currency") {
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currency || "USD",
          maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2,
        }).format(v)
      } catch {
        return v.toFixed(2)
      }
    }
    if (format === "percent") {
      return `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`
    }
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`
    if (Number.isInteger(v)) return v.toString()
    return v.toFixed(Math.abs(v) < 1 ? 2 : 1)
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

function bounds(values: number[], cfgMin?: number, cfgMax?: number) {
  if (values.length === 0) return { min: 0, max: 1 }
  let min = cfgMin ?? Math.min(...values)
  let max = cfgMax ?? Math.max(...values)
  if (min === max) {
    if (min === 0) {
      max = 1
    } else {
      const pad = Math.abs(min) * 0.2 || 1
      min -= pad
      max += pad
    }
  } else {
    const pad = (max - min) * 0.1
    if (cfgMin === undefined) min -= pad
    if (cfgMax === undefined) max += pad
  }
  return { min, max }
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min]
  const step = (max - min) / count
  const ticks: number[] = []
  for (let i = 0; i <= count; i++) ticks.push(min + step * i)
  return ticks
}

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ""
  if (points.length === 1) return `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`
  let d = `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(points.length - 1, i + 2)]!
    const tension = 0.18
    const c1x = p1.x + (p2.x - p0.x) * tension
    const c1y = p1.y + (p2.y - p0.y) * tension
    const c2x = p2.x - (p3.x - p1.x) * tension
    const c2y = p2.y - (p3.y - p1.y) * tension
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

function renderLineBody(
  series: ChartSeries[],
  labels: string[],
  w: number,
  h: number,
  showGrid: boolean,
  area: boolean,
  fmt: (v: number) => string,
  cfg: ChartConfig,
): string {
  const padL = 48
  const padR = 14
  const padT = 14
  const padB = labels.length ? 28 : 14
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const all = series.flatMap((s) => s.data)
  const { min, max } = bounds(all, cfg.yMin, cfg.yMax)
  const len = Math.max(...series.map((s) => s.data.length))
  const x = (i: number) => padL + (len <= 1 ? innerW / 2 : (i / (len - 1)) * innerW)
  const y = (v: number) => padT + innerH - ((v - min) / (max - min)) * innerH

  const ticks = niceTicks(min, max, 4)
  let grid = ""
  if (showGrid) {
    grid += ticks
      .map((t) => {
        const yy = y(t).toFixed(2)
        return `<line x1="${padL}" x2="${w - padR}" y1="${yy}" y2="${yy}" stroke="var(--border-weaker-base)" stroke-width="1" stroke-dasharray="2 4"/>`
      })
      .join("")
    grid += ticks
      .map(
        (t) =>
          `<text x="${padL - 8}" y="${(y(t) + 4).toFixed(2)}" font-size="10" text-anchor="end" fill="var(--text-weak)" font-family="var(--font-family-mono)">${escape(fmt(t))}</text>`,
      )
      .join("")
  }

  let labelMarks = ""
  if (labels.length) {
    const step = Math.max(1, Math.ceil(labels.length / 8))
    labelMarks = labels
      .map((label, i) => {
        if (i % step !== 0 && i !== labels.length - 1) return ""
        const xx = x(i).toFixed(2)
        return `<text x="${xx}" y="${h - 8}" font-size="10" text-anchor="middle" fill="var(--text-weak)">${escape(label)}</text>`
      })
      .filter(Boolean)
      .join("")
  }

  let plot = ""
  series.forEach((s, idx) => {
    const color = s.color || palette[idx % palette.length]
    const pts = s.data.map((v, i) => ({ x: x(i), y: y(v) }))
    const linePath = smoothPath(pts)
    if (area) {
      const baseY = y(min).toFixed(2)
      // Solid colour + opacity instead of a referenced gradient — sanitizer
      // safe and renders identically with one stacked translucent layer.
      plot += `<path d="${linePath} L ${(padL + innerW).toFixed(2)} ${baseY} L ${padL.toFixed(2)} ${baseY} Z" fill="${escape(color)}" fill-opacity="0.18"/>`
    }
    plot += `<path d="${linePath}" fill="none" stroke="${escape(color)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    plot += s.data
      .map(
        (v, i) =>
          `<g data-slot="chart-point"><circle cx="${x(i).toFixed(2)}" cy="${y(v).toFixed(2)}" r="3" fill="var(--surface-base)" stroke="${escape(color)}" stroke-width="1.5"/><title>${escape(`${s.name ? `${s.name}: ` : ""}${fmt(v)}${labels[i] ? ` — ${labels[i]}` : ""}`)}</title></g>`,
      )
      .join("")
  })

  return grid + plot + labelMarks
}

function renderBarBody(
  series: ChartSeries[],
  labels: string[],
  w: number,
  h: number,
  showGrid: boolean,
  fmt: (v: number) => string,
  cfg: ChartConfig,
): string {
  const padL = 48
  const padR = 14
  const padT = 14
  const padB = labels.length ? 30 : 16
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const all = series.flatMap((s) => s.data)
  const { min, max } = bounds(all.concat(0), cfg.yMin, cfg.yMax)
  const len = Math.max(...series.map((s) => s.data.length))
  const groupW = innerW / Math.max(1, len)
  const barW = (groupW * 0.65) / series.length
  const baseY = padT + innerH - ((0 - min) / (max - min)) * innerH

  const ticks = niceTicks(min, max, 4)
  let grid = ""
  if (showGrid) {
    grid += ticks
      .map((t) => {
        const yy = (padT + innerH - ((t - min) / (max - min)) * innerH).toFixed(2)
        return `<line x1="${padL}" x2="${w - padR}" y1="${yy}" y2="${yy}" stroke="var(--border-weaker-base)" stroke-width="1" stroke-dasharray="2 4"/>`
      })
      .join("")
    grid += ticks
      .map((t) => {
        const yy = (padT + innerH - ((t - min) / (max - min)) * innerH + 4).toFixed(2)
        return `<text x="${padL - 8}" y="${yy}" font-size="10" text-anchor="end" fill="var(--text-weak)" font-family="var(--font-family-mono)">${escape(fmt(t))}</text>`
      })
      .join("")
  }

  let plot = ""
  for (let i = 0; i < len; i++) {
    series.forEach((s, sIdx) => {
      const v = s.data[i] ?? 0
      const color = s.color || palette[sIdx % palette.length]
      const yVal = padT + innerH - ((v - min) / (max - min)) * innerH
      const top = Math.min(baseY, yVal)
      const heightVal = Math.max(2, Math.abs(yVal - baseY))
      const xPos = padL + groupW * i + (groupW - barW * series.length) / 2 + sIdx * barW
      // Two-rect technique: solid bar + lighter highlight on top half. Avoids
      // <defs id> indirection which DOMPurify's SANITIZE_NAMED_PROPS rewrites.
      plot += `<rect x="${xPos.toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${heightVal.toFixed(2)}" rx="3" fill="${escape(color)}" fill-opacity="0.88"><title>${escape(`${s.name ?? "value"}: ${fmt(v)}${labels[i] ? ` — ${labels[i]}` : ""}`)}</title></rect>`
    })
  }

  let labelMarks = ""
  if (labels.length) {
    labelMarks = labels
      .map((label, i) => {
        const cx = (padL + groupW * i + groupW / 2).toFixed(2)
        return `<text x="${cx}" y="${h - 10}" font-size="10" text-anchor="middle" fill="var(--text-weak)">${escape(label)}</text>`
      })
      .join("")
  }

  return grid + plot + labelMarks
}

function renderPieBody(
  data: number[],
  labels: string[],
  w: number,
  h: number,
  donut: boolean,
  fmt: (v: number) => string,
): string {
  const cx = w / 2
  const cy = h / 2
  const r = Math.min(w, h) / 2 - 18
  const inner = donut ? r * 0.62 : 0
  const total = data.reduce((sum, v) => sum + Math.max(0, safeNum(v)), 0)
  if (total <= 0) throw new Error("pie data sums to 0")
  let angle = -Math.PI / 2
  let parts = ""
  data.forEach((raw, i) => {
    const v = Math.max(0, safeNum(raw))
    if (v <= 0) return
    const slice = (v / total) * Math.PI * 2
    const next = angle + slice
    const x1 = cx + Math.cos(angle) * r
    const y1 = cy + Math.sin(angle) * r
    const x2 = cx + Math.cos(next) * r
    const y2 = cy + Math.sin(next) * r
    const large = slice > Math.PI ? 1 : 0
    const color = palette[i % palette.length]
    if (donut) {
      const ix1 = cx + Math.cos(next) * inner
      const iy1 = cy + Math.sin(next) * inner
      const ix2 = cx + Math.cos(angle) * inner
      const iy2 = cy + Math.sin(angle) * inner
      parts += `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${ix1.toFixed(2)} ${iy1.toFixed(2)} A ${inner} ${inner} 0 ${large} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)} Z" fill="${escape(color)}" stroke="var(--surface-base)" stroke-width="1.5"><title>${escape(`${labels[i] ?? `slice ${i + 1}`}: ${fmt(v)} (${((v / total) * 100).toFixed(1)}%)`)}</title></path>`
    } else {
      parts += `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${escape(color)}" stroke="var(--surface-base)" stroke-width="1.5"><title>${escape(`${labels[i] ?? `slice ${i + 1}`}: ${fmt(v)} (${((v / total) * 100).toFixed(1)}%)`)}</title></path>`
    }
    angle = next
  })
  if (donut) {
    // For percent-formatted data the values are already shares, so the
    // center label shows the slice count rather than a misleading total.
    const centerLabel =
      total >= 99.5 && total <= 100.5
        ? `${data.filter((v) => safeNum(v) > 0).length}`
        : fmt(total)
    const centerSub = total >= 99.5 && total <= 100.5 ? "SLICES" : "TOTAL"
    parts += `<text x="${cx}" y="${cy - 4}" font-size="18" font-weight="500" text-anchor="middle" dominant-baseline="middle" fill="var(--text-strong)">${escape(centerLabel)}</text>`
    parts += `<text x="${cx}" y="${cy + 14}" font-size="10" text-anchor="middle" dominant-baseline="middle" fill="var(--text-weak)" letter-spacing="0.08em">${centerSub}</text>`
  }
  return parts
}

function renderSparklineBody(data: number[], w: number, h: number): string {
  if (data.length < 2) return ""
  const padX = 4
  const padY = 4
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const x = (i: number) => padX + (i / (data.length - 1)) * innerW
  const y = (v: number) => padY + innerH - ((v - min) / range) * innerH
  const pts = data.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ")
  const trend = data[data.length - 1]! >= data[0]! ? "var(--icon-diff-add-base)" : "var(--icon-diff-delete-base)"
  return `<polyline points="${pts}" fill="none" stroke="${trend}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
}

function renderLegend(
  type: ChartType,
  series: ChartSeries[],
  labels: string[],
  fmt: (v: number) => string,
): string {
  if (series.length === 0) return ""
  // Pie / donut: one legend entry per SLICE (categorical), with the slice's
  // share so the legend doubles as a quick read-out.  Empty / zero slices
  // are skipped so the legend doesn't list categories that aren't drawn.
  if (type === "pie" || type === "donut") {
    const data = series[0]!.data
    const total = data.reduce((sum, v) => sum + Math.max(0, safeNum(v)), 0)
    const items = data
      .map((raw, i) => {
        const v = Math.max(0, safeNum(raw))
        if (v <= 0) return ""
        const color = palette[i % palette.length]
        const label = labels[i] ?? `Slice ${i + 1}`
        const pct = total > 0 ? (v / total) * 100 : 0
        const isPercent = total >= 99.5 && total <= 100.5
        const valueText = isPercent ? `${pct.toFixed(1)}%` : `${fmt(v)} (${pct.toFixed(1)}%)`
        return [
          `<li>`,
          `<span data-slot="legend-swatch" style="background:${escape(color)}"></span>`,
          `<span data-slot="legend-label">${escape(label)}</span>`,
          `<span data-slot="legend-value">${escape(valueText)}</span>`,
          `</li>`,
        ].join("")
      })
      .join("")
    return `<ul data-slot="chart-legend" data-legend-variant="categorical">${items}</ul>`
  }
  // Line / bar / area: one entry per SERIES.
  const items = series
    .map((s, i) => {
      const color = s.color || palette[i % palette.length]
      const name = s.name ?? `Series ${i + 1}`
      return `<li><span data-slot="legend-swatch" style="background:${escape(color)}"></span><span data-slot="legend-label">${escape(name)}</span></li>`
    })
    .join("")
  return `<ul data-slot="chart-legend">${items}</ul>`
}

// ---------------------------------------------------------------------------
// stock
// ---------------------------------------------------------------------------

interface StockConfig {
  ticker?: string
  symbol?: string
  name?: string
  exchange?: string
  price?: number | string
  change?: number | string
  changePercent?: number | string
  currency?: string
  history?: number[]
  asOf?: string
}

function renderStock(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("stock payload must be an object")
  const cfg = payload as StockConfig
  const ticker = cfg.ticker || cfg.symbol
  if (!ticker) throw new Error("stock needs a ticker")
  const price = safeNum(cfg.price)
  const hasPrice = cfg.price !== undefined
  const change = safeNum(cfg.change)
  const hasChange = cfg.change !== undefined
  const changePct = safeNum(cfg.changePercent)
  const hasChangePct = cfg.changePercent !== undefined
  const currency = cfg.currency || "USD"
  const history = Array.isArray(cfg.history) ? cfg.history.map((v) => safeNum(v)) : []

  const direction = change >= 0 ? "up" : change < 0 ? "down" : "flat"
  const fmtPrice = (() => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(price)
    } catch {
      return `${price.toFixed(2)} ${currency}`
    }
  })()
  const sign = change > 0 ? "+" : change < 0 ? "−" : ""
  const absChange = Math.abs(change).toFixed(2)
  const absPct = Math.abs(changePct).toFixed(2)

  const header = [
    `<div data-slot="stock-header">`,
    `<div data-slot="stock-id">`,
    `<div data-slot="stock-ticker">${escape(ticker.toUpperCase())}</div>`,
    cfg.name ? `<div data-slot="stock-name">${escape(cfg.name)}</div>` : "",
    `</div>`,
    cfg.exchange ? `<div data-slot="stock-exchange">${escape(cfg.exchange)}</div>` : "",
    `</div>`,
  ].join("")

  const priceBlock = hasPrice
    ? [
        `<div data-slot="stock-price-row">`,
        `<div data-slot="stock-price">${escape(fmtPrice)}</div>`,
        hasChange || hasChangePct
          ? [
              `<div data-slot="stock-change" data-direction="${direction}">`,
              `<span data-slot="stock-change-arrow" aria-hidden="true">${direction === "up" ? "▲" : direction === "down" ? "▼" : "■"}</span>`,
              hasChange ? `<span data-slot="stock-change-abs">${escape(`${sign}${absChange}`)}</span>` : "",
              hasChangePct ? `<span data-slot="stock-change-pct">${escape(`(${sign}${absPct}%)`)}</span>` : "",
              `</div>`,
            ].join("")
          : "",
        `</div>`,
      ].join("")
    : ""

  let sparkline = ""
  if (history.length >= 2) {
    const trendUp = history[history.length - 1]! >= history[0]!
    const color = trendUp ? "var(--icon-diff-add-base)" : "var(--icon-diff-delete-base)"
    sparkline = [
      `<div data-slot="stock-sparkline">`,
      `<svg viewBox="0 0 320 80" preserveAspectRatio="none" role="img" aria-label="${escape(ticker)} sparkline">`,
      renderSparklineFilled(history, 320, 80, color),
      `</svg>`,
      `</div>`,
    ].join("")
  }

  const footer = cfg.asOf ? `<div data-slot="stock-asof">As of ${escape(cfg.asOf)}</div>` : ""

  return [
    `<div data-component="markdown-block" data-block-type="stock" data-direction="${direction}">`,
    header,
    priceBlock,
    sparkline,
    footer,
    `</div>`,
  ].join("")
}

function renderSparklineFilled(data: number[], w: number, h: number, color: string): string {
  if (data.length < 2) return ""
  const padX = 2
  const padY = 4
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => ({
    x: padX + (i / (data.length - 1)) * innerW,
    y: padY + innerH - ((v - min) / range) * innerH,
  }))
  const linePath = smoothPath(points)
  const baseY = (padY + innerH).toFixed(2)
  const fillPath = `${linePath} L ${points[points.length - 1]!.x.toFixed(2)} ${baseY} L ${points[0]!.x.toFixed(2)} ${baseY} Z`
  const last = points[points.length - 1]!
  return [
    `<path d="${fillPath}" fill="${color}" fill-opacity="0.18"/>`,
    `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="6" fill="${color}" fill-opacity="0.2"/>`,
    `<circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="3" fill="${color}"/>`,
  ].join("")
}

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------

interface TabsConfig {
  tabs?: Array<{ label?: string; title?: string; content?: string; body?: string }>
  default?: number | string
}

function renderTabs(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("tabs payload must be an object")
  const cfg = payload as TabsConfig
  const tabs = (cfg.tabs ?? []).filter((t) => t && (t.content || t.body))
  if (tabs.length === 0) throw new Error("tabs needs at least one entry")
  const groupId = `mb-tabs-${uid()}`
  const defaultIdx = (() => {
    if (typeof cfg.default === "number") return clamp(cfg.default, 0, tabs.length - 1)
    if (typeof cfg.default === "string") {
      const idx = tabs.findIndex((t) => (t.label ?? t.title) === cfg.default)
      if (idx >= 0) return idx
    }
    return 0
  })()

  const tabButtons = tabs
    .map((t, i) => {
      const id = `${groupId}-tab-${i}`
      const panelId = `${groupId}-panel-${i}`
      const active = i === defaultIdx
      return `<button type="button" role="tab" id="${id}" data-slot="tabs-tab" data-tabs-index="${i}" aria-selected="${active}" aria-controls="${panelId}" tabindex="${active ? 0 : -1}">${escape(t.label ?? t.title ?? `Tab ${i + 1}`)}</button>`
    })
    .join("")

  const panels = tabs
    .map((t, i) => {
      const id = `${groupId}-tab-${i}`
      const panelId = `${groupId}-panel-${i}`
      const active = i === defaultIdx
      const body = t.content ?? t.body ?? ""
      return `<div role="tabpanel" id="${panelId}" data-slot="tabs-panel" data-tabs-index="${i}" aria-labelledby="${id}" ${active ? "" : "hidden"}>${formatInline(body)}</div>`
    })
    .join("")

  return [
    `<div data-component="markdown-block" data-block-type="tabs" data-tabs-group="${groupId}">`,
    `<div role="tablist" data-slot="tabs-list">${tabButtons}</div>`,
    `<div data-slot="tabs-panels">${panels}</div>`,
    `</div>`,
  ].join("")
}

// ---------------------------------------------------------------------------
// choice / select
// ---------------------------------------------------------------------------

interface ChoiceOption {
  label?: string
  value?: string
  hint?: string
  description?: string
  disabled?: boolean
}

interface ChoiceConfig {
  question?: string
  prompt?: string
  hint?: string
  options?: ChoiceOption[]
  multi?: boolean
  default?: string | string[]
}

function renderChoice(payload: unknown): string {
  return renderChoiceLike(payload, false)
}

function renderSelect(payload: unknown): string {
  // `select` defaults to multi-pick; explicit multi:false flips to radio.
  if (!payload || typeof payload !== "object") throw new Error("select payload must be an object")
  const obj = payload as ChoiceConfig
  const multi = obj.multi !== false
  return renderChoiceLike({ ...obj, multi }, true)
}

function renderChoiceLike(payload: unknown, defaultMulti: boolean): string {
  if (!payload || typeof payload !== "object") throw new Error("choice payload must be an object")
  const cfg = payload as ChoiceConfig
  const options = (cfg.options ?? []).filter((o) => o && (o.label || o.value))
  if (options.length === 0) throw new Error("choice needs at least one option")
  const multi = cfg.multi ?? defaultMulti
  const groupId = `mb-choice-${uid()}`
  const name = `${groupId}-name`
  const defaults = new Set<string>(
    Array.isArray(cfg.default)
      ? cfg.default.map(String)
      : cfg.default !== undefined
        ? [String(cfg.default)]
        : [],
  )

  const items = options
    .map((opt, i) => {
      const value = String(opt.value ?? opt.label ?? i)
      const id = `${groupId}-${i}`
      const checked = defaults.has(value)
      const disabled = opt.disabled === true
      return [
        `<label data-slot="choice-option" ${disabled ? `data-disabled="true"` : ""} for="${id}">`,
        `<input type="${multi ? "checkbox" : "radio"}" name="${name}" id="${id}" value="${escape(value)}" data-slot="choice-input"${checked ? " checked" : ""}${disabled ? " disabled" : ""} />`,
        `<span data-slot="choice-indicator" aria-hidden="true"></span>`,
        `<span data-slot="choice-text">`,
        `<span data-slot="choice-label">${escape(opt.label ?? value)}</span>`,
        opt.hint || opt.description
          ? `<span data-slot="choice-hint">${escape(opt.hint ?? opt.description ?? "")}</span>`
          : "",
        `</span>`,
        `</label>`,
      ].join("")
    })
    .join("")

  const question = cfg.question ?? cfg.prompt
  return [
    `<div data-component="markdown-block" data-block-type="${multi ? "select" : "choice"}" data-choice-group="${groupId}">`,
    question ? `<div data-slot="choice-question">${escape(question)}</div>` : "",
    cfg.hint ? `<div data-slot="choice-meta">${escape(cfg.hint)}</div>` : "",
    `<div role="${multi ? "group" : "radiogroup"}" data-slot="choice-options">${items}</div>`,
    `</div>`,
  ].join("")
}

// ---------------------------------------------------------------------------
// callout
// ---------------------------------------------------------------------------

const calloutAliases: Record<string, string> = {
  callout: "info",
  note: "info",
  info: "info",
  tip: "tip",
  important: "info",
  warning: "warning",
  caution: "warning",
  danger: "danger",
  error: "danger",
  success: "success",
}

function renderCallout(code: string, lang: string): string {
  const trimmed = code.replace(/^\s+|\s+$/g, "")
  if (!trimmed) throw new Error("callout body is empty")
  let variant = calloutAliases[lang] ?? "info"
  let title: string | undefined
  let body = trimmed
  // Agents often emit JSON like {"type":"info","title":"...","body":"..."} for
  // callouts even though markdown text is the documented form. Detect that and
  // unpack it transparently so the user does not see raw JSON in the bubble.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed) as {
        type?: string
        variant?: string
        title?: string
        heading?: string
        body?: string
        content?: string
        text?: string
        message?: string
      }
      if (obj && typeof obj === "object") {
        const explicit = (obj.type ?? obj.variant ?? "").toLowerCase()
        if (explicit && calloutAliases[explicit]) variant = calloutAliases[explicit]!
        title = obj.title ?? obj.heading
        const bodyText = obj.body ?? obj.content ?? obj.text ?? obj.message
        if (typeof bodyText === "string") body = bodyText.replace(/\\n/g, "\n")
        else if (title) body = ""
      }
    } catch {
      // not JSON, fall through to markdown handling below
    }
  }
  // Support optional title on first line: `# Title` or just first non-empty line
  // when followed by a blank line.
  if (title === undefined) {
    const lines = body.split("\n")
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
  }
  if (!title && lang !== "callout") {
    title = lang.charAt(0).toUpperCase() + lang.slice(1)
  }
  return [
    `<div data-component="markdown-block" data-block-type="callout" data-callout-variant="${escape(variant)}">`,
    `<div data-slot="callout-icon" aria-hidden="true">${calloutIconSvg(variant)}</div>`,
    `<div data-slot="callout-body">`,
    title ? `<div data-slot="callout-title">${escape(title)}</div>` : "",
    body ? `<div data-slot="callout-content">${formatInline(body)}</div>` : "",
    `</div>`,
    `</div>`,
  ].join("")
}

function calloutIconSvg(variant: string): string {
  const paths: Record<string, string> = {
    info: '<path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm0 6.25a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4A.75.75 0 0 1 10 8.75Zm0-3.5a.95.95 0 1 1 0 1.9.95.95 0 0 1 0-1.9Z" fill="currentColor"/>',
    tip: '<path d="M10 2.5a5 5 0 0 0-3 9.05V13a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.45a5 5 0 0 0-3-9.05ZM8 15.5a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 8 15.5Z" fill="currentColor"/>',
    warning:
      '<path d="M9.13 3.05a1 1 0 0 1 1.74 0l6.4 11.2A1 1 0 0 1 16.4 16H3.6a1 1 0 0 1-.87-1.5l6.4-11.45ZM10 7.5a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 10 7.5Zm0 6a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Z" fill="currentColor"/>',
    danger:
      '<path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm-2.78 4.72a.75.75 0 0 1 1.06 0L10 8.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L11.06 10l1.72 1.72a.75.75 0 0 1-1.06 1.06L10 11.06l-1.72 1.72a.75.75 0 0 1-1.06-1.06L8.94 10 7.22 8.28a.75.75 0 0 1 0-1.06Z" fill="currentColor"/>',
    success:
      '<path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm3.78 5.97-4.5 4.5a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 1 1 1.06-1.06l1.72 1.72 3.97-3.97a.75.75 0 1 1 1.06 1.06Z" fill="currentColor"/>',
  }
  return `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">${paths[variant] ?? paths.info}</svg>`
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

interface PreviewConfig {
  url?: string
  title?: string
  description?: string
  image?: string
  site?: string
  favicon?: string
}

function renderPreview(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("preview payload must be an object")
  const cfg = payload as PreviewConfig
  const url = safeUrl(cfg.url)
  if (!url) throw new Error("preview needs an https URL")
  const image = safeUrl(cfg.image)
  const favicon = safeUrl(cfg.favicon)
  const host = new URL(url).host
  return [
    `<a data-component="markdown-block" data-block-type="preview" href="${escape(url)}" target="_blank" rel="noopener noreferrer">`,
    image ? `<div data-slot="preview-image"><img src="${escape(image)}" alt="" loading="lazy"/></div>` : "",
    `<div data-slot="preview-body">`,
    `<div data-slot="preview-meta">`,
    favicon ? `<img data-slot="preview-favicon" src="${escape(favicon)}" alt="" loading="lazy"/>` : "",
    `<span data-slot="preview-site">${escape(cfg.site ?? host)}</span>`,
    `</div>`,
    cfg.title ? `<div data-slot="preview-title">${escape(cfg.title)}</div>` : "",
    cfg.description ? `<div data-slot="preview-description">${escape(cfg.description)}</div>` : "",
    `<div data-slot="preview-url">${escape(url)}</div>`,
    `</div>`,
    `</a>`,
  ].join("")
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

function renderKpi(payload: unknown): string {
  const tiles = Array.isArray(payload)
    ? (payload as KpiTile[])
    : payload && typeof payload === "object" && Array.isArray((payload as { tiles?: KpiTile[] }).tiles)
      ? (payload as { tiles: KpiTile[] }).tiles
      : null
  if (!tiles || tiles.length === 0) throw new Error("kpi needs an array of tiles")

  const items = tiles
    .map((tile) => {
      const value = tile.value ?? "—"
      const valueText = typeof value === "number" ? formatKpiNumber(value) : escape(value)
      const trend =
        tile.trend ??
        (typeof tile.delta === "number" ? (tile.delta > 0 ? "up" : tile.delta < 0 ? "down" : "flat") : "flat")
      const deltaText = (() => {
        const parts: string[] = []
        if (typeof tile.delta === "number") {
          parts.push(`${tile.delta > 0 ? "+" : ""}${formatKpiNumber(tile.delta)}`)
        }
        if (typeof tile.deltaPercent === "number") {
          parts.push(`${tile.deltaPercent > 0 ? "+" : ""}${tile.deltaPercent.toFixed(1)}%`)
        }
        return parts.join(" ")
      })()
      const sparkline =
        Array.isArray(tile.history) && tile.history.length >= 2
          ? `<div data-slot="kpi-sparkline"><svg viewBox="0 0 120 32" preserveAspectRatio="none">${renderSparklineBody(tile.history.map((v) => safeNum(v)), 120, 32)}</svg></div>`
          : ""
      return [
        `<div data-slot="kpi-tile" data-trend="${trend}">`,
        tile.label ? `<div data-slot="kpi-label">${escape(tile.label)}</div>` : "",
        `<div data-slot="kpi-value-row">`,
        `<div data-slot="kpi-value">${valueText}${tile.unit ? `<span data-slot="kpi-unit">${escape(tile.unit)}</span>` : ""}</div>`,
        deltaText ? `<div data-slot="kpi-delta" data-trend="${trend}">${escape(deltaText)}</div>` : "",
        `</div>`,
        sparkline,
        tile.hint ? `<div data-slot="kpi-hint">${escape(tile.hint)}</div>` : "",
        `</div>`,
      ].join("")
    })
    .join("")
  return `<div data-component="markdown-block" data-block-type="kpi">${items}</div>`
}

function formatKpiNumber(v: number): string {
  if (!Number.isFinite(v)) return "—"
  if (Math.abs(v) >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 10_000) return `${(v / 1_000).toFixed(1)}k`
  if (Number.isInteger(v)) return v.toLocaleString()
  return v.toFixed(Math.abs(v) < 1 ? 2 : 1)
}

// ---------------------------------------------------------------------------
// video
// ---------------------------------------------------------------------------

interface VideoConfig {
  src?: string
  url?: string
  poster?: string
  title?: string
  caption?: string
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
  controls?: boolean
}

function renderVideo(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("video payload must be an object")
  const cfg = payload as VideoConfig
  const src = safeUrl(cfg.src ?? cfg.url, ["https:", "http:", "blob:"])
  if (!src) throw new Error("video needs an https URL")
  const poster = safeUrl(cfg.poster)
  const attrs: string[] = []
  if (cfg.controls !== false) attrs.push("controls")
  if (cfg.autoplay) attrs.push("autoplay")
  if (cfg.loop) attrs.push("loop")
  if (cfg.muted || cfg.autoplay) attrs.push("muted")
  attrs.push("playsinline")
  attrs.push("preload=\"metadata\"")
  return [
    `<div data-component="markdown-block" data-block-type="video">`,
    cfg.title ? `<div data-slot="video-title">${escape(cfg.title)}</div>` : "",
    `<video data-slot="video-player" src="${escape(src)}"${poster ? ` poster="${escape(poster)}"` : ""} ${attrs.join(" ")}></video>`,
    cfg.caption ? `<div data-slot="video-caption">${escape(cfg.caption)}</div>` : "",
    `</div>`,
  ].join("")
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
  icon?: string
}

function renderTimeline(payload: unknown): string {
  const events: TimelineEvent[] = Array.isArray(payload)
    ? (payload as TimelineEvent[])
    : payload && typeof payload === "object" && Array.isArray((payload as { events?: TimelineEvent[] }).events)
      ? (payload as { events: TimelineEvent[] }).events
      : []
  if (events.length === 0) throw new Error("timeline needs an array of events")

  const items = events
    .map((evt) => {
      const status = evt.status ?? "done"
      const time = evt.time ?? evt.date
      const body = evt.description ?? evt.body
      return [
        `<li data-slot="timeline-item" data-status="${escape(status)}">`,
        `<div data-slot="timeline-marker" aria-hidden="true">${timelineMarkerSvg(status)}</div>`,
        `<div data-slot="timeline-content">`,
        time ? `<div data-slot="timeline-time">${escape(time)}</div>` : "",
        evt.title ? `<div data-slot="timeline-title">${escape(evt.title)}</div>` : "",
        body ? `<div data-slot="timeline-body">${formatInline(body)}</div>` : "",
        `</div>`,
        `</li>`,
      ].join("")
    })
    .join("")

  return `<ol data-component="markdown-block" data-block-type="timeline">${items}</ol>`
}

function timelineMarkerSvg(status: string): string {
  if (status === "current")
    return '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7" fill="var(--icon-agent-build-base)"/><circle cx="8" cy="8" r="3" fill="var(--surface-base)"/></svg>'
  if (status === "failed")
    return '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7" fill="var(--icon-diff-delete-base)"/><path d="M5 5l6 6M11 5l-6 6" stroke="var(--surface-base)" stroke-width="1.6" stroke-linecap="round"/></svg>'
  if (status === "pending")
    return '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--border-strong-base)" stroke-width="1.5" stroke-dasharray="2 2"/></svg>'
  return '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7" fill="var(--icon-diff-add-base)"/><path d="M4.5 8.5l2.4 2.2 4.6-4.6" stroke="var(--surface-base)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
}

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------

interface ProgressBar {
  label?: string
  value?: number
  max?: number
  hint?: string
  variant?: "default" | "success" | "warning" | "danger"
}

function renderProgress(payload: unknown): string {
  const bars: ProgressBar[] = Array.isArray(payload)
    ? (payload as ProgressBar[])
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: ProgressBar[] }).items)
      ? (payload as { items: ProgressBar[] }).items
      : payload && typeof payload === "object" && (payload as ProgressBar).value !== undefined
        ? [payload as ProgressBar]
        : []
  if (bars.length === 0) throw new Error("progress needs items or value")

  const items = bars
    .map((bar) => {
      const max = safeNum(bar.max, 100)
      const value = clamp(safeNum(bar.value), 0, max)
      const pct = max > 0 ? (value / max) * 100 : 0
      const variant = bar.variant ?? "default"
      const fmt = max === 100 ? `${pct.toFixed(0)}%` : `${value} / ${max}`
      return [
        `<div data-slot="progress-row" data-variant="${escape(variant)}">`,
        `<div data-slot="progress-meta">`,
        bar.label ? `<span data-slot="progress-label">${escape(bar.label)}</span>` : "",
        `<span data-slot="progress-value">${escape(fmt)}</span>`,
        `</div>`,
        `<div data-slot="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}">`,
        `<div data-slot="progress-fill" style="width:${pct.toFixed(2)}%"></div>`,
        `</div>`,
        bar.hint ? `<div data-slot="progress-hint">${escape(bar.hint)}</div>` : "",
        `</div>`,
      ].join("")
    })
    .join("")

  return `<div data-component="markdown-block" data-block-type="progress">${items}</div>`
}

// ---------------------------------------------------------------------------
// badge
// ---------------------------------------------------------------------------

interface BadgeItem {
  label?: string
  variant?: "default" | "info" | "success" | "warning" | "danger" | "neutral"
  icon?: string
}

function renderBadge(payload: unknown): string {
  const items: BadgeItem[] = Array.isArray(payload)
    ? (payload as BadgeItem[])
    : payload && typeof payload === "object" && Array.isArray((payload as { badges?: BadgeItem[] }).badges)
      ? (payload as { badges: BadgeItem[] }).badges
      : payload && typeof payload === "object" && (payload as BadgeItem).label
        ? [payload as BadgeItem]
        : []
  if (items.length === 0) throw new Error("badge needs items")

  const list = items
    .map(
      (b) =>
        `<span data-slot="badge-item" data-variant="${escape(b.variant ?? "default")}">${b.icon ? `<span data-slot="badge-icon" aria-hidden="true">${escape(b.icon)}</span>` : ""}${escape(b.label ?? "")}</span>`,
    )
    .join("")
  return `<div data-component="markdown-block" data-block-type="badge">${list}</div>`
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
  url?: string
  avatar?: string
}

function renderQuote(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("quote payload must be an object")
  const cfg = payload as QuoteConfig
  const text = cfg.text ?? cfg.body
  if (!text) throw new Error("quote needs text")
  const url = safeUrl(cfg.url)
  const avatar = safeUrl(cfg.avatar)
  return [
    `<figure data-component="markdown-block" data-block-type="quote">`,
    `<div data-slot="quote-mark" aria-hidden="true">"</div>`,
    `<blockquote data-slot="quote-text">${formatInline(text)}</blockquote>`,
    cfg.author || cfg.source
      ? [
          `<figcaption data-slot="quote-attribution">`,
          avatar ? `<img data-slot="quote-avatar" src="${escape(avatar)}" alt="" loading="lazy"/>` : "",
          `<div data-slot="quote-credits">`,
          cfg.author ? `<span data-slot="quote-author">${escape(cfg.author)}</span>` : "",
          cfg.role ? `<span data-slot="quote-role">${escape(cfg.role)}</span>` : "",
          cfg.source
            ? url
              ? `<a data-slot="quote-source" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(cfg.source)}</a>`
              : `<span data-slot="quote-source">${escape(cfg.source)}</span>`
            : "",
          `</div>`,
          `</figcaption>`,
        ].join("")
      : "",
    `</figure>`,
  ].join("")
}

// ---------------------------------------------------------------------------
// rich table
// ---------------------------------------------------------------------------

interface TableConfig {
  caption?: string
  columns?: Array<{ key?: string; label?: string; align?: "left" | "right" | "center"; format?: "number" | "currency" | "percent"; currency?: string }>
  rows?: Array<Record<string, unknown> | unknown[]>
  total?: boolean
  zebra?: boolean
}

function renderRichTable(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("table payload must be an object")
  const cfg = payload as TableConfig
  const cols = (cfg.columns ?? []).filter((c) => c)
  if (cols.length === 0) throw new Error("table needs columns")
  const rows = cfg.rows ?? []

  const header = cols
    .map(
      (c) =>
        `<th data-slot="table-th" style="text-align:${escape(c.align ?? "left")}">${escape(c.label ?? c.key ?? "")}</th>`,
    )
    .join("")

  const cellValue = (row: Record<string, unknown> | unknown[], col: TableConfig["columns"] extends infer T ? T extends Array<infer U> ? U : never : never, index: number): unknown => {
    if (Array.isArray(row)) return row[index]
    if (col?.key) return (row as Record<string, unknown>)[col.key]
    return undefined
  }

  const formatCell = (raw: unknown, col: NonNullable<TableConfig["columns"]>[number]): string => {
    if (raw === undefined || raw === null) return ""
    if (typeof raw === "number") {
      if (col.format === "currency") {
        try {
          return new Intl.NumberFormat(undefined, { style: "currency", currency: col.currency ?? "USD" }).format(raw)
        } catch {
          return raw.toFixed(2)
        }
      }
      if (col.format === "percent") return `${(raw * 100).toFixed(raw < 0.1 ? 1 : 0)}%`
      if (col.format === "number") return raw.toLocaleString()
      return String(raw)
    }
    return formatInline(String(raw))
  }

  const body = rows
    .map((row) => {
      const cells = cols
        .map((col, idx) => {
          const v = cellValue(row, col, idx)
          const align = col.align ?? (typeof v === "number" ? "right" : "left")
          return `<td data-slot="table-td" style="text-align:${escape(align)}">${formatCell(v, col)}</td>`
        })
        .join("")
      return `<tr data-slot="table-tr">${cells}</tr>`
    })
    .join("")

  let footer = ""
  if (cfg.total) {
    const totals = cols.map((col, idx) => {
      if (col.format === "number" || col.format === "currency") {
        let sum = 0
        for (const row of rows) {
          const v = cellValue(row, col, idx)
          if (typeof v === "number") sum += v
        }
        const align = col.align ?? "right"
        return `<td data-slot="table-td" style="text-align:${escape(align)};font-weight:500">${formatCell(sum, col)}</td>`
      }
      if (idx === 0)
        return `<td data-slot="table-td" style="text-align:left;font-weight:500;color:var(--text-strong)">Total</td>`
      return `<td data-slot="table-td"></td>`
    })
    footer = `<tr data-slot="table-tr" data-slot-row="total">${totals.join("")}</tr>`
  }

  return [
    `<div data-component="markdown-block" data-block-type="table"${cfg.zebra ? ' data-zebra="true"' : ""}>`,
    cfg.caption ? `<div data-slot="table-caption">${escape(cfg.caption)}</div>` : "",
    `<div data-slot="table-scroll">`,
    `<table data-slot="rich-table">`,
    `<thead data-slot="table-thead"><tr>${header}</tr></thead>`,
    `<tbody data-slot="table-tbody">${body}</tbody>`,
    footer ? `<tfoot data-slot="table-tfoot">${footer}</tfoot>` : "",
    `</table>`,
    `</div>`,
    `</div>`,
  ].join("")
}

// ---------------------------------------------------------------------------
// file-tree
// ---------------------------------------------------------------------------

interface FileNode {
  name?: string
  type?: "file" | "folder" | "dir"
  children?: FileNode[]
  hint?: string
  status?: "added" | "modified" | "deleted" | "unchanged"
}

function renderFileTree(payload: unknown): string {
  const root: FileNode[] = Array.isArray(payload)
    ? (payload as FileNode[])
    : payload && typeof payload === "object" && Array.isArray((payload as { tree?: FileNode[] }).tree)
      ? (payload as { tree: FileNode[] }).tree
      : []
  if (root.length === 0) throw new Error("file-tree needs nodes")

  const renderNode = (node: FileNode, depth: number, last: boolean[]): string => {
    const isFolder = node.type === "folder" || node.type === "dir" || (Array.isArray(node.children) && node.children.length > 0)
    const indent = last.map((l) => `<span data-slot="tree-rail"${l ? ' data-blank="true"' : ""}></span>`).join("")
    const connector = depth > 0 ? `<span data-slot="tree-connector" data-end="${last[last.length - 1] ? "true" : "false"}"></span>` : ""
    const icon = isFolder
      ? `<span data-slot="tree-icon" data-kind="folder" aria-hidden="true">▾</span>`
      : `<span data-slot="tree-icon" data-kind="file" aria-hidden="true">·</span>`
    const status = node.status ? `<span data-slot="tree-status" data-status="${escape(node.status)}">${node.status === "added" ? "A" : node.status === "modified" ? "M" : node.status === "deleted" ? "D" : "·"}</span>` : ""
    const row = [
      `<li data-slot="tree-row" data-kind="${isFolder ? "folder" : "file"}">`,
      indent,
      connector,
      icon,
      `<span data-slot="tree-name">${escape(node.name ?? "")}</span>`,
      node.hint ? `<span data-slot="tree-hint">${escape(node.hint)}</span>` : "",
      status,
      `</li>`,
    ].join("")
    if (isFolder && Array.isArray(node.children)) {
      const children = node.children
        .map((child, i) => renderNode(child, depth + 1, [...last, i === node.children!.length - 1]))
        .join("")
      return row + children
    }
    return row
  }

  const items = root.map((node, i) => renderNode(node, 0, [i === root.length - 1])).join("")
  return `<ul data-component="markdown-block" data-block-type="file-tree">${items}</ul>`
}

// ---------------------------------------------------------------------------
// image-grid
// ---------------------------------------------------------------------------

interface ImageGridItem {
  src?: string
  url?: string
  alt?: string
  caption?: string
  href?: string
}

function renderImageGrid(payload: unknown): string {
  const items: ImageGridItem[] = Array.isArray(payload)
    ? (payload as ImageGridItem[])
    : payload && typeof payload === "object" && Array.isArray((payload as { images?: ImageGridItem[] }).images)
      ? (payload as { images: ImageGridItem[] }).images
      : []
  if (items.length === 0) throw new Error("image-grid needs images")

  const cells = items
    .map((it) => {
      const src = safeUrl(it.src ?? it.url, ["https:", "http:", "data:"])
      if (!src) return ""
      const href = safeUrl(it.href, ["https:", "http:"])
      const inner = [
        `<img data-slot="image-grid-img" src="${escape(src)}" alt="${escape(it.alt ?? "")}" loading="lazy"/>`,
        it.caption ? `<div data-slot="image-grid-caption">${escape(it.caption)}</div>` : "",
      ].join("")
      if (href) {
        return `<a data-slot="image-grid-cell" href="${escape(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      }
      return `<div data-slot="image-grid-cell">${inner}</div>`
    })
    .filter(Boolean)
    .join("")
  if (!cells) throw new Error("image-grid has no valid images")

  return `<div data-component="markdown-block" data-block-type="image-grid">${cells}</div>`
}

// ---------------------------------------------------------------------------
// comparison (before/after — text or images)
// ---------------------------------------------------------------------------

interface ComparisonConfig {
  title?: string
  left?: { label?: string; content?: string; image?: string }
  right?: { label?: string; content?: string; image?: string }
  before?: { label?: string; content?: string; image?: string }
  after?: { label?: string; content?: string; image?: string }
}

function renderComparison(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("comparison payload must be an object")
  const cfg = payload as ComparisonConfig
  const left = cfg.left ?? cfg.before
  const right = cfg.right ?? cfg.after
  if (!left || !right) throw new Error("comparison needs left+right or before+after")

  const renderSide = (side: { label?: string; content?: string; image?: string } | undefined, defaultLabel: string) => {
    if (!side) return ""
    const img = side.image ? safeUrl(side.image, ["https:", "http:", "data:"]) : undefined
    return [
      `<div data-slot="comparison-side">`,
      `<div data-slot="comparison-label">${escape(side.label ?? defaultLabel)}</div>`,
      img ? `<img data-slot="comparison-img" src="${escape(img)}" alt="" loading="lazy"/>` : "",
      side.content ? `<div data-slot="comparison-content">${formatInline(side.content)}</div>` : "",
      `</div>`,
    ].join("")
  }

  return [
    `<div data-component="markdown-block" data-block-type="comparison">`,
    cfg.title ? `<div data-slot="comparison-title">${escape(cfg.title)}</div>` : "",
    `<div data-slot="comparison-grid">`,
    renderSide(left, "Before"),
    `<div data-slot="comparison-divider" aria-hidden="true"></div>`,
    renderSide(right, "After"),
    `</div>`,
    `</div>`,
  ].join("")
}

// ---------------------------------------------------------------------------
// diff (line-level highlighting; raw unified-diff text)
// ---------------------------------------------------------------------------

function renderDiff(code: string): string {
  const lines = code.replace(/\r\n?/g, "\n").split("\n")
  if (lines.length === 0) throw new Error("diff is empty")
  let stats = { add: 0, del: 0 }
  const rows = lines
    .map((line) => {
      let kind: "add" | "del" | "hunk" | "meta" | "ctx" = "ctx"
      if (line.startsWith("+++") || line.startsWith("---")) kind = "meta"
      else if (line.startsWith("@@")) kind = "hunk"
      else if (line.startsWith("+")) {
        kind = "add"
        stats.add++
      } else if (line.startsWith("-")) {
        kind = "del"
        stats.del++
      }
      const sigil = kind === "add" ? "+" : kind === "del" ? "−" : kind === "hunk" ? "⎘" : kind === "meta" ? "·" : " "
      const content = kind === "ctx" ? line : line.slice(1)
      return `<div data-slot="diff-line" data-kind="${kind}"><span data-slot="diff-sigil" aria-hidden="true">${sigil}</span><span data-slot="diff-content">${escape(content)}</span></div>`
    })
    .join("")
  return [
    `<div data-component="markdown-block" data-block-type="diff">`,
    `<div data-slot="diff-stats">`,
    `<span data-slot="diff-stat" data-kind="add">+${stats.add}</span>`,
    `<span data-slot="diff-stat" data-kind="del">−${stats.del}</span>`,
    `</div>`,
    `<div data-slot="diff-body">${rows}</div>`,
    `</div>`,
  ].join("")
}
