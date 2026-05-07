/**
 * Mobile asset cache — phase 2a: download every Codeplane UI release to
 * device storage, keyed by `instanceId/version`, so the bytes are
 * available offline even when the user isn't on Wi-Fi.
 *
 * This is the on-disk half of the desktop's `ui-host` pattern (see
 * `packages/desktop/src/main/ui-host.ts` `crawlUI`). The crawl
 * algorithm and regex set are intentionally identical so behaviour is
 * predictable: start from `index.html`, extract every relative asset
 * reference (HTML `src`/`href`, CSS `url(...)`, JS / JSON / SVG /
 * source-map static-string paths), recursively fetch each, and write
 * the bytes under `<Cache>/codeplane-ui/<instanceId>/<version>/<path>`.
 *
 * What this module is responsible for:
 *   - Probing `<instance>/global/version` (delegated to `ui-cache`),
 *   - Downloading every reachable static asset for a given version,
 *   - Persisting bytes via `Filesystem` (`Directory.Cache` so iOS will
 *     evict for us under disk pressure rather than the app being
 *     killed),
 *   - Tracking per-instance metadata (status, total bytes, asset count,
 *     last successful crawl) in Capacitor preferences,
 *   - Pruning older versions when a new one finishes downloading
 *     (we keep ONE version per instance, mirroring the desktop's
 *     `cleanupUnused` logic),
 *   - Reporting progress via a subscribe API so the picker can paint a
 *     "Downloading 14/47 assets…" indicator.
 *
 * What this module is NOT responsible for (yet) — a follow-up phase 2b:
 *   - **Serving** the cached bytes to the in-app webview. That requires
 *     a custom Capacitor plugin that registers a `WKURLSchemeHandler`
 *     before WKWebView creation; until that lands, the in-app webview
 *     keeps loading from the live server (with the WKWebView's own
 *     HTTP disk cache + the instance's Service Worker doing the same
 *     job, just over the network on first launch).
 *
 * The phase split is deliberate: phase 2a is a self-contained, fully
 * working JS-side feature you can verify today (real bytes on disk,
 * progress in the picker, eviction on version bump). Phase 2b (~150
 * lines of Swift + a Capacitor plugin handshake) flips the in-app
 * webview's URL from `https://<instance>` to `codeplane-cache://
 * <instanceId>/`, which the scheme handler then reads back from the
 * exact directory tree this module writes — zero changes to the
 * data layout when 2b lands.
 */

import { CapacitorHttp } from "@capacitor/core"
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem"
import { mobileHeadersStore } from "./headers-store"
import { mobilePreferences } from "./storage"
import { uiCache } from "./ui-cache"

/* ------------------------------------------------------------------ *
 * Crawl-discovery regexes                                            *
 *                                                                    *
 * Copied verbatim from `packages/desktop/src/main/ui-host.ts` so the *
 * mobile crawler discovers exactly the same set of assets the        *
 * desktop downloads. Drift here would silently produce broken caches *
 * (e.g. mobile fetching a stale subset of bundle chunks).            *
 * ------------------------------------------------------------------ */
const STATIC_REF_PATTERN =
  /(?:"|')((?:\/|\.\/|\.\.\/)[^"'?#]+\.(?:avif|css|gif|ico|jpeg|jpg|js|json|mjs|png|svg|ttf|txt|webm|webp|woff|woff2))(?:"|')/g
const HTML_ATTR_PATTERN = /\b(?:src|href)=["']([^"']+)["']/g
const CSS_URL_PATTERN = /url\(([^)]+)\)/g
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt"])

const STATE_KEY = "cp:asset-cache:v1"
const CACHE_ROOT = "codeplane-ui" // under Filesystem.Directory.Cache
const HTTP_CONNECT_TIMEOUT_MS = 30_000
const HTTP_READ_TIMEOUT_MS = 60_000
/**
 * Cap the crawler at this many distinct assets so a misconfigured
 * server (e.g. one that links its own dev-server's source maps,
 * generating an effectively-infinite reference chain) can't fill the
 * device storage. Desktop has the same kind of guard implicitly via
 * its `seen` set, but its crawl is less exposed — mobile cache eats
 * the iOS app sandbox quota.
 */
