import type {
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@codeplane-ai/sdk/v2/client"

export const SESSION_CACHE_LIMIT = 40

export type SessionCache = {
  session_status: Record<string, SessionStatus | undefined>
  session_diff: Record<string, SnapshotFileDiff[] | undefined>
  todo: Record<string, Todo[] | undefined>
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
  permission: Record<string, PermissionRequest[] | undefined>
  question: Record<string, QuestionRequest[] | undefined>
}

export function cachedSessionIDs(store: SessionCache) {
  const result = new Set<string>()
  // Single-pass collection of all session IDs — avoids creating
  // N intermediate arrays from multiple Object.keys/values calls.
  for (const id of Object.keys(store.message)) result.add(id)
  for (const id of Object.keys(store.session_diff)) result.add(id)
  for (const id of Object.keys(store.todo)) result.add(id)
  for (const id of Object.keys(store.permission)) result.add(id)
  for (const id of Object.keys(store.question)) result.add(id)
  for (const id of Object.keys(store.session_status)) result.add(id)
  for (const parts of Object.values(store.part)) {
    const sessionID = parts?.find((part) => !!part?.sessionID)?.sessionID
    if (sessionID) result.add(sessionID)
  }
  return result
}

export function dropSessionCaches(store: SessionCache, sessionIDs: Iterable<string>) {
  const stale = new Set(Array.from(sessionIDs).filter(Boolean))
  if (stale.size === 0) return

  // Collect keys first to avoid iterating over a dict being modified.
  const partKeys = Object.keys(store.part)
  for (const key of partKeys) {
    const parts = store.part[key]
    if (!parts?.some((part) => stale.has(part?.sessionID ?? ""))) continue
    delete store.part[key]
  }

  for (const sessionID of stale) {
    delete store.message[sessionID]
    delete store.todo[sessionID]
    delete store.session_diff[sessionID]
    delete store.session_status[sessionID]
    delete store.permission[sessionID]
    delete store.question[sessionID]
  }
}

export function pickSessionCacheEvictions(input: {
  seen: Set<string>
  keep: string
  limit: number
  preserve?: Iterable<string>
}) {
  const stale: string[] = []
  const keep = new Set([input.keep, ...Array.from(input.preserve ?? [])])
  if (input.seen.has(input.keep)) input.seen.delete(input.keep)
  input.seen.add(input.keep)
  for (const id of input.seen) {
    if (input.seen.size - stale.length <= input.limit) break
    if (keep.has(id)) continue
    stale.push(id)
  }
  for (const id of stale) {
    input.seen.delete(id)
  }
  return stale
}
