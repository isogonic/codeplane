import { RGBA } from "@opentui/core"
import type { ColorGenerator } from "opentui-spinner"

export interface PendingAnimDef {
  key: string
  frames: string[]
  color: ColorGenerator
  interval: number
  hue: string
}

function lighten(base: RGBA, f: number) {
  return RGBA.fromValues(Math.min(1, base.r * f), Math.min(1, base.g * f), Math.min(1, base.b * f), base.a)
}
function withAlpha(base: RGBA, a: number) {
  return RGBA.fromValues(base.r, base.g, base.b, Math.max(0, Math.min(1, a)))
}

// Comet — a bright head sweeps right leaving a fading trail, then repeats.
function comet(hue: string): PendingAnimDef {
  const base = RGBA.fromHex(hue)
  const width = 7
  const steps = width + 3
  const frames = Array.from({ length: steps }, (_, f) =>
    Array.from({ length: width }, (_, i) => {
      const dist = f - i
      if (dist === 0) return "◉"
      if (dist > 0 && dist <= 3) return "•"
      return "·"
    }).join(""),
  )
  const color: ColorGenerator = (f, i) => {
    const dist = f - i
    if (dist === 0) return lighten(base, 1.15)
    if (dist > 0 && dist <= 3) return withAlpha(base, 0.75 - dist * 0.2)
    return withAlpha(base, 0.12)
  }
  return { key: "comet", frames, color, interval: 85, hue }
}

// Pulse — three dots breathe in a travelling wave of brightness.
function pulse(hue: string): PendingAnimDef {
  const base = RGBA.fromHex(hue)
  const steps = 14
  const frames = Array.from({ length: steps }, () => "●●●")
  const color: ColorGenerator = (f, i) => {
    const v = (Math.sin((f / steps) * Math.PI * 2 - i * 0.9) + 1) / 2
    return withAlpha(lighten(base, 1 + v * 0.15), 0.25 + v * 0.75)
  }
  return { key: "pulse", frames, color, interval: 80, hue }
}

// Shimmer — a solid bar with a bright glint sweeping through it.
function shimmer(hue: string): PendingAnimDef {
  const base = RGBA.fromHex(hue)
  const width = 6
  const steps = width + 4
  const frames = Array.from({ length: steps }, () => "━".repeat(width))
  const color: ColorGenerator = (f, i) => {
    const d = Math.abs(i - (f % steps))
    if (d === 0) return lighten(base, 1.25)
    if (d === 1) return withAlpha(lighten(base, 1.1), 0.7)
    return withAlpha(base, 0.3)
  }
  return { key: "shimmer", frames, color, interval: 80, hue }
}

// oc-2 palette hues — one per animation, all from the same family so the
// set feels cohesive while staying distinct.
const HUE = {
  shimmer: "#d49a73", // orange
  comet: "#b399cf", // purple (secondary)
  pulse: "#75b5a6", // green
}

// Rotation order (the three the user picked).
const ANIMS: ((hue: string) => PendingAnimDef)[] = [
  (h) => shimmer(h),
  (h) => comet(h),
  (h) => pulse(h),
]
const HUES = [HUE.shimmer, HUE.comet, HUE.pulse]

function hash(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Pick one of the rotating pending animations. Stable for a given seed (e.g.
 * a tool callID) so the same tool keeps the same animation across re-renders
 * instead of flickering, while different tools get variety.
 */
export function pickPendingAnim(seed: string): PendingAnimDef {
  const idx = hash(seed) % ANIMS.length
  return ANIMS[idx](HUES[idx])
}
