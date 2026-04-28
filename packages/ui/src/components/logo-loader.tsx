/**
 * Diagonal-swipe braille animation matching the right-pointing logo arrow.
 *
 * Frame generator adapted from gunnargray-dev/unicode-animations
 * (MIT License, https://github.com/gunnargray-dev/unicode-animations).
 */
import { createEffect, createSignal, onCleanup, type Component } from "solid-js"

const BRAILLE_DOT_MAP: ReadonlyArray<readonly [number, number]> = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

function makeGrid(rows: number, cols: number): boolean[][] {
  if (rows <= 0 || cols <= 0) return []
  return Array.from({ length: rows }, () => Array(cols).fill(false))
}

function gridToBraille(grid: boolean[][]): string {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  const charCount = Math.ceil(cols / 2)
  let result = ""
  for (let c = 0; c < charCount; c++) {
    let code = 0x2800
    for (let r = 0; r < 4 && r < rows; r++) {
      for (let d = 0; d < 2; d++) {
        const col = c * 2 + d
        if (col < cols && grid[r]?.[col]) {
          code |= BRAILLE_DOT_MAP[r][d]
        }
      }
    }
    result += String.fromCodePoint(code)
  }
  return result
}

function genDiagonalSwipe(): string[] {
  const W = 2
  const H = 4
  const frames: string[] = []
  const maxDiag = W + H - 2
  for (let d = 0; d <= maxDiag; d++) {
    const g = makeGrid(H, W)
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (r + c <= d) g[r][c] = true
      }
    }
    frames.push(gridToBraille(g))
  }
  const full = makeGrid(H, W)
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) full[r][c] = true
  frames.push(gridToBraille(full))
  for (let d = 0; d <= maxDiag; d++) {
    const g = makeGrid(H, W)
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (r + c > d) g[r][c] = true
      }
    }
    frames.push(gridToBraille(g))
  }
  frames.push(gridToBraille(makeGrid(H, W)))
  return frames
}

const FRAMES = genDiagonalSwipe()
const FRAME_MS = 90

export const LogoLoader: Component<{ class?: string; active?: boolean }> = (props) => {
  const [index, setIndex] = createSignal(0)

  createEffect(() => {
    if (props.active === false) return
    const id = setInterval(() => {
      setIndex((value) => (value + 1) % FRAMES.length)
    }, FRAME_MS)
    onCleanup(() => clearInterval(id))
  })

  return (
    <span
      data-component="logo-loader"
      data-active={props.active === false ? undefined : "true"}
      classList={{ [props.class ?? ""]: !!props.class }}
      aria-hidden="true"
    >
      <span data-slot="logo-loader-frame">{FRAMES[index()]}</span>
    </span>
  )
}
