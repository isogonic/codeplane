/**
 * Mobile UI cache — phase 1: version awareness.
 *
 * Mirrors the shape of the desktop's `ui-host` cache (see
 * `packages/desktop/src/main/ui-host.ts`) but persisted through the
 * Capacitor stack instead of Node's `fs`. Each picker entry has an
 * "origin index"-style record that knows:
 *
 *   - the version the user last actually *opened* (`openedVersion`),
 *   - the most recent version the server reported (`remoteVersion`),
 *   - when we last probed (`lastCheckedAt`) and last opened
 *     (`lastOpenedAt`),
 *   - and a derived `state`: `fresh` (matched), `stale` (server moved
 *     past), `checking` (probe in flight), `error` (auth/network), or
 *     `unknown` (never probed).
 *
 * The probe hits `<instance>/global/version` with whatever per-instance
 * auth headers we have in the keychain — same endpoint the desktop's
 * `fetchVersion` uses, same JSON shape (`{ current: "28.0.0" }`). We
 * use `CapacitorHttp` so the request bypasses CORS (the picker's
 * origin is `capacitor://localhost`, the instance is on its own
 * domain — a regular `fetch` would be blocked).
 *
 * What this layer does today:
 *   - Detects when an instance has shipped a new release.
 *   - Surfaces an "Update available" badge in the picker.
 *   - Watches all instances on a 10-minute interval so the badge
 *     keeps up while the picker is open.
 *
 * What it does NOT do yet (deferred to phase 2):
 *   - Download UI assets to the device.
 *   - Serve them locally to the in-app webview.
 *
 * Phase 2 needs a Capacitor URL-scheme handler (Swift/Kotlin) that
 * reads from `Filesystem.Directory.Cache` and forwards remote API
 * calls to the live origin — the same proxy pattern the desktop's
 * local HTTP server already implements. Until that exists the
 * in-app webview keeps loading bytes from the live server (with the
 * WKWebView's own HTTP disk cache + the instance's Service Worker
 * doing the heavy lifting), and this module's job is purely
 * version-aware UX.
 */

import { CapacitorHttp } from "@capacitor/core"
import { mobileHeadersStore } from "./headers-store"
import { mobilePreferences } from "./storage"

const STORAGE_KEY = "cp:ui-cache:v1"
const VERSION_PROBE_TIMEOUT_MS = 10_000
const DEFAULT_WATCH_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
/**
 * `check()` no-ops if the previous probe finished within this window.
 * Stops a re-mount or focus storm from hammering the server. The
 * watcher tick uses its own interval, so this only protects manual
 * `check()` calls (e.g. picker pull-to-refresh fired multiple times).
 */
const FRESH_CHECK_TTL_MS = 60 * 1000

export type UICacheState =
  | "unknown"
  | "checking"
  | "fresh"
  | "stale"
  | "error"

export type UICacheEntry = {
  instanceId: string
  origin?: string
  state: UICacheState
  openedVersion?: string
  remoteVersion?: string
  lastCheckedAt?: number
  lastOpenedAt?: number
  error?: string
}

type Listener = (entry: UICacheEntry) => void
type GlobalListener = (entry: UICacheEntry) => void

const listeners = new Map<string, Set<Listener>>()
/** Listeners that fire for *every* instance's record change. Used by
 *  cross-module consumers like `asset-cache.ts` that need to react to
 *  any stale state, including for instances added after mount. */
const globalListeners = new Set<GlobalListener>()
let watcherTimer: ReturnType<typeof setInterval> | undefined

type State = Record<string, UICacheEntry>

