// Tracks live bash_interactive PTY processes by tool-call ID so the HTTP
// /global/bash-interactive/:callID/kill endpoint can SIGTERM the process and
// internal routes can locate the running PTY. User-facing terminal input is
// mediated by bash_interactive prompt handling, not by a direct input field.

import type { Proc } from "#pty"

interface Active {
  proc: Proc
  callID: string
  sessionID: string
  output: string
  startedAt: number
}

const active = new Map<string, Active>()

export function register(callID: string, entry: Omit<Active, "callID" | "output" | "startedAt"> & { proc: Proc }) {
  active.set(callID, {
    proc: entry.proc,
    sessionID: entry.sessionID,
    callID,
    output: "",
    startedAt: Date.now(),
  })
}

// Rolling-tail cap on accumulated interactive output. Without it a long-running
// interactive command (tail -f, a dev server, a chatty REPL) grows this buffer
// unbounded for the life of the session. Generous enough that normal commands
// are unaffected; only pathological output is trimmed to its most-recent tail.
export const INTERACTIVE_OUTPUT_CAP = 2_000_000

export function appendOutput(callID: string, chunk: string) {
  const entry = active.get(callID)
  if (!entry) return
  entry.output += chunk
  if (entry.output.length > INTERACTIVE_OUTPUT_CAP) entry.output = entry.output.slice(-INTERACTIVE_OUTPUT_CAP)
}

export function get(callID: string): Active | undefined {
  return active.get(callID)
}

export function unregister(callID: string) {
  active.delete(callID)
}

/** Direct stdin write into the running PTY for the given tool call.
 *  Kept as a low-level runtime primitive; the app UI should not expose it as
 *  a direct terminal input field. */
export function writeInput(callID: string, data: string): boolean {
  const entry = active.get(callID)
  if (!entry) return false
  try {
    entry.proc.write(data)
    return true
  } catch {
    return false
  }
}

export function killProc(callID: string, signal: string = "SIGTERM"): boolean {
  const entry = active.get(callID)
  if (!entry) return false
  try {
    entry.proc.kill(signal)
    return true
  } catch {
    return false
  }
}
