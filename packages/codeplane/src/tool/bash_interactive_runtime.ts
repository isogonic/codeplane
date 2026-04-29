// Tracks live bash_interactive PTY processes by tool-call ID so the HTTP
// /global/bash-interactive/:callID/stdin endpoint can write the user's
// keystrokes into the running command.

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