const readState = async (): Promise<State> => {
  const raw = await mobilePreferences.getItem(STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as State
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

const writeState = async (state: State) => {
  await mobilePreferences.setItem(STORAGE_KEY, JSON.stringify(state))
}

const emit = (entry: UICacheEntry) => {
  const set = listeners.get(entry.instanceId)
  if (set) {
    for (const fn of set) {
      try {
        fn(entry)
      } catch {
        // ignore listener errors
      }
    }
  }
  // Global listeners fire for every record change regardless of which
  // instance produced it. `asset-cache` uses this to auto-trigger a
  // download whenever any instance flips to `stale` — including
  // instances added after the picker first mounted.
  for (const fn of globalListeners) {
    try {
      fn(entry)
    } catch {
      // ignore listener errors
    }
  }
}

const baseUrl = (instanceUrl: string) => {
  const url = new URL(instanceUrl)
  url.pathname = "/"
  url.search = ""
  url.hash = ""
  return url
}

const tryOrigin = (url: string) => {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

const safeParseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Result of a version probe.
 *
 * `kind: "ok"` — the server gave us valid JSON with a `current` field;
 *               we know the version.
 * `kind: "auth"` — the probe returned HTML / 401 / 403 / a redirect
 *               chain to a sign-in proxy. The instance is real and
 *               online, but `/global/version` sits behind a sign-in
 *               flow we can't complete from the picker. The desktop
 *               distinguishes this case (`DesktopVersionAuthRequiredError`)
 *               and surfaces a sign-in URL — on mobile the user signs
 *               in by opening the instance, so we just stay quiet.
 * `kind: "error"` — anything else (network, malformed JSON, missing
 *               `current`). Surfaced in the picker as `state: "error"`.
 */
type VersionResult =
  | { kind: "ok"; version: string }
  | { kind: "auth" }
  | { kind: "error"; message: string }

const fetchVersion = async (
  instanceUrl: string,
  authHeaders: Record<string, string>,
): Promise<VersionResult> => {
  const probe = new URL("global/version", baseUrl(instanceUrl)).toString()
  // CapacitorHttp bypasses CORS — picker origin is capacitor://localhost
  // and the instance is its own domain, so a standard `fetch` would be
  // blocked by the same-origin policy.
  let response: { status: number; data: unknown; headers?: Record<string, string> }
  try {
    response = await CapacitorHttp.request({
      method: "GET",
      url: probe,
      headers: {
        accept: "application/json",
        ...authHeaders,
      },
      connectTimeout: VERSION_PROBE_TIMEOUT_MS,
      readTimeout: VERSION_PROBE_TIMEOUT_MS,
    })
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : "Network error",
    }
  }
  // 401/403/redirect-to-sign-in — instance is up, just gated.
  if (response.status === 401 || response.status === 403) {
    return { kind: "auth" }
  }
  if (response.status >= 400) {
    return {
      kind: "error",
      message: `Version probe returned HTTP ${response.status}`,
    }
  }
  // The instance returned 200 with HTML or some non-JSON body — every
  // SSO proxy we've seen (Cloudflare Access, Identity-aware proxies,
  // Auth0 Lock pages) does this. Treat it the same as 401/403.
  const contentType = String(
    response.headers?.["Content-Type"] ?? response.headers?.["content-type"] ?? "",
  ).toLowerCase()
  const looksLikeJson = contentType.includes("json")
  const data: unknown = typeof response.data === "string" ? safeParseJson(response.data) : response.data
  if (!looksLikeJson || !data || typeof data !== "object") {
    return { kind: "auth" }
  }
  const version = (data as { current?: unknown }).current
  if (typeof version !== "string" || !version) {
    return {
      kind: "error",
      message: "Version probe missing `current`",
    }
  }
  return { kind: "ok", version }
}

export type UICacheAPI = {
  /** Lookup-only. Returns null if there's no entry yet. */
  get: (instanceId: string) => Promise<UICacheEntry | null>
  /**
   * Probe `<instance>/global/version` and update the entry. Returns the
   * new entry. Idempotent + rate-limited (`FRESH_CHECK_TTL_MS`); calling
   * twice in a tight loop is a no-op.
   */
  check: (instanceId: string, instanceUrl: string) => Promise<UICacheEntry>
  /**
   * Mark the user as having actually opened the given version, so the
   * `state` flips to `fresh` (or stays `stale` if the server has since
   * moved on). Caller passes whatever version the in-app webview is
   * about to load — usually the most recent `remoteVersion` we have.
   */
  markOpened: (instanceId: string, version: string) => Promise<UICacheEntry>
  /** Subscribe to changes for an instance. */
  subscribe: (instanceId: string, cb: (entry: UICacheEntry) => void) => () => void
  /**
   * Subscribe to changes for *every* instance. Mainly intended for
   * cross-module consumers (e.g. `asset-cache` auto-triggering a
   * download whenever any record flips to `stale`) that need to keep
   * up with instances added after the picker first mounted — a
   * per-id `subscribe` only catches the IDs you knew about at
   * subscription time.
   */
  subscribeAll: (cb: (entry: UICacheEntry) => void) => () => void
  /**
   * Start the periodic watcher (no-op if already running). Pass a
   * provider for the picker's saved instances — the watcher re-asks on
   * each tick so newly-added instances pick up automatically.
   */
  startWatcher: (
    listInstances: () => Promise<{ id: string; url: string }[]>,
    intervalMs?: number,
  ) => () => void
  /** Clear all state for an instance (used on remove). */
  clear: (instanceId: string) => Promise<void>
}

export const uiCache: UICacheAPI = {
  async get(instanceId) {
    const state = await readState()
    return state[instanceId] ?? null
  },

  async check(instanceId, instanceUrl) {
    const state = await readState()
    const previous = state[instanceId]
    if (previous?.lastCheckedAt && Date.now() - previous.lastCheckedAt < FRESH_CHECK_TTL_MS) {
      return previous
    }
    const origin = tryOrigin(instanceUrl)
    const checking: UICacheEntry = {
      ...previous,
      instanceId,
      origin,
      state: "checking",
    }
    state[instanceId] = checking
    await writeState(state)
    emit(checking)
    const headers = await mobileHeadersStore.get(instanceId)
    const result = await fetchVersion(instanceUrl, headers)
    if (result.kind === "ok") {
      const next: UICacheEntry = {
        ...checking,
        remoteVersion: result.version,
        state:
          !checking.openedVersion || checking.openedVersion === result.version ? "fresh" : "stale",
        lastCheckedAt: Date.now(),
        error: undefined,
      }
      state[instanceId] = next
      await writeState(state)
      emit(next)
      return next
    }
    if (result.kind === "auth") {
      // Sign-in required. We don't have the version, but we don't want
      // to surface this as an "error" either — the picker would render
      // a red badge for a perfectly healthy instance the user just
      // hasn't signed into yet. Stay in `unknown` so the row stays
      // quiet; the user signs in by opening the instance and the
      // in-app webview SSO flow does its thing. We DO update
      // `lastCheckedAt` so the rate-limiter is honoured.
      const reset: UICacheEntry = {
        ...checking,
        state: "unknown",
        lastCheckedAt: Date.now(),
        error: undefined,
      }
      state[instanceId] = reset
      await writeState(state)
      emit(reset)
      return reset
    }
    // Genuine error — network, malformed JSON, missing `current`.
    const failure: UICacheEntry = {
      ...checking,
      state: "error",
      lastCheckedAt: Date.now(),
      error: result.message,
    }
    state[instanceId] = failure
    await writeState(state)
    emit(failure)
    return failure
  },

  async markOpened(instanceId, version) {
    const state = await readState()
    const previous = state[instanceId] ?? { instanceId, state: "unknown" as const }
    const next: UICacheEntry = {
      ...previous,
      instanceId,
      openedVersion: version,
      lastOpenedAt: Date.now(),
      state:
        previous.remoteVersion && previous.remoteVersion !== version
          ? "stale"
          : "fresh",
    }
    state[instanceId] = next
    await writeState(state)
    emit(next)
    return next
  },

  subscribe(instanceId, cb) {
    let set = listeners.get(instanceId)
    if (!set) {
      set = new Set()
      listeners.set(instanceId, set)
    }
    set.add(cb)
    return () => {
      set!.delete(cb)
      if (set!.size === 0) listeners.delete(instanceId)
    }
  },

  subscribeAll(cb) {
    globalListeners.add(cb)
    return () => {
      globalListeners.delete(cb)
    }
  },

  startWatcher(listInstances, intervalMs = DEFAULT_WATCH_INTERVAL_MS) {
    const tick = async () => {
      try {
        const list = await listInstances()
        for (const item of list) {
          // fire-and-forget; check() rate-limits internally.
          void uiCache.check(item.id, item.url)
        }
      } catch {
        // Lister failure shouldn't kill the watcher.
      }
    }
    if (watcherTimer) clearInterval(watcherTimer)
    watcherTimer = setInterval(tick, intervalMs)
    void tick() // kick off immediately
    return () => {
      if (watcherTimer) {
        clearInterval(watcherTimer)
        watcherTimer = undefined
      }
    }
  },

  async clear(instanceId) {
    const state = await readState()
    delete state[instanceId]
    await writeState(state)
  },
}
