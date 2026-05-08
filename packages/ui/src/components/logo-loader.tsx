/**
 * Diagonal-swipe braille animation matching the right-pointing logo arrow.
 *
 * Frame generator adapted from gunnargray-dev/unicode-animations
 * (MIT License, https://github.com/gunnargray-dev/unicode-animations).
 *
 * Why the dual-render path?
 *   - Up to v27 we rendered the loader as a single braille code point per
 *     frame and let the system font draw the dot pattern. Every desktop
 *     browser and macOS / Windows / Linux ships at least one font with
 *     full U+2800–U+28FF coverage (Apple Symbols, Menlo, Segoe UI Symbol,
 *     DejaVu Sans Mono, …) so the visual was crisp and matched the brand
 *     mark exactly.
 *   - In v28 we forced ALL platforms to an SVG dot grid because the
 *     Capacitor WKWebView shell on iOS has no font with braille coverage
 *     and was painting `[?]` tofu next to "Denken / Thinking". The SVG
 *     fix is correct for that platform but a regression on every other
 *     platform: the SVG dots look chunkier, the kerning is off, and the
 *     animation reads as a static grip-handle icon when the diagonal
 *     swipe is in its half-filled phase.
 *
 * The fix here keeps the iOS-safe SVG fallback BUT prefers the braille
 * code-point form on every platform that can actually render it. We do
 * a one-shot canvas feature test on first mount (measure the rendered
 * width of `⠿` U+283F vs `⠁` U+2801 — if they collide, both are
 * `.notdef` and the runtime can't draw braille; fall through to SVG).
 * The detection result is cached at module scope so subsequent mounts
 * reuse the same path with no measurement cost.
 */
import { createEffect, createMemo, createSignal, onCleanup, type Component } from "solid-js"

const BRAILLE_DOT_MAP: ReadonlyArray<readonly [number, number]> = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

const COLS = 2
const ROWS = 4

type Frame = boolean[][]

function makeGrid(filled: boolean): Frame {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => filled))
}

function gridToBraille(grid: Frame): string {
  // Each braille code point covers a 2-col × 4-row dot pattern, so a 2×4
  // grid maps to exactly one character.
  let code = 0x2800
  for (let r = 0; r < ROWS; r++) {
    for (let d = 0; d < COLS; d++) {
      if (grid[r]?.[d]) code |= BRAILLE_DOT_MAP[r][d]
    }
  }
  return String.fromCodePoint(code)
}

function genDiagonalSwipe(): Frame[] {
  const frames: Frame[] = []
  const maxDiag = COLS + ROWS - 2
  // Phase 1: fill in along the diagonal (top-left → bottom-right).
  for (let d = 0; d <= maxDiag; d++) {
    const g = makeGrid(false)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (r + c <= d) g[r][c] = true
      }
    }
    frames.push(g)
  }
  // Phase 2: full grid (peak frame).
  frames.push(makeGrid(true))
  // Phase 3: drain along the same diagonal — keep dots whose r+c is past d.
  for (let d = 0; d <= maxDiag; d++) {
    const g = makeGrid(false)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (r + c > d) g[r][c] = true
      }
    }
    frames.push(g)
  }
  // Phase 4: empty grid (rest before looping).
  frames.push(makeGrid(false))
  return frames
}

const FRAMES = genDiagonalSwipe()
const BRAILLE_FRAMES: string[] = FRAMES.map(gridToBraille)
const FRAME_MS = 90

// Geometry for the SVG fallback path. ViewBox matches the original braille
// glyph box (12×20 px) so callers reserving space for the loader don't
// re-flow when the runtime falls back.
const VIEW_W = 12
const VIEW_H = 20
const PAD_X = 2
const PAD_Y = 2
const DOT_R = 1.4
const STEP_X = (VIEW_W - PAD_X * 2) / (COLS - 1)
const STEP_Y = (VIEW_H - PAD_Y * 2) / (ROWS - 1)

const DOT_POSITIONS: Array<{ row: number; col: number; cx: number; cy: number }> = (() => {
  const list: Array<{ row: number; col: number; cx: number; cy: number }> = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      list.push({
        row: r,
        col: c,
        cx: PAD_X + c * STEP_X,
        cy: PAD_Y + r * STEP_Y,
      })
    }
  }
  return list
})()

