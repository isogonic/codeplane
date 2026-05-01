import type { EventSessionError } from "@codeplane-ai/sdk/v2/client"

type SessionError = EventSessionError["properties"]["error"]

const errorMessage = (error: SessionError) => {
  if (!error) return
  const message = error.data?.message
  if (typeof message === "string" && message) return message
  return error.name
}

export function isIgnorableSessionError(error: SessionError) {
  return error?.name === "MessageAbortedError"
}

export function describeSessionError(error: SessionError) {
  return errorMessage(error) ?? "Unknown session error"
}

export function createRecentSessionErrorGate(ttlMs = 5_000) {
  const seen = new Map<string, number>()

  return (input: { directory: string; sessionID?: string; error: SessionError }) => {
    const now = Date.now()
    for (const [key, time] of seen) {
      if (now - time <= ttlMs) continue
      seen.delete(key)
    }

    const key = [
      input.directory,
      input.sessionID ?? "global",
      input.error?.name ?? "unknown",
      describeSessionError(input.error),
    ].join("\u0000")
    const previous = seen.get(key)
    if (previous !== undefined && now - previous <= ttlMs) return false
    seen.set(key, now)
    return true
  }
}
