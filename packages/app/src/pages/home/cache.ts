import { createEffect, createSignal } from "solid-js"
import { useServer } from "@/context/server"
import { checksum } from "@codeplane-ai/shared/util/encode"
import {
  aggregateSessionMessages,
  applySessionAggregateToMaterializedStats,
  emptyMaterializedHomeStats,
  isMaterializedHomeStats,
  materializeAggregates,
  removeSessionAggregatesFromMaterializedStats,
  SESSION_AGGREGATE_VERSION,
  type MaterializedHomeStats,
  type SessionAggregate,
  type SessionStatsEntry,
} from "./aggregate"

export type HomeCacheStore = {
  version: number
  /** sessionID → aggregate. */
  aggregates: Record<string, SessionAggregate>
  /** Live accumulated stats, updated by aggregate deltas and read directly by Home. */
  materialized: MaterializedHomeStats
}

export const emptyHomeCacheStore = (): HomeCacheStore => ({
  version: SESSION_AGGREGATE_VERSION,
  aggregates: {},
  materialized: emptyMaterializedHomeStats(),
})

export function normalizeHomeCacheStore(value: unknown): HomeCacheStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyHomeCacheStore()
  const parsed = value as Partial<HomeCacheStore>
  if (parsed.version !== SESSION_AGGREGATE_VERSION && parsed.version !== 4) return emptyHomeCacheStore()
  const aggregates =
    parsed.aggregates && typeof parsed.aggregates === "object" && !Array.isArray(parsed.aggregates)
      ? parsed.aggregates
      : {}
  return {
    version: SESSION_AGGREGATE_VERSION,
    aggregates,
    materialized:
      parsed.version === SESSION_AGGREGATE_VERSION && isMaterializedHomeStats(parsed.materialized)
        ? parsed.materialized
        : materializeAggregates(Object.values(aggregates)),
  }
}

/**
 * Per-instance persistent cache of per-session message aggregates.
 *
 * Implementation note (why not `persisted()` + `createStore` like the rest of
 * the app): the helper layers `solid-js/store` proxies and deep-merge
 * normalisation. With both in play it is genuinely hard to be certain that
 * "write a fresh aggregate for session X" doesn't somehow merge per-day
 * leaves from the previous aggregate — which is exactly the bug pattern that
 * produced wildly inflated counts (sum-of-history rather than current value).
 *
 * We use a plain `createSignal` + immutable spread (`{ ...prev, [id]: next }`)
 * so every applyMessages call provably replaces the entry, and we serialise
 * to localStorage ourselves so we control exactly what hits storage.
 */
export function createHomeCache() {
  const server = useServer()
  const storageKey = (() => {
    const scope = server.scope
    const scopeKey = typeof scope === "string" ? scope : scope.key
    return `codeplane.server.${tokenize(scopeKey, "server")}.dat:home-stats`
  })()

  const initial = ((): HomeCacheStore => {
    if (typeof localStorage === "undefined") return emptyHomeCacheStore()
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return emptyHomeCacheStore()
      return normalizeHomeCacheStore(JSON.parse(raw))
    } catch {
      return emptyHomeCacheStore()
    }
  })()

  const [state, setState] = createSignal<HomeCacheStore>(initial)

  // Persist on every change. Synchronous write — fine for localStorage and
  // for the typical aggregate size (a few hundred KB at most).
  createEffect(() => {
    const value = state()
    if (typeof localStorage === "undefined") return
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      // Quota or disabled — silent. Stats still work in-memory for this session.
    }
  })

  function get(sessionID: string): SessionAggregate | undefined {
    return state().aggregates[sessionID]
  }

  function isStale(sessionID: string, sessionUpdatedAt: number): boolean {
    const cached = state().aggregates[sessionID]
    if (!cached) return true
    return cached.updatedAt < sessionUpdatedAt
  }

  function applyAggregate(next: SessionAggregate) {
    setState((prev) => ({
      version: SESSION_AGGREGATE_VERSION,
      aggregates: { ...prev.aggregates, [next.sessionID]: next },
      materialized: applySessionAggregateToMaterializedStats(prev.materialized, prev.aggregates[next.sessionID], next),
    }))
  }

  function applyMessages(sessionID: string, sessionUpdatedAt: number, entries: SessionStatsEntry[]) {
    applyAggregate(aggregateSessionMessages(sessionID, sessionUpdatedAt, entries))
  }

  function drop(sessionIDs: string[]) {
    if (sessionIDs.length === 0) return
    setState((prev) => {
      const aggregates = { ...prev.aggregates }
      const ids = [...new Set(sessionIDs)]
      const removed = ids.flatMap((id) => (aggregates[id] ? [aggregates[id]] : []))
      for (const id of ids) delete aggregates[id]
      return {
        version: SESSION_AGGREGATE_VERSION,
        aggregates,
        materialized:
          removed.length > 0
            ? removeSessionAggregatesFromMaterializedStats(prev.materialized, removed)
            : prev.materialized,
      }
    })
  }

  function syncWithSessionList(sessionIDs: string[]) {
    const known = new Set(sessionIDs)
    const stale: string[] = []
    for (const id of Object.keys(state().aggregates)) {
      if (!known.has(id)) stale.push(id)
    }
    if (stale.length > 0) drop(stale)
  }

  function all(): SessionAggregate[] {
    return Object.values(state().aggregates)
  }

  return {
    ready: () => true,
    /** Reactive read — tracks changes. */
    get store() {
      return state()
    },
    get,
    isStale,
    applyAggregate,
    applyMessages,
    syncWithSessionList,
    all,
  }
}

/** Compact, filesystem/key-safe token derived from a string. Mirrors the
 * exact tokenisation `Persist.server` uses internally so cache entries land
 * at the same localStorage key as before. */
function tokenize(value: string, fallback: string): string {
  const head = (value.slice(0, 18) || fallback).replace(/[^a-zA-Z0-9._-]/g, "-")
  const sum = checksum(value) ?? "0"
  return `${head}.${sum}`
}
