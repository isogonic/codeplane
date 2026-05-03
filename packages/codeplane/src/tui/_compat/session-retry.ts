// TUI-local barrel for @/session/retry.
//
// `@/session/retry` transitively imports `@/session/message-v2` which trips
// a TDZ on `MessageV2.Assistant.fields.error` when loaded outside the
// bundled launcher path. Eager `import`, `await import()`, and `require()`
// all reproduce the trap because they all trigger the same module-init
// traversal at this point in the load order.
//
// Workaround: keep a local copy of `GO_UPSELL_MESSAGE` (a static literal
// with no runtime semantics). `assertCompatParity()` below late-loads the
// real module after startup and console.warns if the literal ever drifts.
import type * as RetryImpl from "@/session/retry"

export const GO_UPSELL_MESSAGE = "Free usage exceeded, subscribe to Go https://example.invalid/go"

export const SessionRetry = {
  GO_UPSELL_MESSAGE,
} as const

let parityChecked = false
function assertCompatParity(): void {
  if (parityChecked) return
  parityChecked = true
  setTimeout(async () => {
    try {
      const real = (await import("@/session/retry")) as typeof RetryImpl
      if (real.GO_UPSELL_MESSAGE !== GO_UPSELL_MESSAGE) {
        // eslint-disable-next-line no-console
        console.warn(
          "[tui/_compat/session-retry] GO_UPSELL_MESSAGE has drifted from @/session/retry — update src/tui/_compat/session-retry.ts.",
        )
      }
    } catch {
      // Real module not loadable yet; ignore.
    }
  }, 0)
}
assertCompatParity()
