import { expect } from "bun:test"
import path from "node:path"
import fs from "node:fs/promises"
import type { TuiHarness } from "./harness"
import { trimFrame, diffFrames, frameToHtml, type FrameSnapshot } from "./snapshot"

const SNAPSHOT_DIR = path.resolve(import.meta.dir, "..", "snapshots")

/** Throws if the text isn't visible on the current frame. */
export function expectVisible(h: TuiHarness, needle: string | RegExp): void {
  const found = h.find(needle)
  if (!found) {
    throw new Error(`expected to find ${printNeedle(needle)} on screen, frame was:\n${h.text()}`)
  }
}

/** Throws if the text IS visible on the current frame. */
export function expectNotVisible(h: TuiHarness, needle: string | RegExp): void {
  const found = h.find(needle)
  if (found) {
    throw new Error(
      `expected NOT to find ${printNeedle(needle)} on screen, but found at row=${found.row} col=${found.col}\nframe:\n${h.text()}`,
    )
  }
}

/** Throws if the cursor is not at the expected position. */
export function expectCursorAt(h: TuiHarness, row: number, col: number): void {
  const frame = h.frame()
  if (frame.cursor[0] !== col || frame.cursor[1] !== row) {
    throw new Error(`expected cursor at row=${row} col=${col}, got row=${frame.cursor[1]} col=${frame.cursor[0]}`)
  }
}

/** Throws if the frame's trimmed text differs from the saved snapshot. Updates snapshot when CODEPLANE_TUI_UPDATE_SNAPSHOTS=1. */
export async function expectMatchSnapshot(h: TuiHarness, name: string): Promise<void> {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true })
  const filePath = path.join(SNAPSHOT_DIR, sanitize(name) + ".txt")
  const actual = trimFrame(h.frame())
  const update = process.env["CODEPLANE_TUI_UPDATE_SNAPSHOTS"] === "1"
  let expected: string | undefined
  try {
    expected = await fs.readFile(filePath, "utf8")
  } catch {
    // snapshot doesn't exist
  }
  if (expected === undefined || update) {
    await fs.writeFile(filePath, actual)
    return
  }
  if (expected !== actual) {
    const diff = diffFrames(expected, actual)
    throw new Error(`snapshot mismatch for "${name}" at ${filePath}\n${diff}\n\nrun with CODEPLANE_TUI_UPDATE_SNAPSHOTS=1 to update.`)
  }
}

/** Save a HTML preview of the current frame. Useful inside CI to attach an artifact. */
export async function saveHtmlPreview(frame: FrameSnapshot, filePath: string, title = "tui frame"): Promise<void> {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{margin:0;background:#000;color:#fff;font-family:Menlo,Monaco,monospace;font-size:14px}
pre{margin:0;padding:8px;line-height:1.0;white-space:pre}
</style></head><body><pre>${frameToHtml(frame)}</pre></body></html>`
  await fs.writeFile(filePath, html)
}

/** Throws if the frame contains crash markers (typical Solid/JS error overlay text). */
export function expectNoCrash(h: TuiHarness): void {
  const text = h.text()
  if (/error boundary|uncaught error|TypeError:|ReferenceError:/i.test(text)) {
    throw new Error(`crash detected on frame:\n${text}`)
  }
}

function printNeedle(n: string | RegExp): string {
  return typeof n === "string" ? JSON.stringify(n) : n.toString()
}
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_")
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))
}

/** Light bun:test friendly: asserts via bun's expect for nicer reporters. */
export const tui = {
  visible(h: TuiHarness, needle: string | RegExp) {
    expect(h.find(needle), `expected to find ${printNeedle(needle)} on screen`).not.toBeNull()
  },
  notVisible(h: TuiHarness, needle: string | RegExp) {
    expect(h.find(needle), `expected NOT to find ${printNeedle(needle)} on screen`).toBeNull()
  },
  cursorAt(h: TuiHarness, row: number, col: number) {
    const f = h.frame()
    expect([f.cursor[1], f.cursor[0]], "cursor position").toEqual([row, col])
  },
}
