import { RGBA } from "@opentui/core"
import type { ColorGenerator } from "opentui-spinner"

// Braille spinner frame generators ported from the MIT-licensed
// `unicode-animations` project by gunnargray-dev:
//   https://github.com/gunnargray-dev/unicode-animations  (MIT)
// Each braille char (U+2800 block) is a 2-col × 4-row dot grid; these build
// multi-character animated frames. We pair each animation with a multi-colour
// gradient generator so the pending indicator is lively and colourful rather
// than a single flat hue.

export interface PendingAnimDef {
  key: string
  frames: string[]
  color: ColorGenerator
  interval: number
}

// --- braille grid helpers (from unicode-animations, MIT) ---
const BRAILLE_DOT_MAP = [
  [0x01, 0x08], // row 0
  [0x02, 0x10], // row 1
  [0x04, 0x20], // row 2
  [0x40, 0x80], // row 3
]

function makeGrid(rows: number, cols: number): boolean[][] {
  if (rows <= 0 || cols <= 0) return []
  return Array.from({ length: rows }, () => Array(cols).fill(false))
}

function gridToBraille(grid: boolean[][]): string {
  const rows = grid.length
  const cols = grid[0] ? grid[0].length : 0
  const charCount = Math.ceil(cols / 2)
  let result = ""
  for (let c = 0; c < charCount; c++) {
    let code = 0x2800
    for (let r = 0; r < 4 && r < rows; r++) {
      for (let d = 0; d < 2; d++) {
        const col = c * 2 + d
        if (col < cols && grid[r] && grid[r][col]) code |= BRAILLE_DOT_MAP[r][d]
      }
    }
    result += String.fromCodePoint(code)
  }
  return result
}

// --- frame generators (ported from unicode-animations, MIT) ---

function genScan(): string[] {
  const W = 8,
    H = 4,
    frames: string[] = []
  for (let pos = -1; pos < W + 1; pos++) {
    const g = makeGrid(H, W)
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (c === pos || c === pos - 1) g[r][c] = true
    frames.push(gridToBraille(g))
  }
  return frames
}

function genCascade(): string[] {
  const W = 8,
    H = 4,
    frames: string[] = []
  for (let offset = -2; offset < W + H; offset++) {
    const g = makeGrid(H, W)
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        const diag = c + r
        if (diag === offset || diag === offset - 1) g[r][c] = true
      }
    frames.push(gridToBraille(g))
  }
  return frames
}

function genSnake(): string[] {
  const W = 4,
    H = 4
  const path: [number, number][] = []
  for (let r = 0; r < H; r++) {
    if (r % 2 === 0) for (let c = 0; c < W; c++) path.push([r, c])
    else for (let c = W - 1; c >= 0; c--) path.push([r, c])
  }
  const frames: string[] = []
  for (let i = 0; i < path.length; i++) {
    const g = makeGrid(H, W)
    for (let t = 0; t < 4; t++) {
      const idx = (i - t + path.length) % path.length
      g[path[idx][0]][path[idx][1]] = true
    }
    frames.push(gridToBraille(g))
  }
  return frames
}

function genOrbit(): string[] {
  const W = 2,
    H = 4
  const path: [number, number][] = [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
    [3, 0],
    [2, 0],
    [1, 0],
  ]
  const frames: string[] = []
  for (let i = 0; i < path.length; i++) {
    const g = makeGrid(H, W)
    g[path[i][0]][path[i][1]] = true
    const t1 = (i - 1 + path.length) % path.length
    g[path[t1][0]][path[t1][1]] = true
    frames.push(gridToBraille(g))
  }
  return frames
}

function genWaveRows(): string[] {
  const W = 8,
    H = 4,
    totalFrames = 16,
    frames: string[] = []
  for (let f = 0; f < totalFrames; f++) {
    const g = makeGrid(H, W)
    for (let c = 0; c < W; c++) {
      const row = Math.round(((Math.sin((f - c * 0.5) * 0.8) + 1) / 2) * (H - 1))
      g[row][c] = true
      if (row > 0) g[row - 1][c] = (f + c) % 3 === 0
    }
    frames.push(gridToBraille(g))
  }
  return frames
}

