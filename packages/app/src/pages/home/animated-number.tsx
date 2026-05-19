import { createEffect, createSignal, onCleanup } from "solid-js"

export type AnimatedNumberProps = {
  value: number
  format: (value: number) => string
  durationMs?: number
}

/**
 * Tweens a number from its previous value to the new one with cubic-out
 * easing. The first render snaps to the target (no animation from 0) so the
 * stats grid doesn't visibly count up on initial load from cache.
 */
export function AnimatedNumber(props: AnimatedNumberProps) {
  const [display, setDisplay] = createSignal(props.value)
  let initialized = false
  let frame: number | undefined

  createEffect(() => {
    const target = props.value
    if (!initialized) {
      initialized = true
      setDisplay(target)
      return
    }
    const from = display()
    if (from === target) return
    const duration = props.durationMs ?? 700
    const startTime = performance.now()
    const animate = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (target - from) * eased)
      if (t < 1) frame = requestAnimationFrame(animate)
    }
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(animate)
  })

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  return <>{props.format(display())}</>
}
