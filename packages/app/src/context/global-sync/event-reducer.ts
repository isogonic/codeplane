import { Binary } from "@codeplane-ai/shared/util/binary"
import { batch } from "solid-js"
import { produce, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type {
  Message,
  Part,
  PermissionRequest,
  Project,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@codeplane-ai/sdk/v2/client"
import type { State, VcsCache } from "./types"
import { trimSessions } from "./session-trim"
import { cachedSessionIDs, dropSessionCaches } from "./session-cache"
import { diffs as list, message as clean } from "@/utils/diffs"
import { sanitizeProject } from "./utils"

const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])

/**
 * Apply any deltas that arrived before the part existed in the store.
 *
 * The `message.part.updated` payload always carries the cumulative text
 * server-side, so a pending delta for the same field is by definition
 * already part of the payload's value. We still concatenate buffered
 * deltas onto the field to recover the visible streaming text when the
 * updated payload reflects only the snapshot at part creation (text="")
 * and the deltas hold every chunk emitted since.
 *
 * The next `message.part.updated` will overwrite the field with the true
 * cumulative server text, so any over-replay is self-healing.
 */
function mergePendingDeltas(part: Part, pending: Record<string, string>): Part {
  const next = { ...(part as Record<string, unknown>) } as Record<string, unknown>
  let changed = false
  for (const [field, delta] of Object.entries(pending)) {
    if (!delta) continue
    const existing = next[field]
    if (typeof existing === "string") {
      // Server snapshots whose text already contains the buffered delta
      // shouldn't double-append. A non-empty server text means the snapshot
      // was generated AFTER the deltas, so we keep the server value as the
      // source of truth.
      if (existing.length === 0) {
        next[field] = delta
        changed = true
      }
      continue
    }
    if (existing === undefined || existing === null) {
      next[field] = delta
      changed = true
    }
  }
  return (changed ? next : part) as Part
}

function fullyLoadedRootLimit(store: Store<State>, incoming: Session) {
  if (incoming.parentID) return store.limit
  const loadedRootCount = store.session.filter((session) => !session.parentID && !session.time?.archived).length
  if (loadedRootCount !== store.sessionTotal) return store.limit
  return Math.max(store.limit, loadedRootCount + 1)
}

export function applyGlobalEvent(input: {
  event: { type: string; properties?: unknown }
  project: Project[]
  setGlobalProject: (next: Project[] | ((draft: Project[]) => Project[])) => void
  refresh: () => void
}) {
  if (input.event.type === "global.disposed" || input.event.type === "server.connected") {
    input.refresh()
    return
  }

  if (input.event.type !== "project.updated") return
  const properties = sanitizeProject(input.event.properties as Project)
  const result = Binary.search(input.project, properties.id, (s) => s.id)
  if (result.found) {
    input.setGlobalProject(
      produce((draft) => {
        draft[result.index] = { ...draft[result.index], ...properties }
      }),
    )
    return
  }
  input.setGlobalProject(
    produce((draft) => {
      draft.splice(result.index, 0, properties)
    }),
  )
}

function cleanupSessionCaches(
  setStore: SetStoreFunction<State>,
  sessionID: string,
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void,
) {
  if (!sessionID) return
  setSessionTodo?.(sessionID, undefined)
  setStore(
    produce((draft) => {
      dropSessionCaches(draft, [sessionID])
    }),
  )
}

