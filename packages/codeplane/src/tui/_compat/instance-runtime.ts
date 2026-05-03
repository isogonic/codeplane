// TUI-local stub for @/project/instance-runtime. The TUI references
// InstanceRuntime as part of the worker bootstrapping; the real implementation
// lives in the legacy launcher path. We expose a no-op shape so worker.ts
// compiles — it doesn't run in the new TUI's startup path.
import { Effect, Layer } from "effect"

export class InstanceRuntime {
  static defaultLayer: Layer.Layer<never, never, never> = Layer.empty
  static use<R>(fn: () => R): Effect.Effect<R, never, never> {
    return Effect.sync(fn)
  }
  static async disposeAllInstances(): Promise<void> {
    // no-op — instance lifecycle is managed by the codeplane launcher
  }
}
