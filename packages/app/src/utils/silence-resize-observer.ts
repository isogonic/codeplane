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

export function silenceResizeObserverNoise() {
  if (installed) return
  if (typeof window === "undefined") return
  installed = true

  window.addEventListener(
    "error",
    (event) => {
      if (typeof event.message === "string" && event.message.includes(NOISE)) {
        event.stopImmediatePropagation()
        event.preventDefault()
      }
    },
    true,
  )

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason
    const message =
      typeof reason === "string"
        ? reason
        : reason && typeof reason === "object" && "message" in reason
          ? String((reason as { message: unknown }).message ?? "")
          : ""
    if (message.includes(NOISE)) {
      event.preventDefault()
    }
  })
}