export function cleanupDroppedSessionCaches(
  store: Store<State>,
  setStore: SetStoreFunction<State>,
  next: Session[],
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void,
  preserve?: Iterable<string>,
) {
  const keep = new Set(next.map((item) => item.id))
  const preserved = new Set(preserve ?? [])
  const preserveCaches = new Set(
    store.session.filter((session) => preserved.has(session.id)).map((session) => session.id),
  )
  const stale = [
    ...Object.keys(store.message),
    ...Object.keys(store.session_diff),
    ...Object.keys(store.todo),
    ...Object.keys(store.permission),
    ...Object.keys(store.question),
    ...Object.keys(store.session_status),
    ...Object.values(store.part)
      .map((parts) => parts?.find((part) => !!part?.sessionID)?.sessionID)
      .filter((sessionID): sessionID is string => !!sessionID),
  ].filter(
    (sessionID, index, list) => !keep.has(sessionID) && !preserveCaches.has(sessionID) && list.indexOf(sessionID) === index,
  )
  // Also clear any buffered deltas whose owning session is now dropped.
  // `pendingDelta` is keyed by messageID, so we look up which message belongs
  // to which session via the parts store. Any stale entries left after a
  // tab churn are just memory we don't need to keep.
  if (stale.length === 0) return
  for (const sessionID of stale) {
    setSessionTodo?.(sessionID, undefined)
  }
  setStore(
    produce((draft) => {
      dropSessionCaches(draft, stale)
    }),
  )
}

