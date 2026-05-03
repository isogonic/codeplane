// TUI-local stub for server/global-lifecycle. The TUI invokes these as a no-op
// when running standalone — the launcher manages instance lifecycle separately.
import { Effect } from "effect"

export const emitGlobalDisposed = Effect.sync(() => undefined)

export const disposeAllInstancesAndEmitGlobalDisposed = Effect.fn("Stub.disposeAllInstancesAndEmitGlobalDisposed")(
  function* (_options?: { swallowErrors?: boolean }) {
    return undefined
  },
)
