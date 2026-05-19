import { createEffect, createSignal, on, onCleanup } from "solid-js"

export type AnimatedNumberProps = {
  value: number
  format: (value: number) => string
  durationMs?: number
}

/**
 * Tweens a number from its previous value to the new one with cubic-out
 * easing. Only `props.value` is reactive — the displayed value is updated
 * imperatively via rAF so the effect doesn't self-retrigger on every frame.
 *
 * The first render snaps to the target so the stats grid doesn't visibly
 * count up on initial load from cache.
 */
const SAFE = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)
const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi)

export function AnimatedNumber(props: AnimatedNumberProps) {
  const initial = SAFE(props.value)
  const [display, setDisplay] = createSignal(initial)
  let initialized = false
  let frame: number | undefined
  let lastDisplayed = initial

  createEffect(
    on(
      () => SAFE(props.value),
      (target) => {
        if (!initialized) {
          initialized = true
          lastDisplayed = target
          setDisplay(target)
          return
        }
        const from = lastDisplayed
        if (from === target) return
        // Skip animation for huge jumps — tweening 10+ orders of magnitude
        // wastes frames and is the kind of thing that can hand the renderer
        // an overflowed intermediate value.
        const range = Math.abs(target - from)
        if (range > 1e9 || !Number.isFinite(range)) {
          lastDisplayed = target
          setDisplay(target)
          return
        }
        const duration = props.durationMs ?? 700
        const startTime = performance.now()
        const lo = Math.min(from, target)
        const hi = Math.max(from, target)
        const animate = (now: number) => {
          const t = Math.min(1, (now - startTime) / duration)
          const eased = 1 - Math.pow(1 - t, 3)
          const next = clamp(from + (target - from) * eased, lo, hi)
          lastDisplayed = next
          setDisplay(next)
          if (t < 1) frame = requestAnimationFrame(animate)
          else {
            // Snap to the exact target so accumulated FP drift doesn't leave
            // the display short of the value.
            lastDisplayed = target
            setDisplay(target)
            frame = undefined
          }
        }
        if (frame !== undefined) cancelAnimationFrame(frame)
        frame = requestAnimationFrame(animate)
      },
    ),
  )

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  return <>{props.format(display())}</>
}
