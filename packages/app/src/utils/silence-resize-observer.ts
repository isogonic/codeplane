/**
 * "ResizeObserver loop completed with undelivered notifications" is a benign
 * browser warning that fires when an observer's callback synchronously
 * triggers another resize. Several upstream libs (Kobalte popovers, virtua
 * virtualizer, our own auto-scroll hook that intentionally locks the bottom
 * in the same frame) cause it, but the next frame always converges. The
 * warning is purely cosmetic — nothing breaks — but it bubbles up to error
 * overlays and dev tools, drowning out real errors.
 *
 * Suppress only that specific message at the window level. Real errors and
 * unhandled rejections continue to propagate normally.
 */

const NOISE = "ResizeObserver loop"

let installed = false

export function isResizeObserverNoise(value: unknown): boolean {
  if (typeof value === "string") return value.includes(NOISE)
  if (value instanceof Error) return value.message.includes(NOISE)
  if (!value || typeof value !== "object") return false
  if ("message" in value && typeof value.message === "string") return value.message.includes(NOISE)
  return false
}

export function silenceResizeObserverNoise() {
  if (installed) return
  if (typeof window === "undefined") return
  installed = true

  window.addEventListener(
    "error",
    (event) => {
      if (isResizeObserverNoise(event)) {
        event.stopImmediatePropagation()
        event.preventDefault()
      }
    },
    true,
  )

  window.addEventListener("unhandledrejection", (event) => {
    if (!isResizeObserverNoise(event.reason)) return
    event.preventDefault()
  })

  const error = console.error.bind(console)
  console.error = (...input: unknown[]) => {
    if (input.some(isResizeObserverNoise)) return
    error(...input)
  }

  const report = window.reportError?.bind(window)
  if (!report) return
  window.reportError = ((error: unknown) => {
    if (isResizeObserverNoise(error)) return
    report(error)
  }) as typeof window.reportError
}