function genHelix(): string[] {
  const W = 8,
    H = 4,
    totalFrames = 16,
    frames: string[] = []
  for (let f = 0; f < totalFrames; f++) {
    const g = makeGrid(H, W)
    for (let c = 0; c < W; c++) {
      const phase = (f + c) * (Math.PI / 4)
      g[Math.round(((Math.sin(phase) + 1) / 2) * (H - 1))][c] = true
      g[Math.round(((Math.sin(phase + Math.PI) + 1) / 2) * (H - 1))][c] = true
    }
    frames.push(gridToBraille(g))
  }
  return frames
}

function genPulse(): string[] {
  const W = 6,
    H = 4,
    frames: string[] = []
  const cx = W / 2 - 0.5,
    cy = H / 2 - 0.5
  for (const r of [0.5, 1.2, 2, 3, 3.5]) {
    const g = makeGrid(H, W)
    for (let row = 0; row < H; row++)
      for (let col = 0; col < W; col++) {
        const dist = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2)
        if (Math.abs(dist - r) < 0.9) g[row][col] = true
      }
    frames.push(gridToBraille(g))
  }
  return frames
}

function genRain(): string[] {
  const W = 8,
    H = 4,
    totalFrames = 12,
    frames: string[] = []
  const offsets = [0, 3, 1, 5, 2, 7, 4, 6]
  for (let f = 0; f < totalFrames; f++) {
    const g = makeGrid(H, W)
    for (let c = 0; c < W; c++) {
      const row = (f + offsets[c]) % (H + 2)
      if (row < H) g[row][c] = true
    }
    frames.push(gridToBraille(g))
  }
  return frames
}

// --- colour helpers ---
function lerp(a: RGBA, b: RGBA, t: number) {
  return RGBA.fromValues(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1)
}

// oc-2 dark palette — a cohesive multi-hue rainbow used by the gradient
// colour generators below.
const PALETTE = ["#8fb2d8", "#b399cf", "#88c6c9", "#75b5a6", "#d6bd78", "#d49a73", "#df6d5c"].map((h) =>
  RGBA.fromHex(h),
)

// Sample the palette as a smooth looped gradient at position p in [0,1).
function paletteAt(p: number): RGBA {
  const n = PALETTE.length
  const x = ((p % 1) + 1) % 1
  const scaled = x * n
  const i = Math.floor(scaled) % n
  return lerp(PALETTE[i], PALETTE[(i + 1) % n], scaled - i)
}

// Multi-colour generator: each character cell is tinted by a hue that sweeps
// across the palette over frames AND across character columns, so the whole
// animation shimmers through every colour. `speed` controls how fast the hue
// advances per frame.
function rainbow(frameCount: number, speed = 1): ColorGenerator {
  return (f, i, _total, chars) => {
    const colOffset = chars > 1 ? i / chars : 0
    return paletteAt((f / frameCount) * speed + colOffset)
  }
}

// All animations ported from unicode-animations (MIT), each paired with a
// rainbow gradient so the pending indicator is multi-coloured.
const ANIMS: PendingAnimDef[] = [
  { key: "scan", frames: genScan(), interval: 70 },
  { key: "cascade", frames: genCascade(), interval: 60 },
  { key: "snake", frames: genSnake(), interval: 80 },
  { key: "orbit", frames: genOrbit(), interval: 100 },
  { key: "waverows", frames: genWaveRows(), interval: 90 },
  { key: "helix", frames: genHelix(), interval: 80 },
  { key: "pulse", frames: genPulse(), interval: 150 },
  { key: "rain", frames: genRain(), interval: 100 },
].map((a) => ({ ...a, color: rainbow(a.frames.length, 1.2) }))

function hash(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Pick one of the multi-colour braille pending animations. The choice is
 * pseudo-random but STABLE for a given seed (a tool callID), so the same tool
 * keeps one animation across re-renders while different tools get variety.
 * Passing an empty seed picks a genuinely random animation.
 */
export function pickPendingAnim(seed: string): PendingAnimDef {
  const idx = seed ? hash(seed) % ANIMS.length : Math.floor(Math.random() * ANIMS.length)
  return ANIMS[idx]
}
