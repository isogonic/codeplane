import type {
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@codeplane-ai/sdk/v2/client"
import type { PromptQueueJob } from "./types"

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
  prompt_queue: Record<string, PromptQueueJob[] | undefined>
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
      // A session with only a queue row (just-enqueued, no messages yet)
      // would otherwise be evicted on the very next trim pass — survey
      // prompt_queue so freshly-queued sessions stick until their first
      // message lands.
      ...Object.keys(store.prompt_queue ?? {}),
      ...Object.values(store.part)
        .map((parts) => parts?.find((part) => !!part?.sessionID)?.sessionID)
        .filter((sessionID): sessionID is string => !!sessionID),
    ].filter(Boolean),
  )
}

// `pendingDelta` is intentionally not surveyed for cached session IDs —
// buffered deltas normally belong to a message that already lives in
// `store.message`. If the owning message gets evicted, `dropSessionCaches`
// drops the buffered deltas too via its `droppedMessageIDs` walk. But a delta
// whose part snapshot NEVER lands (and whose session is later evicted before
// any message/part is created) has no message in `store.message`/`store.part`,
// so the walk can't reach it. To stop those orphans from leaking forever,
// `dropSessionCaches` also bounds `pendingDelta` to this many entries.
export const PENDING_DELTA_LIMIT = 200

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
    // Older callers may not have a prompt_queue map at all (added with the
    // server-authoritative queue migration); skip rather than throw.
    if (store.prompt_queue) delete store.prompt_queue[sessionID]
  }

  for (const messageID of droppedMessageIDs) {
    delete store.pendingDelta[messageID]
  }

  // Bound orphaned buffered deltas (snapshot never landed, so the walk above
  // can't reach them). Object key order is insertion order, so dropping from
  // the front evicts the oldest — the ones least likely to still be awaiting an
  // imminent snapshot.
  const pendingKeys = Object.keys(store.pendingDelta)
  if (pendingKeys.length > PENDING_DELTA_LIMIT) {
    for (const messageID of pendingKeys.slice(0, pendingKeys.length - PENDING_DELTA_LIMIT)) {
      delete store.pendingDelta[messageID]
    }
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