const MAX_ASSETS_PER_VERSION = 1000

export type AssetCacheStatus =
  | "idle" // never crawled
  | "downloading"
  | "ready"
  | "error"
  | "stale" // ready, but a newer version is on the server

export type AssetCacheRecord = {
  instanceId: string
  origin: string
  /** The version whose bytes are currently on disk. */
  cachedVersion?: string
  /** The version the watcher last saw on the server (mirrors `ui-cache`). */
  remoteVersion?: string
  status: AssetCacheStatus
  fetchedAt?: number
  totalBytes?: number
  assetCount?: number
  /** Last error message, if any. */
  error?: string
}

export type AssetCacheProgress = {
  instanceId: string
  version: string
  phase: "probe" | "download" | "save" | "done" | "error"
  message: string
  completed: number
  total: number
  bytes: number
  /** 0..100 — for direct binding to a progress bar without dividing. */
  percent: number
  cacheHit?: boolean
}

type State = Record<string, AssetCacheRecord>
type Listener = (record: AssetCacheRecord) => void
type ProgressListener = (progress: AssetCacheProgress) => void

const recordListeners = new Map<string, Set<Listener>>()
const progressListeners = new Map<string, Set<ProgressListener>>()
const inFlight = new Map<string, Promise<AssetCacheRecord>>()

/* ------------------------------------------------------------------ *
 * Pure helpers                                                       *
 * ------------------------------------------------------------------ */

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
    return ""
  }
}

const cleanPathname = (raw: string): string => {
  let p = raw.replace(/^\.\.?\//, "")
  if (p.startsWith("/")) p = p.slice(1)
  // Strip query/hash if it sneaks in.
  const q = p.indexOf("?")
  if (q >= 0) p = p.slice(0, q)
  const h = p.indexOf("#")
  if (h >= 0) p = p.slice(0, h)
  return p || "index.html"
}

const extensionOf = (path: string) => {
  const ix = path.lastIndexOf(".")
  return ix >= 0 ? path.slice(ix).toLowerCase() : ""
}

const isTextLike = (path: string) => TEXT_EXTENSIONS.has(extensionOf(path))

const versionRoot = (instanceId: string, version: string) => `${CACHE_ROOT}/${instanceId}/${version}`

/* ------------------------------------------------------------------ *
 * Persistence                                                        *
 * ------------------------------------------------------------------ */

const readState = async (): Promise<State> => {
  const raw = await mobilePreferences.getItem(STATE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as State
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

const writeState = async (state: State) => {
  await mobilePreferences.setItem(STATE_KEY, JSON.stringify(state))
}

const emitRecord = (record: AssetCacheRecord) => {
  const set = recordListeners.get(record.instanceId)
  if (!set) return
  for (const fn of set) {
    try {
      fn(record)
    } catch {
      /* ignore */
    }
  }
}

const emitProgress = (progress: AssetCacheProgress) => {
  const set = progressListeners.get(progress.instanceId)
  if (!set) return
  for (const fn of set) {
    try {
      fn(progress)
    } catch {
      /* ignore */
    }
  }
}

const setRecord = async (record: AssetCacheRecord) => {
  const state = await readState()
  state[record.instanceId] = record
  await writeState(state)
  emitRecord(record)
}

/* ------------------------------------------------------------------ *
 * Filesystem helpers — wrap the Capacitor Filesystem API in promises *
 * that swallow the "not found" errors the `stat`/`rmdir` calls       *
 * throw so callers can stay flat.                                    *
 * ------------------------------------------------------------------ */

const ensureDir = async (path: string) => {
  try {
    await Filesystem.mkdir({ path, directory: Directory.Cache, recursive: true })
  } catch (err) {
    // mkdir on an existing dir throws "Directory exists" — fine.
    const msg = (err as Error)?.message ?? ""
    if (!msg.toLowerCase().includes("exist")) throw err
  }
}

const removeDir = async (path: string) => {
  try {
    await Filesystem.rmdir({ path, directory: Directory.Cache, recursive: true })
  } catch {
    // already gone — ignore
  }
}

const writeBinary = async (path: string, bytes: Uint8Array) => {
  // Capacitor Filesystem expects base64 for binary writes.
  const base64 = base64FromBytes(bytes)
  // Make sure the parent dir exists. Splitting on "/" lets the helper
  // walk arbitrarily-deep paths the crawler emits without us tracking
  // them ourselves.
  const slash = path.lastIndexOf("/")
  if (slash > 0) await ensureDir(path.slice(0, slash))
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: base64,
    recursive: true,
  })
}

const writeText = async (path: string, text: string) => {
  const slash = path.lastIndexOf("/")
  if (slash > 0) await ensureDir(path.slice(0, slash))
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: text,
    encoding: Encoding.UTF8,
    recursive: true,
  })
}

