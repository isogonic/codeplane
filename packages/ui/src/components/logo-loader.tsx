/**
 * Diagonal-swipe braille animation matching the right-pointing logo arrow.
 *
 * Frame generator adapted from gunnargray-dev/unicode-animations
 * (MIT License, https://github.com/gunnargray-dev/unicode-animations).
 *
 * Why SVG instead of unicode braille (U+2800–U+28FF)?
 * The original implementation rendered each animation frame as a single
 * braille code point and relied on the system mono font to draw the dot
 * pattern. That works on macOS and most desktop browsers, but iOS Safari
 * and the Capacitor WKWebView used by the mobile app DO NOT ship a font
 * with braille glyph coverage — the engine falls through to .notdef and
 * paints a "tofu" / question-mark-in-a-box where the loader should be.
 * The user reported it as the `[?]` next to "Denken" / next to the
 * reasoning header on mobile. Drawing the same 2×4 dot grid directly as
 * SVG circles removes the font dependency entirely so the animation
 * renders identically on every platform.
 */
import { createEffect, createMemo, createSignal, onCleanup, type Component } from "solid-js"

const COLS = 2
const ROWS = 4

type Frame = boolean[][]

function makeGrid(filled: boolean): Frame {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => filled))
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
const FRAME_MS = 90

// Geometry: the SVG viewBox matches the original 12×20 px box the css set,
// so existing layouts that reserve space for the loader keep the same
// visual size. Dots are placed on a 2×4 grid with margin so they don't
// touch the viewBox edges.
const VIEW_W = 12
const VIEW_H = 20
const PAD_X = 2
const PAD_Y = 2
const DOT_R = 1.4
const STEP_X = (VIEW_W - PAD_X * 2) / (COLS - 1) // 2 columns → spacing across full inner width
const STEP_Y = (VIEW_H - PAD_Y * 2) / (ROWS - 1) // 4 rows → spacing across full inner height

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

export const LogoLoader: Component<{ class?: string; active?: boolean }> = (props) => {
  const [index, setIndex] = createSignal(0)

  createEffect(() => {
    if (props.active === false) return
    const id = setInterval(() => {
      setIndex((value) => (value + 1) % FRAMES.length)
    }, FRAME_MS)
    onCleanup(() => clearInterval(id))
  })

  const frame = createMemo(() => FRAMES[index()] ?? FRAMES[0]!)

  return (
    <span
      data-component="logo-loader"
      data-active={props.active === false ? undefined : "true"}
      classList={{ [props.class ?? ""]: !!props.class }}
      aria-hidden="true"
    >
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
    </span>
  )
}
