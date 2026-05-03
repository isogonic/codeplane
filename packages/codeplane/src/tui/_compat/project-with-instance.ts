// TUI-local stub for WithInstance. The TUI uses `provide` to scope a handler
// inside an instance context. In the codeplane runtime, the instance context
// is set up by the launcher, so the TUI's `provide` is effectively just an
// async pass-through.

export namespace WithInstance {
  export async function provide<R>(input: { directory: string; fn: () => R }): Promise<R> {
    return input.fn()
  }
}