/**
 * Cache of the braille-supported probe. Computed lazily on first mount so
 * we don't pay the canvas + DOM cost during module load (the loader is
 * imported from the chat surface entry path, not lazy-loaded).
 */
let brailleSupported: boolean | undefined

function detectBrailleSupport(): boolean {
  if (typeof brailleSupported === "boolean") return brailleSupported
  if (typeof window === "undefined" || typeof document === "undefined") {
    // SSR or non-DOM environment — pick SVG so the first paint is correct.
    brailleSupported = false
    return false
  }
  try {
    // The test is whether the runtime can DRAW distinct glyphs for two
    // different braille code points. If it can't, both render as the same
    // `notdef` rectangle (or nothing) and the measured widths collide.
    // ⠁ (U+2801) = single top-left dot, ⠿ (U+283F) = all 6 lower dots.
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      brailleSupported = false
      return false
    }
    // Use the same font stack the chat / session-turn surface ends up
    // resolving to. We don't rely on `var(--…)` because canvas can't read
    // CSS custom properties — match the chat's mono fallback verbatim
    // (kept in lock-step with `packages/app/src/context/settings.tsx`).
    ctx.font =
      '14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
    const single = ctx.measureText("⠁").width
    const all = ctx.measureText("⠿").width
    // Empty / NaN widths mean the engine couldn't render anything → fall
    // back. A clear width difference (typical: ~0.5–2 px on real braille
    // fonts) means glyphs are distinct → braille is real.
    if (!Number.isFinite(single) || !Number.isFinite(all) || single <= 0 || all <= 0) {
      brailleSupported = false
      return false
    }
    // Some platforms (notably iOS WKWebView) collapse to identical-width
    // tofu rectangles for both. Treat exact equality as "no real glyph".
    if (Math.abs(single - all) < 0.01) {
      brailleSupported = false
      return false
    }
    brailleSupported = true
    return true
  } catch {
    brailleSupported = false
    return false
  }
}

export const LogoLoader: Component<{ class?: string; active?: boolean }> = (props) => {
  const [index, setIndex] = createSignal(0)
  const [useBraille, setUseBraille] = createSignal(false)

  // Detect once on mount. `createEffect` runs client-side only, so SSR
  // delivers the SVG (zero-dot) frame and the client paints the same
  // viewBox before swapping to braille if supported — no layout shift.
  createEffect(() => {
    setUseBraille(detectBrailleSupport())
  })

  createEffect(() => {
    if (props.active === false) return
    const id = setInterval(() => {
      setIndex((value) => (value + 1) % FRAMES.length)
    }, FRAME_MS)
    onCleanup(() => clearInterval(id))
  })

  const frame = createMemo(() => FRAMES[index()] ?? FRAMES[0]!)
  const brailleFrame = createMemo(() => BRAILLE_FRAMES[index()] ?? BRAILLE_FRAMES[0]!)

  return (
    <span
      data-component="logo-loader"
      data-active={props.active === false ? undefined : "true"}
      data-render={useBraille() ? "braille" : "svg"}
      classList={{ [props.class ?? ""]: !!props.class }}
      aria-hidden="true"
    >
      {useBraille() ? (
        // Braille path — ONE code point per frame, drawn by the system
        // font. This is the v27 visual: smooth, kerned, matches the brand
        // mark. Used on every platform that can actually render it.
        <span data-slot="logo-loader-frame">{brailleFrame()}</span>
      ) : (
        // SVG fallback — used when the runtime can't draw braille glyphs
        // (iOS Safari / Capacitor WKWebView). Renders as a 2×4 dot grid
        // matching the same animation but with explicit circles so we
        // don't depend on a font.
        <svg
          data-slot="logo-loader-frame"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          width={VIEW_W}
          height={VIEW_H}
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {DOT_POSITIONS.map((dot) => (
            <circle
              cx={dot.cx}
              cy={dot.cy}
              r={DOT_R}
              fill="currentColor"
              opacity={frame()[dot.row]?.[dot.col] ? 1 : 0}
            />
          ))}
        </svg>
      )}
    </span>
  )
}