/* ------------------------------------------------------------------ *
 * Base64 encoding                                                    *
 *                                                                    *
 * `btoa(String.fromCharCode(...bytes))` blows the JS call-stack      *
 * apart for >100 KB inputs (and Codeplane's bundle has multi-MB JS   *
 * chunks). Encode in 32 KB slices instead.                           *
 * ------------------------------------------------------------------ */
const base64FromBytes = (bytes: Uint8Array): string => {
  const SLICE = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += SLICE) {
    const chunk = bytes.subarray(i, Math.min(i + SLICE, bytes.length))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

/* ------------------------------------------------------------------ *
 * HTTP                                                                *
 * ------------------------------------------------------------------ */

type FetchedAsset = {
  bytes: Uint8Array
  contentType: string
  /** Final URL after redirects (so we resolve relative refs against
   *  the right base). */
  finalUrl: string
}

const fetchAsset = async (
  url: string,
  authHeaders: Record<string, string>,
): Promise<FetchedAsset | null> => {
  const response = await CapacitorHttp.request({
    method: "GET",
    url,
    headers: { accept: "*/*", ...authHeaders },
    // CapacitorHttp returns binary as a base64 string when responseType
    // is "blob"; "arraybuffer" returns it as an ArrayBuffer in the JS
    // layer. We use blob (more universally supported across plugin
    // versions).
    responseType: "blob",
    connectTimeout: HTTP_CONNECT_TIMEOUT_MS,
    readTimeout: HTTP_READ_TIMEOUT_MS,
  })
  if (response.status >= 400) {
    return null
  }
  const data: unknown = response.data
  const contentType =
    (response.headers && (response.headers["Content-Type"] ?? response.headers["content-type"])) ??
    "application/octet-stream"
  const bytes = bytesFromHttpData(data)
  return {
    bytes,
    contentType: typeof contentType === "string" ? contentType : "application/octet-stream",
    finalUrl: typeof response.url === "string" && response.url ? response.url : url,
  }
}

const bytesFromHttpData = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof data === "string") {
    // Most likely base64 from CapacitorHttp's blob response.
    try {
      const binary = atob(data)
      const out = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
      return out
    } catch {
      // Fall through to UTF-8 encoding below.
    }
    return new TextEncoder().encode(data)
  }
  // Last-ditch: stringify and encode.
  return new TextEncoder().encode(typeof data === "object" && data !== null ? JSON.stringify(data) : String(data))
}

/* ------------------------------------------------------------------ *
 * Reference extraction                                                *
 *                                                                    *
 * Same passes as the desktop, in the same order.                     *
 * ------------------------------------------------------------------ */

