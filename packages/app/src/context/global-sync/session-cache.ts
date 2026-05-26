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
  pendingDelta: Record<string, Record<string, Record<string, string>> | undefined>
}

export function cachedSessionIDs(store: SessionCache) {
  return new Set(
    [
      ...Object.keys(store.message),
      ...Object.keys(store.session_diff),
      ...Object.keys(store.todo),
      ...Object.keys(store.permission),
      ...Object.keys(store.question),
      ...Object.keys(store.session_status),
      ...Object.values(store.part)
        .map((parts) => parts?.find((part) => !!part?.sessionID)?.sessionID)
        .filter((sessionID): sessionID is string => !!sessionID),
    ].filter(Boolean),
  )
}

// `pendingDelta` is intentionally not surveyed for cached session IDs —
// buffered deltas always belong to a message that already lives in
// `store.message`. If the owning message gets evicted, `dropSessionCaches`
// drops the buffered deltas too via its `droppedMessageIDs` walk above.

export function dropSessionCaches(store: SessionCache, sessionIDs: Iterable<string>) {
  const stale = new Set(Array.from(sessionIDs).filter(Boolean))
  if (stale.size === 0) return

  const droppedMessageIDs = new Set<string>()
  for (const key of Object.keys(store.part)) {
    const parts = store.part[key]
    if (!parts?.some((part) => stale.has(part?.sessionID ?? ""))) continue
    droppedMessageIDs.add(key)
    delete store.part[key]
  }

  for (const sessionID of stale) {
    const messages = store.message[sessionID]
    if (messages) for (const message of messages) droppedMessageIDs.add(message.id)
    delete store.message[sessionID]
    delete store.todo[sessionID]
    delete store.session_diff[sessionID]
    delete store.session_status[sessionID]
    delete store.permission[sessionID]
    delete store.question[sessionID]
  }

  for (const messageID of droppedMessageIDs) {
    delete store.pendingDelta[messageID]
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
