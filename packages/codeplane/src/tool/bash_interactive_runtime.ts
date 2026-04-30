// Tracks live bash_interactive PTY processes by tool-call ID so the HTTP
// /global/bash-interactive/:callID/kill endpoint can SIGTERM the process
// when the user clicks the "kill" button in the renderer. Input itself
// flows through Question.Service (chat dialog) — the agent declares each
// expected prompt up-front, the tool detects them in the PTY output, and
// the user's answer is written back via the same callback that owns the
// proc. So callers never need direct stdin access from outside the tool.

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

export function appendOutput(callID: string, chunk: string) {
  const entry = active.get(callID)
  if (!entry) return
  entry.output += chunk
}

export function get(callID: string): Active | undefined {
  return active.get(callID)
}

export function unregister(callID: string) {
  active.delete(callID)
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