const extractReferences = (text: string, sourcePath: string): string[] => {
  const refs = new Set<string>()
  const ext = extensionOf(sourcePath)

  // Static-string refs work for HTML/JS/CSS/JSON/SVG bodies.
  for (const match of text.matchAll(STATIC_REF_PATTERN)) {
    if (match[1]) refs.add(match[1])
  }

  if (ext === ".html") {
    for (const match of text.matchAll(HTML_ATTR_PATTERN)) {
      const ref = match[1]
      if (!ref) continue
      // Skip data:, blob:, javascript:, and absolute URLs to other
      // origins — the desktop crawler does the same.
      if (/^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(ref)) continue
      if (/^https?:\/\//i.test(ref)) continue
      refs.add(ref)
    }
  }

  if (ext === ".css") {
    for (const match of text.matchAll(CSS_URL_PATTERN)) {
      const inner = match[1]?.trim().replace(/^["']|["']$/g, "") ?? ""
      if (!inner) continue
      if (/^(?:data:|blob:)/i.test(inner)) continue
      if (/^https?:\/\//i.test(inner)) continue
      refs.add(inner)
    }
  }

  return Array.from(refs)
}

/* ------------------------------------------------------------------ *
 * Crawl                                                               *
 * ------------------------------------------------------------------ */

const crawl = async (
  instance: { id: string; url: string },
  version: string,
): Promise<AssetCacheRecord> => {
  const origin = tryOrigin(instance.url)
  const root = versionRoot(instance.id, version)
  const headers = await mobileHeadersStore.get(instance.id)

  const queued: string[] = ["/"]
  const seen = new Set<string>()
  const saved = new Set<string>()
  let totalBytes = 0
  let assetCount = 0

  const reportProgress = (
    phase: AssetCacheProgress["phase"],
    message: string,
    completed: number,
    total: number,
  ) => {
    const percent = total === 0 ? 0 : Math.min(100, Math.round((completed / total) * 100))
    emitProgress({
      instanceId: instance.id,
      version,
      phase,
      message,
      completed,
      total,
      bytes: totalBytes,
      percent,
    })
  }

  // Fresh start — wipe any half-written state for this version.
  await removeDir(root)
  await ensureDir(root)

  reportProgress("download", "Starting download…", 0, 1)

  while (queued.length > 0) {
    const next = queued.shift() as string
    const path = cleanPathname(next)
    if (seen.has(path)) continue
    seen.add(path)

    if (saved.size >= MAX_ASSETS_PER_VERSION) {
      throw new Error(`Crawler hit the ${MAX_ASSETS_PER_VERSION}-asset cap; aborting.`)
    }

    const url = new URL(path === "index.html" && next === "/" ? "/" : `/${path}`, baseUrl(instance.url))
    const asset = await fetchAsset(url.toString(), headers).catch(() => null)
    if (!asset) {
      // Non-2xx for a referenced asset isn't fatal — desktop also
      // tolerates this (the asset might be a feature-flag-gated
      // resource that legitimately 404s for this user).
      continue
    }

    const targetPath = `${root}/${path}`
    if (isTextLike(path)) {
      const text = new TextDecoder().decode(asset.bytes)
      await writeText(targetPath, text)
      // Recurse into the body for more refs.
      for (const ref of extractReferences(text, path)) {
        const nextPath = cleanPathname(ref.startsWith("/") ? ref : path.split("/").slice(0, -1).concat(ref).join("/"))
        if (!seen.has(nextPath)) queued.push(nextPath)
      }
    } else {
      await writeBinary(targetPath, asset.bytes)
    }

    saved.add(path)
    totalBytes += asset.bytes.byteLength
    assetCount += 1
    reportProgress(
      "download",
      `Downloaded ${path} (${formatBytes(asset.bytes.byteLength)})`,
      assetCount,
      assetCount + queued.length,
    )
  }

  if (assetCount === 0) {
    throw new Error("Crawl produced no files — the server returned nothing useful for /.")
  }

  // Write a tiny manifest so phase 2b's WKURLSchemeHandler can find
  // the entry HTML and content-type-by-extension table without
  // re-running the regex extraction.
  const manifest = {
    instanceId: instance.id,
    origin,
    version,
    fetchedAt: Date.now(),
    assetCount,
    totalBytes,
  }
  await writeText(`${root}/_manifest.json`, JSON.stringify(manifest, null, 2))

  reportProgress("save", "Saving manifest…", assetCount, assetCount)

  const record: AssetCacheRecord = {
    instanceId: instance.id,
    origin,
    cachedVersion: version,
    remoteVersion: version,
    status: "ready",
    fetchedAt: manifest.fetchedAt,
    totalBytes,
    assetCount,
  }
  await setRecord(record)

  // Evict any older versions for this instance so we keep the
  // sandbox bounded — same model as the desktop's cleanup pass.
  await pruneOtherVersions(instance.id, version)

  reportProgress("done", `Cached ${assetCount} files (${formatBytes(totalBytes)})`, assetCount, assetCount)
  return record
}

const pruneOtherVersions = async (instanceId: string, keepVersion: string) => {
  try {
    const result = await Filesystem.readdir({
      path: `${CACHE_ROOT}/${instanceId}`,
      directory: Directory.Cache,
    })
    const folders = (result.files ?? []).filter((f) => f.type === "directory" && f.name !== keepVersion)
    for (const folder of folders) {
      await removeDir(`${CACHE_ROOT}/${instanceId}/${folder.name}`)
    }
  } catch {
    // No prior versions — ignore.
  }
}

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/* ------------------------------------------------------------------ *
 * Public API                                                         *
 * ------------------------------------------------------------------ */

export type AssetCacheAPI = {
  /** Lookup-only. Returns null if there's no entry yet. */
  get: (instanceId: string) => Promise<AssetCacheRecord | null>
  /**
   * Download every reachable static asset for the given version.
   * Returns the record once the crawl finishes. Concurrent calls for
   * the same instance share the same Promise.
   */
  download: (instance: { id: string; url: string }, version: string) => Promise<AssetCacheRecord>
  /** Remove every cached version for this instance. */
  clear: (instanceId: string) => Promise<void>
  /** Total bytes cached across all instances. */
  totalBytes: () => Promise<number>
  /**
   * Subscribe to record changes (status, version, byte counts) for
   * one instance.
   */
  subscribeRecord: (instanceId: string, cb: Listener) => () => void
  /**
   * Subscribe to fine-grained download progress for one instance.
   * Fires multiple times during a single `download()` call.
   */
  subscribeProgress: (instanceId: string, cb: ProgressListener) => () => void
  /**
   * Path under `Filesystem.Directory.Cache` that the WKURLSchemeHandler
   * (phase 2b) reads from. Exposed so the native plugin can resolve
   * the same root the JS side writes to.
   */
  rootPath: (instanceId: string, version: string) => string
  /**
   * Hook the auto-crawl up to the picker's instance store. Called
   * once at app boot from `createCodeplaneMobile()` with a resolver
   * that looks up the live URL for an instanceId — we need this so
   * the auto-crawl, which is triggered by `ui-cache` events
   * (instanceId only), can build the full crawl URL. Calling this
   * twice is idempotent: the previous global subscription is torn
   * down before the new one is wired.
   */
  bindAutoCrawl: (resolveInstance: (instanceId: string) => Promise<{ id: string; url: string } | null>) => void
}

export const assetCache: AssetCacheAPI = {
  async get(instanceId) {
    const state = await readState()
    return state[instanceId] ?? null
  },

  async download(instance, version) {
    const key = `${instance.id}:${version}`
    const existing = inFlight.get(key)
    if (existing) return existing
    const promise = (async () => {
      // Mark as downloading immediately so subscribers (the picker)
      // can paint a progress bar before the first asset finishes.
      const previous = (await readState())[instance.id]
      const downloading: AssetCacheRecord = {
        instanceId: instance.id,
        origin: tryOrigin(instance.url),
        cachedVersion: previous?.cachedVersion,
        remoteVersion: version,
        status: "downloading",
        fetchedAt: previous?.fetchedAt,
        totalBytes: previous?.totalBytes,
        assetCount: previous?.assetCount,
      }
      await setRecord(downloading)
      try {
        return await crawl(instance, version)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const failed: AssetCacheRecord = {
          ...downloading,
          status: "error",
          error: message,
        }
        await setRecord(failed)
        emitProgress({
          instanceId: instance.id,
          version,
          phase: "error",
          message,
          completed: 0,
          total: 0,
          bytes: 0,
          percent: 0,
        })
        throw err
      } finally {
        inFlight.delete(key)
      }
    })()
    inFlight.set(key, promise)
    return promise
  },

  async clear(instanceId) {
    await removeDir(`${CACHE_ROOT}/${instanceId}`)
    const state = await readState()
    delete state[instanceId]
    await writeState(state)
    // Drop in-flight too — if a crawl was running it's now writing
    // into a deleted directory which will error on its next mkdir
    // anyway. Removing from `inFlight` lets the next manual download
    // start fresh.
    for (const key of Array.from(inFlight.keys())) {
      if (key.startsWith(`${instanceId}:`)) inFlight.delete(key)
    }
  },

  async totalBytes() {
    const state = await readState()
    return Object.values(state).reduce((sum, r) => sum + (r.totalBytes ?? 0), 0)
  },

  subscribeRecord(instanceId, cb) {
    let set = recordListeners.get(instanceId)
    if (!set) {
      set = new Set()
      recordListeners.set(instanceId, set)
    }
    set.add(cb)
    return () => {
      set!.delete(cb)
      if (set!.size === 0) recordListeners.delete(instanceId)
    }
  },

  subscribeProgress(instanceId, cb) {
    let set = progressListeners.get(instanceId)
    if (!set) {
      set = new Set()
      progressListeners.set(instanceId, set)
    }
    set.add(cb)
    return () => {
      set!.delete(cb)
      if (set!.size === 0) progressListeners.delete(instanceId)
    }
  },

  rootPath(instanceId, version) {
    return versionRoot(instanceId, version)
  },

  bindAutoCrawl(resolveInstance) {
    // Tear down the previous global subscription so re-binding (e.g.
    // hot module reload during dev) doesn't stack listeners.
    if (autoCrawlOff) {
      autoCrawlOff()
      autoCrawlOff = undefined
    }
    autoCrawlOff = uiCache.subscribeAll((entry) => {
      // We only react to `stale` records that name a remote version —
      // anything else is either info-only (`fresh`/`unknown`/`checking`)
      // or a probe failure we can't recover from at this layer
      // (`error`).
      if (entry.state !== "stale" || !entry.remoteVersion) return
      // De-dup per (instance, version): the watcher tick fires every
      // 10 minutes and re-emits the same record on each pass.
      const key = `${entry.instanceId}:${entry.remoteVersion}`
      if (autoCrawlSeen.has(key)) return
      autoCrawlSeen.add(key)
      void resolveInstance(entry.instanceId)
        .then((instance) => {
          if (!instance) return
          return assetCache.download(instance, entry.remoteVersion as string)
        })
        .catch(() => {
          // `download()` already records the error onto the asset
          // record; nothing else to do here. Drop the dedup key so
          // a manual retry still works.
          autoCrawlSeen.delete(key)
        })
    })
  },
}

/* ------------------------------------------------------------------ *
 * Auto-crawl bookkeeping                                             *
 *                                                                    *
 * Module-scoped so `bindAutoCrawl` is idempotent on hot reload.      *
 * ------------------------------------------------------------------ */
let autoCrawlOff: (() => void) | undefined
const autoCrawlSeen = new Set<string>()

export const formatCacheBytes = formatBytes
