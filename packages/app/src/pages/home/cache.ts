import { createStore, reconcile } from "solid-js/store"
import { useServer } from "@/context/server"
import { Persist, persisted } from "@/utils/persist"
import { aggregateSessionMessages, SESSION_AGGREGATE_VERSION, type SessionAggregate } from "./aggregate"
import type { Message } from "@codeplane-ai/sdk/v2/client"

/**
 * Sanity caps so a corrupted persisted aggregate can never multiply itself
 * into the trillions on display. If any single aggregate breaches these
 * caps, we treat it as poisoned and drop it instead of summing it in.
 */
const MAX_SAFE_DAYS_PER_AGGREGATE = 10_000
const MAX_SAFE_COUNT_PER_DAY = 100_000
const MAX_SAFE_TOKENS_PER_DAY = 1_000_000_000

function looksSane(aggregate: SessionAggregate | undefined): aggregate is SessionAggregate {
  if (!aggregate || !aggregate.days || typeof aggregate.days !== "object") return false
  const keys = Object.keys(aggregate.days)
  if (keys.length > MAX_SAFE_DAYS_PER_AGGREGATE) return false
  for (const key of keys) {
    const daily = aggregate.days[Number(key)]
    if (!daily) continue
    if (!Number.isFinite(daily.count) || daily.count < 0 || daily.count > MAX_SAFE_COUNT_PER_DAY) return false
    if (!Number.isFinite(daily.tokens) || daily.tokens < 0 || daily.tokens > MAX_SAFE_TOKENS_PER_DAY) return false
  }
  return true
}

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

  // Wipe aggregates if the persisted shape is from an older version, OR if
  // any single aggregate looks corrupted (e.g., inflated counts from earlier
  // versions with the reconcile-merge bug). Bare migration: drop everything
  // and let the home page re-fetch from the session store.
  const persistedAggregates = store.aggregates ?? {}
  const allLookSane =
    store.version === SESSION_AGGREGATE_VERSION &&
    Object.values(persistedAggregates).every((aggregate) => looksSane(aggregate))
  if (!allLookSane) {
    setStore("version", SESSION_AGGREGATE_VERSION)
    setStore("aggregates", reconcile({}))
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
    // If the aggregate we just built somehow looks insane (massive day
    // counts, broken numbers), refuse to commit it — better an empty cell
    // than an inflated one. Sanity check is cheap.
    if (!looksSane(next)) return
    // Path-based set REPLACES the entry — no merge, no proxy reuse.
    // `reconcile(next)` (without `merge`) drops leaf properties from the
    // previous value so days that are no longer present disappear.
    setStore("aggregates", sessionID, reconcile(next))
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
