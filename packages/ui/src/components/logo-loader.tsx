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

// Geometry for the SVG fallback path. ViewBox matches the braille
// glyph box (12×20 px) so callers reserving space for the loader don't
// re-flow when the runtime falls back.
//
// Real braille at 14 px monospace renders as a TIGHTLY clustered 2×4
// dot grid in the upper-center of the line-height box: dots ~1.3 px
// diameter, ~3 px gap row-to-row, ~4 px gap column-to-column, leaving
// the bottom 5-ish px empty (the descender / baseline gap). The
// previous SVG geometry (PAD_X=3, PAD_Y=3.5, STEP_X=6, STEP_Y=4.33,
// r=0.9) spread the dots across the full box and read as `::  ::  ::`
// — a colon-dot-grip-handle, not a compact braille cluster.
//
// New geometry (PAD_X=4, PAD_Y=4, STEP_X=4, STEP_Y=3, r=1.0) packs the
// 8 dots into an 8×13 px cluster centered slightly above the
// vertical midline — visually indistinguishable from `⠿` at 14 px
// once antialiasing kicks in. This is what mobile users (forced onto
// the SVG path because no iOS font has braille coverage) see, so it
// has to match the desktop braille version.
const VIEW_W = 12
const VIEW_H = 20
const PAD_X = 4
const PAD_Y = 4
const STEP_X = 4
const STEP_Y = 3
const DOT_R = 1.0

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
    // We re-evaluate on first mount so the desktop client still ends up
    // on the braille path after hydration.
    return false
  }
  try {
    // PIXEL-DENSITY detection. We can't compare GLYPH WIDTHS for braille
    // because the chat surface uses a monospace font stack and `⠁` and
    // `⠿` render at the same advance width when both are real glyphs —
    // the entire POINT of monospace. (That false-negative was the v28.0.11
    // bug: the width check returned "no braille" on every monospace
    // platform, including macOS / Linux desktop where braille works fine,
    // and the SVG fallback won by default.)
    //
    // Instead we render two braille code points with very different ink
    // density to a hidden canvas and count the number of opaque pixels.
    // Real glyphs: `⠁` (one dot, ~3-6 lit pixels) is MUCH less than `⠿`
    // (six dots, ~18-40 lit pixels). Tofu rectangles for both code points
    // have the SAME perimeter ink and would collide. The 1.5× threshold
    // is well clear of the noise floor — anti-aliasing variance is on the
    // order of ±10%, not 50%+.
    const canvas = document.createElement("canvas")
    canvas.width = 24
    canvas.height = 32
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return false
    ctx.font =
      '20px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", "Segoe UI Symbol", monospace'
    ctx.fillStyle = "#000000"
    ctx.textBaseline = "middle"
    const countLit = (text: string): number => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillText(text, 2, canvas.height / 2)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let lit = 0
      // Alpha channel is at every 4th byte. A pixel counts as "lit" when
      // the fillText put any ink there at all (alpha > 0).
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) lit++
      }
      return lit
    }
    const singleLit = countLit("⠁") // one dot
    const allLit = countLit("⠿") // six dots
    // Both must register at least SOME ink. If `⠁` is empty the runtime
    // skipped it entirely (no fallback font drew anything) → no braille.
    if (singleLit < 2 || allLit < 2) {
      brailleSupported = false
      return false
    }
    // Real braille glyph ratio: ~5×–8× depending on antialiasing.
    // Tofu rectangle ratio: ~1.0× (same perimeter for both).
    // 1.5× is a safe floor — well above noise, well below real signal.
    const ratio = allLit / singleLit
    const ok = ratio >= 1.5
    brailleSupported = ok
    return ok
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
