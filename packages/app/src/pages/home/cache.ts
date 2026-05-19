import { createStore, produce } from "solid-js/store"
import { useServer } from "@/context/server"
import { Persist, persisted } from "@/utils/persist"
import { aggregateSessionMessages, SESSION_AGGREGATE_VERSION, type SessionAggregate } from "./aggregate"
import type { Message } from "@codeplane-ai/sdk/v2/client"

export type HomeCacheStore = {
  version: number
  /** sessionID → aggregate. */
  aggregates: Record<string, SessionAggregate>
}

/**
 * Persistent per-server cache of per-session message aggregates.
 *
 * Survives page reloads so the home page can render immediately from cache
 * and only re-fetch sessions whose `time.updated` is newer than the
 * `updatedAt` we stored.
 */
export function createHomeCache() {
  const server = useServer()
  const [store, setStore, _, ready] = persisted(
    Persist.server(server.scope, "home-stats", ["home-stats.v1"]),
    createStore<HomeCacheStore>({
      version: SESSION_AGGREGATE_VERSION,
      aggregates: {},
    }),
  )

  // If the persisted shape is from an older version, wipe the aggregates so we
  // never iterate a record that's missing fields the current shape expects.
  // Bare migration: drop everything and let the home page re-fetch from the
  // session store; cheaper than trying to upgrade in place.
  if (store.version !== SESSION_AGGREGATE_VERSION) {
    setStore("version", SESSION_AGGREGATE_VERSION)
    setStore("aggregates", {})
  }

  function get(sessionID: string): SessionAggregate | undefined {
    return store.aggregates[sessionID]
  }

  function isStale(sessionID: string, sessionUpdatedAt: number): boolean {
    const cached = store.aggregates[sessionID]
    if (!cached) return true
    if (store.version !== SESSION_AGGREGATE_VERSION) return true
    return cached.updatedAt < sessionUpdatedAt
  }

  function applyMessages(sessionID: string, sessionUpdatedAt: number, messages: Message[]) {
    const next = aggregateSessionMessages(sessionID, sessionUpdatedAt, messages)
    // Full replace — not `reconcile(..., { merge: true })`, which would keep
    // stale per-day records that the latest fetch no longer contains, leading
    // to inflated/incorrect aggregate counts over time.
    setStore(
      "aggregates",
      produce((draft) => {
        draft[sessionID] = next
      }),
    )
  }

  function drop(sessionIDs: string[]) {
    if (sessionIDs.length === 0) return
    setStore("aggregates", (prev) => {
      const next = { ...prev }
      for (const id of sessionIDs) delete next[id]
      return next
    })
  }

  function syncWithSessionList(sessionIDs: string[]) {
    const known = new Set(sessionIDs)
    const stale: string[] = []
    for (const id of Object.keys(store.aggregates)) {
      if (!known.has(id)) stale.push(id)
    }
    if (stale.length > 0) drop(stale)
  }

  function all(): SessionAggregate[] {
    return Object.values(store.aggregates)
  }

  return {
    ready,
    store,
    get,
    isStale,
    applyMessages,
    syncWithSessionList,
    all,
  }
}
