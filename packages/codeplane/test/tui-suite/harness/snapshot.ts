import type { CapturedFrame, CapturedLine, CapturedSpan } from "@opentui/core"

/** A normalized, deterministic representation of a frame. */
export interface FrameSnapshot {
  cols: number
  rows: number
  cursor: [number, number]
  /** Plain-text grid, joined by \n. Width = cols, height = rows. */
  text: string
  /** Per-cell text + style, useful for assertion. */
  lines: CapturedLine[]
}

export function captureFrameSnapshot(captured: CapturedFrame, charText: string): FrameSnapshot {
  return {
    cols: captured.cols,
    rows: captured.rows,
    cursor: [captured.cursor[0], captured.cursor[1]],
    text: charText,
    lines: captured.lines,
  }
}

/** Plain-text grid with one row per line, padded to cols. */
export function frameToText(frame: FrameSnapshot): string {
  return frame.text
}

/** Strip trailing whitespace per row. Useful for stable snapshots. */
export function trimFrame(frame: FrameSnapshot): string {
  return frame.text
    .split("\n")
    .map((row) => row.replace(/\s+$/, ""))
    .join("\n")
}

/** Convert frame to ANSI string with full styling. */
export function frameToAnsi(frame: FrameSnapshot): string {
  let out = ""
  for (let i = 0; i < frame.lines.length; i++) {
    const line = frame.lines[i]!
    for (const span of line.spans) {
      out += spanToAnsi(span)
    }
    out += "[0m"
    if (i < frame.lines.length - 1) out += "\n"
  }
  return out
}

function spanToAnsi(span: CapturedSpan): string {
  const fg = rgbaToAnsiFg(span.fg)
  const bg = rgbaToAnsiBg(span.bg)
  const attrs = attrsToAnsi(span.attributes)
  return `[0m${attrs}${fg}${bg}${span.text}`
}

function rgbaToAnsiFg(c: { r: number; g: number; b: number; a: number }): string {
  const [r, g, b] = quantize(c)
  return `[38;2;${r};${g};${b}m`
}
function rgbaToAnsiBg(c: { r: number; g: number; b: number; a: number }): string {
  const [r, g, b] = quantize(c)
  return `[48;2;${r};${g};${b}m`
}
function quantize(c: { r: number; g: number; b: number }): [number, number, number] {
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]
}
function attrsToAnsi(a: number): string {
  let s = ""
  if (a & 0x1) s += "[1m"
  if (a & 0x2) s += "[2m"
  if (a & 0x4) s += "[3m"
  if (a & 0x8) s += "[4m"
  if (a & 0x10) s += "[7m"
  if (a & 0x20) s += "[9m"
  return s
}

/** Convert frame to HTML preview (used by the preview server). */
export function frameToHtml(frame: FrameSnapshot): string {
  const rows: string[] = []
  for (const line of frame.lines) {
    let row = ""
    for (const span of line.spans) {
      row += `<span style="${spanToCss(span)}">${escapeHtml(span.text)}</span>`
    }
    rows.push(row || "&nbsp;")
  }
  return rows.join("\n")
}
function spanToCss(span: CapturedSpan): string {
  const fg = rgbaToCss(span.fg)
  const bg = rgbaToCss(span.bg)
  const a = span.attributes
  let s = `color:${fg};background:${bg};`
  if (a & 0x1) s += "font-weight:bold;"
  if (a & 0x2) s += "opacity:0.7;"
  if (a & 0x4) s += "font-style:italic;"
  if (a & 0x8) s += "text-decoration:underline;"
  if (a & 0x20) s += "text-decoration:line-through;"
  return s
}
function rgbaToCss(c: { r: number; g: number; b: number; a: number }): string {
  const [r, g, b] = quantize(c)
  return `rgba(${r},${g},${b},${c.a.toFixed(3)})`
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))
}

/** Diff two text frames, return a unified-style summary string. */
export function diffFrames(a: string, b: string): string {
  if (a === b) return ""
  const ar = a.split("\n")
  const br = b.split("\n")
  const max = Math.max(ar.length, br.length)
  const out: string[] = []
  for (let i = 0; i < max; i++) {
    const al = ar[i] ?? ""
    const bl = br[i] ?? ""
    if (al === bl) continue
    out.push(`@ row ${i}`)
    out.push(`- ${al}`)
    out.push(`+ ${bl}`)
  }
  return out.join("\n")
}
