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

// All three animations are SINGLE-GLYPH: every frame is exactly one character,
// so the indicator occupies a single terminal cell (no horizontal width) and
// reads as one compact animated symbol. Color is animated per-frame via the
// ColorGenerator (charIndex is always 0). This keeps them square/compact while
// staying distinct and agent-tinted.

// Orbit — a moon-phase glyph rotates in place (purple).
function comet(hue: string): PendingAnimDef {
  const base = RGBA.fromHex(hue)
  const frames = ["◐", "◓", "◑", "◒"]
  const color: ColorGenerator = (f) => {
    // Gentle brightness shimmer as it rotates.
    const v = (Math.sin((f / frames.length) * Math.PI * 2) + 1) / 2
    return lighten(base, 1 + v * 0.15)
  }
  return { key: "comet", frames, color, interval: 110, hue }
}

// Pulse — a single dot breathes: grows/shrinks glyph + brightness (green).
function pulse(hue: string): PendingAnimDef {
  const base = RGBA.fromHex(hue)
  // Different dot sizes so the single cell visibly "breathes".
  const frames = ["·", "∙", "●", "⬤", "●", "∙"]
  const color: ColorGenerator = (f) => {
    const v = (Math.sin((f / frames.length) * Math.PI * 2) + 1) / 2
    return withAlpha(lighten(base, 1 + v * 0.2), 0.4 + v * 0.6)
  }
  return { key: "pulse", frames, color, interval: 110, hue }
}

// Shimmer — the classic braille spinner with a bright glint (orange).
function shimmer(hue: string): PendingAnimDef {
  const base = RGBA.fromHex(hue)
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  const color: ColorGenerator = (f) => {
    const v = (Math.sin((f / frames.length) * Math.PI * 2) + 1) / 2
    return lighten(base, 1.05 + v * 0.2)
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
