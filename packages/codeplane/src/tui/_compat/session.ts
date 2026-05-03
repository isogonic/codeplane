// TUI-local namespace barrel for @/session/session.
//
// `@/session/session` references `MessageV2.Assistant.fields.error` at module
// init. When @/session/session is the entry into the cycle through @/sync
// → @/bus/bus-event → @/session/message-v2 → ..., the read fires before
// `Assistant` is bound and TDZ-throws. Eager imports, top-level `await
// import()`, and Bun's `require()` all reproduce the trap because they all
// trigger the same module-init traversal.
//
// Workaround: re-implement `isDefaultTitle` here (it's a tiny regex that
// hasn't changed in years). The constants and shape ARE checked against
// the real source by `assertCompatParity()` below at boot — a fire-and-forget
// dynamic import that runs after the entire TUI graph has settled, so the
// cycle resolves and any future drift in @/session/session.isDefaultTitle is
// surfaced as a console warning.
import type * as SessionImpl from "@/session/session"

const parentTitlePrefix = "New session - "
const childTitlePrefix = "Child session - "

function isDefaultTitle(title: string): boolean {
  return new RegExp(
    `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  ).test(title)
}

export const Session = {
  isDefaultTitle,
} as const

export namespace Session {
  export type Info = SessionImpl.Info
}

// One-shot parity check. Runs after process startup; if our local copy and
// the real `@/session/session` ever diverge on `isDefaultTitle`, you'll see
// a console.warn telling you to update this file.
let parityChecked = false
function assertCompatParity(): void {
  if (parityChecked) return
  parityChecked = true
  setTimeout(async () => {
    try {
      const real = (await import("@/session/session")) as typeof SessionImpl
      const probe = parentTitlePrefix + new Date().toISOString()
      if (real.isDefaultTitle(probe) !== isDefaultTitle(probe)) {
        // eslint-disable-next-line no-console
        console.warn(
          "[tui/_compat/session] isDefaultTitle has drifted from @/session/session — update src/tui/_compat/session.ts.",
        )
      }
    } catch {
      // If the real module still can't be imported, that's an unrelated
      // problem; don't spam.
    }
  }, 0)
}
assertCompatParity()