export function applyDirectoryEvent(input: {
  event: { type: string; properties?: unknown }
  store: Store<State>
  setStore: SetStoreFunction<State>
  push: (directory: string) => void
  directory: string
  loadLsp: () => void
  vcsCache?: VcsCache
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
}) {
  const event = input.event
  switch (event.type) {
    case "server.instance.disposed": {
      input.push(input.directory)
      return
    }
    case "session.created": {
      const info = (event.properties as { info: Session }).info
      const result = Binary.search(input.store.session, info.id, (s) => s.id)
      if (result.found) {
        input.setStore("session", result.index, reconcile(info))
        break
      }
      const next = input.store.session.slice()
      next.splice(result.index, 0, info)
      const preserve = cachedSessionIDs(input.store)
      const limit = fullyLoadedRootLimit(input.store, info)
      const trimmed = trimSessions(next, { limit, permission: input.store.permission, preserve })
      const grewLimit = limit !== input.store.limit
      batch(() => {
        if (grewLimit) input.setStore("limit", limit)
        input.setStore("session", reconcile(trimmed, { key: "id" }))
        cleanupDroppedSessionCaches(input.store, input.setStore, trimmed, input.setSessionTodo, preserve)
        if (!info.parentID) input.setStore("sessionTotal", (value) => value + 1)
      })
      break
    }
    case "session.updated": {
      const info = (event.properties as { info: Session }).info
      const result = Binary.search(input.store.session, info.id, (s) => s.id)
      if (info.time.archived) {
        batch(() => {
          if (result.found) {
            input.setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          cleanupSessionCaches(input.setStore, info.id, input.setSessionTodo)
          if (info.parentID) return
          input.setStore("sessionTotal", (value) => Math.max(0, value - 1))
        })
        break
      }
      if (result.found) {
        input.setStore("session", result.index, reconcile(info))
        break
      }
      const next = input.store.session.slice()
      next.splice(result.index, 0, info)
      const preserve = cachedSessionIDs(input.store)
      const limit = fullyLoadedRootLimit(input.store, info)
      const trimmed = trimSessions(next, { limit, permission: input.store.permission, preserve })
      const grewLimit = limit !== input.store.limit
      batch(() => {
        if (grewLimit) input.setStore("limit", limit)
        input.setStore("session", reconcile(trimmed, { key: "id" }))
        cleanupDroppedSessionCaches(input.store, input.setStore, trimmed, input.setSessionTodo, preserve)
        if (!info.parentID && grewLimit) input.setStore("sessionTotal", (value) => value + 1)
      })
      break
    }
    case "session.deleted": {
      const info = (event.properties as { info: Session }).info
      const result = Binary.search(input.store.session, info.id, (s) => s.id)
      batch(() => {
        if (result.found) {
          input.setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 1)
            }),
          )
        }
        cleanupSessionCaches(input.setStore, info.id, input.setSessionTodo)
        if (info.parentID) return
        input.setStore("sessionTotal", (value) => Math.max(0, value - 1))
      })
      break
    }
    case "session.diff": {
      const props = event.properties as { sessionID: string; diff: SnapshotFileDiff[] }
      input.setStore("session_diff", props.sessionID, reconcile(list(props.diff), { key: "file" }))
      break
    }
    case "todo.updated": {
      const props = event.properties as { sessionID: string; todos: Todo[] }
      input.setStore("todo", props.sessionID, reconcile(props.todos, { key: "id" }))
      input.setSessionTodo?.(props.sessionID, props.todos)
      break
    }
    case "session.status": {
      const props = event.properties as { sessionID: string; status: SessionStatus }
      input.setStore("session_status", props.sessionID, reconcile(props.status))
      break
    }
    case "message.updated": {
      const info = clean((event.properties as { info: Message }).info)
      const messages = input.store.message[info.sessionID]
      if (!messages) {
        input.setStore("message", info.sessionID, [info])
        break
      }
      const result = Binary.search(messages, info.id, (m) => m.id)
      if (result.found) {
        input.setStore("message", info.sessionID, result.index, reconcile(info))
        break
      }
      input.setStore(
        "message",
        info.sessionID,
        produce((draft) => {
          draft.splice(result.index, 0, info)
        }),
      )
      break
    }
    case "message.removed": {
      const props = event.properties as { sessionID: string; messageID: string }
      input.setStore(
        produce((draft) => {
          const messages = draft.message[props.sessionID]
          if (messages) {
            const result = Binary.search(messages, props.messageID, (m) => m.id)
            if (result.found) messages.splice(result.index, 1)
          }
          delete draft.part[props.messageID]
          delete draft.pendingDelta[props.messageID]
        }),
      )
      break
    }
    case "message.part.updated": {
      const part = (event.properties as { part: Part }).part
      if (SKIP_PARTS.has(part.type)) break
      // Drain any buffered deltas that arrived before this part existed.
      // The server publishes `message.part.updated` via `SyncEvent.run` whose
      // bus publish is fire-and-forget (`void publish(...)`), while
      // `message.part.delta` goes through `bus.publish` directly. The two
      // fibers can interleave so deltas reach the client first. The
      // `message.part.updated` payload carries a `time` field whose value is
      // the server-side `Date.now()` snapshot at the moment the cumulative
      // text was captured — we only replay pending deltas for THIS part if
      // they were buffered AFTER this snapshot. For now we conservatively
      // replay every buffered delta for the part; the next
      // `message.part.updated` will carry cumulative text that already
      // includes every delta, so a redundant replay is harmless.
      const pendingForPart = input.store.pendingDelta[part.messageID]?.[part.id]
      const merged = pendingForPart ? mergePendingDeltas(part, pendingForPart) : part
      const parts = input.store.part[part.messageID]
      if (!parts) {
        input.setStore("part", part.messageID, [merged])
      } else {
        const result = Binary.search(parts, part.id, (p) => p.id)
        if (result.found) {
          input.setStore("part", part.messageID, result.index, reconcile(merged))
        } else {
          input.setStore(
            "part",
            part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, merged)
            }),
          )
        }
      }
      if (pendingForPart) {
        input.setStore(
          "pendingDelta",
          produce((draft) => {
            const forMessage = draft[part.messageID]
            if (!forMessage) return
            delete forMessage[part.id]
            if (Object.keys(forMessage).length === 0) delete draft[part.messageID]
          }),
        )
      }
      break
    }
    case "message.part.removed": {
      const props = event.properties as { messageID: string; partID: string }
      input.setStore(
        produce((draft) => {
          const list = draft.part[props.messageID]
          if (list) {
            const next = Binary.search(list, props.partID, (p) => p.id)
            if (next.found) {
              list.splice(next.index, 1)
              if (list.length === 0) delete draft.part[props.messageID]
            }
          }
          const pendingForMessage = draft.pendingDelta[props.messageID]
          if (pendingForMessage) {
            delete pendingForMessage[props.partID]
            if (Object.keys(pendingForMessage).length === 0) delete draft.pendingDelta[props.messageID]
          }
        }),
      )
      break
    }
    case "message.part.delta": {
      const props = event.properties as { messageID: string; partID: string; field: string; delta: string }
      const parts = input.store.part[props.messageID]
      const result = parts ? Binary.search(parts, props.partID, (p) => p.id) : { found: false, index: 0 }
      if (parts && result.found) {
        input.setStore(
          "part",
          props.messageID,
          produce((draft) => {
            const part = draft[result.index]
            const field = props.field as keyof typeof part
            const existing = part[field] as string | undefined
            ;(part[field] as string) = (existing ?? "") + props.delta
          }),
        )
        break
      }
      // Part isn't in the store yet — the corresponding `message.part.updated`
      // arrived later (server publish race) or this session's parts were
      // evicted. Buffer the delta so it can be applied when the part shows
      // up via `message.part.updated`. Without this branch the delta would
      // be silently dropped and the UI would appear frozen until the next
      // full part snapshot.
      input.setStore(
        "pendingDelta",
        produce((draft) => {
          const forMessage = draft[props.messageID] ?? (draft[props.messageID] = {})
          const forPart = forMessage[props.partID] ?? (forMessage[props.partID] = {})
          forPart[props.field] = (forPart[props.field] ?? "") + props.delta
        }),
      )
      break
    }
    case "vcs.branch.updated": {
      const props = event.properties as { branch?: string }
      if (input.store.vcs?.branch === props.branch) break
      const next = { ...input.store.vcs, branch: props.branch }
      input.setStore("vcs", next)
      if (input.vcsCache) input.vcsCache.setStore("value", next)
      break
    }
    case "permission.asked": {
      const permission = event.properties as PermissionRequest
      const permissions = input.store.permission[permission.sessionID]
      if (!permissions) {
        input.setStore("permission", permission.sessionID, [permission])
        break
      }
      const result = Binary.search(permissions, permission.id, (p) => p.id)
      if (result.found) {
        input.setStore("permission", permission.sessionID, result.index, reconcile(permission))
        break
      }
      input.setStore(
        "permission",
        permission.sessionID,
        produce((draft) => {
          draft.splice(result.index, 0, permission)
        }),
      )
      break
    }
    case "permission.replied": {
      const props = event.properties as { sessionID: string; requestID: string }
      const permissions = input.store.permission[props.sessionID]
      if (!permissions) break
      const result = Binary.search(permissions, props.requestID, (p) => p.id)
      if (!result.found) break
      input.setStore(
        "permission",
        props.sessionID,
        produce((draft) => {
          draft.splice(result.index, 1)
        }),
      )
      break
    }
    case "question.asked": {
      const question = event.properties as QuestionRequest
      const questions = input.store.question[question.sessionID]
      if (!questions) {
        input.setStore("question", question.sessionID, [question])
        break
      }
      const result = Binary.search(questions, question.id, (q) => q.id)
      if (result.found) {
        input.setStore("question", question.sessionID, result.index, reconcile(question))
        break
      }
      input.setStore(
        "question",
        question.sessionID,
        produce((draft) => {
          draft.splice(result.index, 0, question)
        }),
      )
      break
    }
    case "question.replied":
    case "question.rejected": {
      const props = event.properties as { sessionID: string; requestID: string }
      const questions = input.store.question[props.sessionID]
      if (!questions) break
      const result = Binary.search(questions, props.requestID, (q) => q.id)
      if (!result.found) break
      input.setStore(
        "question",
        props.sessionID,
        produce((draft) => {
          draft.splice(result.index, 1)
        }),
      )
      break
    }
    case "lsp.updated": {
      input.loadLsp()
      break
    }
  }
}
