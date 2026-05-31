import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  screen,
  session,
  shell,
  dialog,
  systemPreferences,
  type MessageBoxOptions,
  type NativeImage,
  type Session,
  type WebContents,
} from "electron"
import Store from "electron-store"
import { CodeplaneHome } from "@codeplane-ai/shared/home"
import {
  fetchCodeplaneVersions,
  readPreferredLocalVersion,
  writePreferredLocalVersion,
} from "@codeplane-ai/shared/local-runtime"
import { createInstanceStore, type State as InstanceStoreState } from "@codeplane-ai/shared/instance-store"
import {
  clearInstanceCache as clearRuntimeInstanceCache,
  getInstanceCacheInfo as getRuntimeInstanceCacheInfo,
  type InstanceCacheInfo,
} from "@codeplane-ai/shared/instance-cache"
import { createServerVersionWatcher, type ServerVersionWatcher } from "@codeplane-ai/shared/server-version-watcher"
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { execFile, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"
import os from "node:os"
import path from "path"
import { pathToFileURL } from "url"

const execFileAsync = promisify(execFile)
import { createDesktopLogger } from "./log"
import {
  createDesktopUIHost,
  DesktopVersionAuthRequiredError,
  type DesktopHostInstance,
  type DesktopUIPrepareProgress,
} from "./ui-host"
import { createDesktopMcpOAuthManager } from "./mcp-auth"
import {
  showDesktopNotification as showDesktopNotificationBridge,
  type DesktopNotificationPayload,
} from "./notification-bridge"
import {
  hasWindowPosition,
  normalizeWindowBoundsForRestore,
  type DesktopWindowBounds,
} from "./window-bounds"
import { createLocalInstanceManager, type LocalInstanceProgress } from "./local-instance"
import {
  type DesktopComputerCapture,
  type DesktopComputerDisplay,
  desktopComputerNeedsAccessibility,
  performDesktopComputer,
  type DesktopComputerInput,
} from "./computer-bridge"
import { reconnectOverlayScript } from "./reconnect-overlay"
import { codeplaneDesktopReleaseTag, codeplaneReleaseTag, CodeplaneVersion } from "@codeplane-ai/shared/version"
import type { SavedInstance } from "@codeplane-ai/shared/instance"

/**
 * Codeplane desktop shell.
 *
 * The desktop app bundles no backend. It is a thin Electron wrapper that
 * always starts on the instance picker, downloads the matching web UI for
 * the selected server version into a local cache, and serves that UI from
 * a local host for fast subsequent launches.
 *
 * Users can additionally configure per-instance auth headers (e.g. CF
 * Access service tokens, internal API keys) that get attached to every
 * outbound request to that instance via the session's webRequest API.
 *
 * The desktop shell never embeds the backend. Local runtime install/update
 * flows are driven through the shared npm package pipeline so desktop and
 * TUI launch the same platform package from the same Codeplane home.
 */

// Linux portable builds (AppImage, tar.gz) can't carry a setuid-root
// chrome-sandbox helper, and on distros that restrict unprivileged user
// namespaces (Ubuntu 24.04+ via AppArmor) the namespace sandbox fails too, so
// Electron aborts before any window appears. The .deb installs under
// /opt/Codeplane and makes chrome-sandbox setuid in its postinstall, so it
// keeps the Chromium sandbox; every other Linux launch (AppImage sets
// process.env.APPIMAGE; tar.gz runs from an arbitrary dir) disables the
// sandbox so the app still starts. Must run before app `ready`.
if (process.platform === "linux") {
  const managedInstall = process.execPath.startsWith("/opt/Codeplane/")
  if (process.env.APPIMAGE || !managedInstall) {
    app.commandLine.appendSwitch("no-sandbox")
  }
}

const SESSION_PARTITION_PREFIX = "persist:codeplane:"
const HEADER_PREFIX_BLOCKED = ["host", "origin", "referer", "user-agent", "content-length"]
const GITHUB_API_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "codeplane-desktop-updater",
}
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" }

let githubTokenCache: { token: string | null; resolvedAt: number } | undefined
const GITHUB_TOKEN_TTL_MS = 5 * 60 * 1000
const desktopBridgeToken = randomUUID()
const DESKTOP_CAPTURE_MAX_EDGE = 6144

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  }
}

async function readJsonBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : "{}"
  return JSON.parse(raw) as Record<string, unknown>
}

async function resolveGithubToken(): Promise<string | null> {
  if (githubTokenCache && Date.now() - githubTokenCache.resolvedAt < GITHUB_TOKEN_TTL_MS) {
    return githubTokenCache.token
  }
  const fromEnv = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (fromEnv) {
    githubTokenCache = { token: fromEnv, resolvedAt: Date.now() }
    return fromEnv
  }
  const candidates = [
    async () => {
      const { stdout } = await execFileAsync("gh", ["auth", "token"], { timeout: 4000 })
      return stdout.trim() || null
    },
    async () => {
      const { stdout } = await execFileAsync(
        "git",
        ["credential", "fill"],
        {
          timeout: 4000,
          input: "protocol=https\nhost=github.com\n\n",
        } as Parameters<typeof execFileAsync>[2] & { input?: string },
      )
      const match = /^password=(.+)$/m.exec(stdout)
      return match?.[1]?.trim() || null
    },
  ]
  for (const candidate of candidates) {
    try {
      const value = await candidate()
      if (value) {
        githubTokenCache = { token: value, resolvedAt: Date.now() }
        return value
      }
    } catch {
      // try the next strategy
    }
  }
  githubTokenCache = { token: null, resolvedAt: Date.now() }
  return null
}

async function githubApiHeaders(): Promise<Record<string, string>> {
  const token = await resolveGithubToken()
  if (!token) return { ...GITHUB_API_HEADERS }
  return { ...GITHUB_API_HEADERS, authorization: `Bearer ${token}` }
}
const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/isogonic/codeplane/releases"
const DESKTOP_STORAGE_DIRECT = "__direct__"
const APP_ID = "cc.codeplane.desktop"
const APP_NAME = "Codeplane"
const APP_COPYRIGHT = "Copyright © 2026 Devin Oldenburg"
const APP_WEBSITE = "https://codeplane.cc"
const USER_DATA_OVERRIDE = process.env.CODEPLANE_DESKTOP_USER_DATA_DIR?.trim()
const LEGACY_USER_DATA_NAME = "@codeplane-ai/desktop"
if (USER_DATA_OVERRIDE && !process.env.CODEPLANE_HOME_DIR) process.env.CODEPLANE_HOME_DIR = USER_DATA_OVERRIDE
const codeplaneHome = CodeplaneHome.paths()
const defaultUserData = path.join(codeplaneHome.root, "desktop")
const legacyUserData = path.join(app.getPath("appData"), LEGACY_USER_DATA_NAME)

if (USER_DATA_OVERRIDE) {
  app.setPath("userData", USER_DATA_OVERRIDE)
}
if (!USER_DATA_OVERRIDE) app.setPath("userData", defaultUserData)

type DesktopPersist = Record<string, Record<string, string>>

type Schema = {
  instances?: SavedInstance[]
  lastInstanceId?: string
  persist?: DesktopPersist
  windowBounds?: DesktopWindowBounds
}

type GitHubRelease = {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
  name?: string | null
  body?: string | null
  html_url?: string | null
  published_at?: string | null
  assets?: Array<{
    name: string
    browser_download_url: string
    size: number
    content_type: string
  }>
}

const store = new Store<Schema>({
  name: "codeplane-desktop",
  defaults: {
    instances: [],
  },
})
const legacyStore =
  legacyUserData !== app.getPath("userData") && existsSync(path.join(legacyUserData, "codeplane-desktop.json"))
    ? new Store<Schema>({
        cwd: legacyUserData,
        name: "codeplane-desktop",
        defaults: {
          instances: [],
        },
      })
    : undefined
const instanceStore = createInstanceStore(codeplaneHome.instances)
// Logs land at `<codeplaneHome>/log/desktop/desktop.log` (e.g.
// ~/Library/Application Support/Codeplane/log/desktop/ on macOS) so they
// sit next to the rest of Codeplane's per-surface log streams instead of
// being buried inside Electron's userData (which gets wiped when the app
// uninstalls and is co-mingled with browser caches). The legacy
// `<userData>/logs/desktop.log` location is kept as a fallback when the
// new path isn't writable, so existing tail/grep flows still work after
// upgrade. CODEPLANE_DESKTOP_LOG_DIR overrides both for tests.
const logger = createDesktopLogger(
  process.env.CODEPLANE_DESKTOP_LOG_DIR?.trim() || path.join(codeplaneHome.log, "desktop"),
)

// Electron's SimpleURLLoaderWrapper (backing session.fetch / net.fetch) can
// surface transient transport failures — most commonly net::ERR_HTTP2_PROTOCOL_ERROR
// when an upstream HTTP/2 stream resets mid-body — as 'error' events that the
// caller's Promise has already settled past. Without process-level handlers
// these escape as Electron's "Uncaught Exception" dialog, even though the next
// poll/fetch recovers cleanly. Log and swallow instead of crashing the shell.
const isTransientNetError = (value: unknown): boolean => {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : ""
  return /^net::ERR_/.test(message)
}
process.on("uncaughtException", (error) => {
  logger.log("main", isTransientNetError(error) ? "process.uncaught.net" : "process.uncaught", { error })
})
process.on("unhandledRejection", (reason) => {
  logger.log("main", isTransientNetError(reason) ? "process.unhandled.net" : "process.unhandled", { reason })
})

let mainWindow: BrowserWindow | undefined
let currentInstanceID: string | undefined
let instanceState: InstanceStoreState = { instances: [] }
const configuredPartitions = new Set<string>()
const mcpOAuthManager = createDesktopMcpOAuthManager({
  BrowserWindow: BrowserWindow as unknown as new (options?: any) => BrowserWindow,
  log: (event, data) => logger.log("main", event, data),
})
// Per-window watcher: started after the window first reaches a server's
// `current` version, stopped on window-close, version-bump, or reconnect.
// Keyed by window id so multiple instance windows don't share state.
const windowVersionWatchers = new Map<number, ServerVersionWatcher>()
const windowReconnecting = new Set<number>()
const uiHost = createDesktopUIHost({
  cacheDir: app.getPath("userData"),
  getInstance: getInstanceLive,
  getSession: ensureSession,
  ensureReady: async (instance) => {
    const saved = getInstance(instance.id)
    if (!saved?.local) return instance
    return ensureLocalRunning(saved)
  },
  handleInternalRequest: async (request, reqUrl) => {
    if (reqUrl.pathname !== "/__desktop/computer") return

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed." }, 405)
    }

    const providedToken = request.headers["x-codeplane-bridge-token"]
    const token = Array.isArray(providedToken) ? providedToken[0] : providedToken
    if (token !== desktopBridgeToken) {
      logger.log("ui-host", "computer.bridge.unauthorized", { pathname: reqUrl.pathname })
      return jsonResponse({ ok: false, error: "Unauthorized desktop bridge request." }, 403)
    }

    let params: DesktopComputerInput
    try {
      params = (await readJsonBody(request)) as DesktopComputerInput
    } catch (error) {
      logger.log("ui-host", "computer.bridge.invalid-json", { error })
      return jsonResponse({ ok: false, error: "Invalid computer tool payload." }, 400)
    }

    try {
      if (process.platform === "darwin") {
        if (desktopComputerNeedsAccessibility(params) && !(await checkMacOSAccessibility())) {
          logger.log("ui-host", "computer.bridge.accessibility-uncertain", {
            note: "Permission API reports denied — attempting action anyway",
          })
        }
        if (!(await checkMacOSScreenRecording())) {
          logger.log("ui-host", "computer.bridge.screen-recording-uncertain", {
            note: "Permission API reports denied — trying the Electron capture path before failing.",
          })
        }
      }

      const result = await performDesktopComputer(params, {
        captureScreen: process.platform === "darwin" ? captureElectronScreen : undefined,
      })
      logger.log("ui-host", "computer.bridge.success", {
        action: params.action,
        count: result.actions.length,
        height: result.screenshot.height,
        width: result.screenshot.width,
      })
      return jsonResponse({ ok: true, ...result })
    } catch (error) {
      // The probe is best-effort: re-check after the failure so the user gets
      // a precise list rather than a generic "blocked" message. The cache is
      // intentionally not cleared here — we want to see the same view the
      // pre-flight saw so we don't gaslight the user.
      const missing = process.platform === "darwin" ? await missingMacOSComputerPermissions(params) : []
      if (missing.length > 0 || (process.platform === "darwin" && isMacOSComputerPermissionError(error))) {
        logger.log("ui-host", "computer.bridge.permissions-missing", { error, missing })
        const detail = missing.length > 0 ? ` (${missing.join(", ")})` : ""
        const hint =
          " Open Desktop Settings -> General -> Computer use to grant access. After enabling each permission, fully quit and reopen Codeplane Desktop."
        return jsonResponse(
          {
            ok: false,
            error: `macOS blocked Computer use${detail}.${hint}`,
          },
          403,
        )
      }
      logger.log("ui-host", "computer.bridge.error", { error })
      return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
    }
  },
  log: (event, data) => logger.log("ui-host", event, data),
})
const localManager = createLocalInstanceManager({
  binariesDir: codeplaneHome.local_server_binaries,
  configDir: codeplaneHome.root,
  dataDir: codeplaneHome.local_server,
  log: (event, data) => logger.log("local-instance", event, data),
  debugLogging: () => desktopDebugLoggingEnabled(),
  extraEnv: async () => ({
    CODEPLANE_DESKTOP_BRIDGE_ORIGIN: await uiHost.origin(),
    CODEPLANE_DESKTOP_BRIDGE_TOKEN: desktopBridgeToken,
  }),
  // The desktop owns the lifecycle of the local runtime spawned by
  // the desktop. Tells the spawned server's Installation.method() to
  // return "desktop" so /global/upgrade short-circuits with the
  // "use the desktop's Updates panel" message instead of attempting
  // an npm install.
  desktopManaged: true,
})

type DesktopCombinedCacheArea = InstanceCacheInfo["areas"][number] | {
  key: "desktop-ui"
  label: string
  path: string
  bytes: number
}

type DesktopCombinedCacheInfo = Omit<InstanceCacheInfo, "areas"> & {
  areas: DesktopCombinedCacheArea[]
  desktopUI: {
    bytes: number
    exists: boolean
    versions: string[]
  }
}

function combineCacheInfo(runtime: InstanceCacheInfo, desktopUI: Awaited<ReturnType<typeof uiHost.cacheInfo>>): DesktopCombinedCacheInfo {
  const desktopArea =
    desktopUI.exists && desktopUI.bytes > 0
      ? [
          {
            key: "desktop-ui" as const,
            label: "Desktop UI cache",
            path: path.join(app.getPath("userData"), "ui-cache"),
            bytes: desktopUI.bytes,
          },
        ]
      : []
  const areas = [...runtime.areas, ...desktopArea]
  return {
    areas,
    bytes: areas.reduce((sum, area) => sum + area.bytes, 0),
    desktopUI: {
      bytes: desktopUI.bytes,
      exists: desktopUI.exists,
      versions: desktopUI.versions,
    },
    exists: areas.length > 0,
  }
}

async function getDesktopInstanceCacheInfo(instance: SavedInstance): Promise<DesktopCombinedCacheInfo> {
  const [runtime, desktopUI] = await Promise.all([
    getRuntimeInstanceCacheInfo(instance.id),
    uiHost.cacheInfo(instance),
  ])
  return combineCacheInfo(runtime, desktopUI)
}

async function clearDesktopInstanceCache(instance: SavedInstance): Promise<DesktopCombinedCacheInfo> {
  const before = await getDesktopInstanceCacheInfo(instance)
  if (instance.local) await localManager.stop(instance.id).catch((error) => logger.log("main", "instances.cache.stop-error", { error, id: instance.id }))
  const ses = ensureSession(instance)
  await Promise.all([
    clearRuntimeInstanceCache(instance.id).catch((error) => {
      logger.log("main", "instances.cache.runtime-error", { error, id: instance.id })
      throw error
    }),
    uiHost.clearCache(instance).catch((error) => {
      logger.log("main", "instances.cache.ui-error", { error, id: instance.id })
      throw error
    }),
    ses.clearCache().catch((error) => logger.log("main", "instances.cache.browser-error", { error, id: instance.id })),
  ])
  return before
}

async function clearRendererHttpCache(
  ses: Session,
  instance: SavedInstance | DesktopHostInstance,
  reason: string,
) {
  // `ses.clearCache()` clears the HTTP cache, but leaves:
  //   - ServiceWorker registrations (web app doesn't register one today,
  //     but a stale registration from a previous build version would
  //     intercept asset fetches and serve old code anyway)
  //   - CacheStorage entries (used by the standard SW caching API, same
  //     concern)
  //   - GPU/shader caches (mostly cosmetic, but a stale one can wedge the
  //     renderer after a major Electron version bump)
  // We wipe all three on every server-upgrade reconnect so the new UI
  // bundle is what actually executes. The renderer's HTTP cache + the
  // session storages here together cover every layer Electron has cached
  // between the desktop and the local server. Without these, a server
  // upgrade leaves the renderer running yesterday's JS bundle ("desktop
  // doesn't upgrade on update" user report, addressed v29.0.22).
  await Promise.all([
    ses
      .clearCache()
      .then(() => logger.log("main", "window.cache.clear.success", { id: instance.id, reason }))
      .catch((error) => logger.log("main", "window.cache.clear.error", { error, id: instance.id, reason })),
    ses
      .clearStorageData({ storages: ["serviceworkers", "cachestorage", "shadercache"] })
      .then(() =>
        logger.log("main", "window.storage.clear.success", {
          id: instance.id,
          reason,
          storages: ["serviceworkers", "cachestorage", "shadercache"],
        }),
      )
      .catch((error) => logger.log("main", "window.storage.clear.error", { error, id: instance.id, reason })),
    // `clearCodeCaches({ urls: [] })` clears the V8 bytecode cache for
    // every origin — the desired behavior on upgrade so we re-parse the
    // new JS bundle from scratch instead of replaying stale bytecode
    // that targeted the old bundle's source. Per Electron's docs, an
    // empty `urls` array is the "clear all" sentinel.
    ses
      .clearCodeCaches({ urls: [] })
      .then(() => logger.log("main", "window.codecache.clear.success", { id: instance.id, reason }))
      .catch((error) => logger.log("main", "window.codecache.clear.error", { error, id: instance.id, reason })),
  ])
}

app.setName(APP_NAME)
app.setAppUserModelId(APP_ID)
logger.log("main", "bootstrap", {
  appName: APP_NAME,
  codeplaneRoot: codeplaneHome.root,
  cwd: process.cwd(),
  logPath: logger.path(),
  logDir: logger.dir(),
  errorsPath: logger.errorsPath(),
  userData: app.getPath("userData"),
})
// Mirror both log paths to stderr so users running the bundled app from
// a terminal (or attached to the packaged binary's console) can find
// them without first having to find a log entry that reveals it.
// errors.log is append-only/forever-deduped, desktop.log is the rotating
// full-fidelity tail.
// eslint-disable-next-line no-console -- intentional one-time bootstrap announcement
console.error(`[codeplane-desktop] logging to ${logger.path()} (errors: ${logger.errorsPath()})`)

function savedInstances() {
  return instanceState.instances
}

function lastInstanceID() {
  return instanceState.lastInstanceID
}

async function setLastInstanceID(id: string | undefined) {
  await instanceStore.setLast(id)
  instanceState = {
    instances: instanceState.instances,
    lastInstanceID: id,
  }
  return id
}

async function syncInstanceState() {
  instanceState = await instanceStore.getState()
  return instanceState
}

async function migrateInstanceState(source: Store<Schema> | undefined) {
  if (!source) return false
  const next = {
    instances: source.get("instances") ?? [],
    lastInstanceID: source.get("lastInstanceId"),
  }
  if (next.instances.length === 0 && !next.lastInstanceID) return false
  instanceState = await instanceStore.replace(next)
  source.delete("instances")
  source.delete("lastInstanceId")
  return true
}

async function loadInstanceState() {
  instanceState = await instanceStore.getState()
  if (instanceState.instances.length > 0 || instanceState.lastInstanceID) return instanceState
  if (await migrateInstanceState(store)) return instanceState
  await migrateInstanceState(legacyStore)
  return instanceState
}

function getInstance(id: string | undefined): SavedInstance | undefined {
  if (!id) return undefined
  return savedInstances().find((entry) => entry.id === id)
}

function desktopStorageName(name?: string) {
  return name || DESKTOP_STORAGE_DIRECT
}

function desktopPersistState(): DesktopPersist {
  return store.get("persist") ?? {}
}

function readDesktopStorage(name: string | undefined, key: string) {
  const value = desktopPersistState()[desktopStorageName(name)]?.[key]
  return typeof value === "string" ? value : null
}

function readDesktopSettings() {
  const raw = readDesktopStorage(undefined, "settings.v3")
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
  } catch (error) {
    logger.log("main", "settings.read-error", { error })
  }
  return {}
}

function desktopDebugLoggingEnabled() {
  const general = readDesktopSettings().general
  return !!general && typeof general === "object" && (general as Record<string, unknown>).debugLogging === true
}

function writeDesktopStorage(name: string | undefined, key: string, value: string) {
  const persist = { ...desktopPersistState() }
  const storageName = desktopStorageName(name)
  persist[storageName] = { ...(persist[storageName] ?? {}), [key]: value }
  store.set("persist", persist)
}

function removeDesktopStorage(name: string | undefined, key: string) {
  const persist = { ...desktopPersistState() }
  const storageName = desktopStorageName(name)
  if (!persist[storageName] || !(key in persist[storageName])) return
  const next = { ...persist[storageName] }
  delete next[key]
  if (Object.keys(next).length > 0) {
    persist[storageName] = next
  } else {
    delete persist[storageName]
  }
  if (Object.keys(persist).length > 0) {
    store.set("persist", persist)
    return
  }
  store.delete("persist")
}

// For local instances, the persisted URL is a placeholder. Whenever the
// binary is running, swap in the live `http://127.0.0.1:<port>` so the
// proxy / UI host / probe code paths stay URL-driven.
function getInstanceLive(id: string | undefined): SavedInstance | undefined {
  const instance = getInstance(id)
  if (!instance) return undefined
  if (!instance.local) return instance
  const running = localManager.getRunning(instance.id)
  if (!running) return instance
  return { ...instance, url: running.url }
}

async function ensureLocalRunning(
  instance: SavedInstance,
  onProgress?: (progress: LocalInstanceProgress) => void,
): Promise<SavedInstance> {
  if (!instance.local) return instance
  const version = instance.local.binaryVersion || (await readPreferredLocalVersion())
  const running = await localManager.start(
    {
      id: instance.id,
      binaryVersion: version,
    },
    onProgress,
  )
  return { ...instance, local: { binaryVersion: version }, url: running.url }
}

async function openLocalInstanceLogDir(id: string) {
  const instance = getInstance(id)
  if (!instance?.local) return false
  const dir = localManager.logDir(id)
  mkdirSync(dir, { recursive: true })
  const error = await shell.openPath(dir)
  if (error) throw new Error(error)
  return true
}

function instanceSummary(instance: SavedInstance | DesktopHostInstance) {
  const local = (instance as SavedInstance).local
  return {
    id: instance.id,
    url: instance.url,
    label: instance.label,
    hasHeaders: !!instance.headers && Object.keys(instance.headers).length > 0,
    ignoreCertificateErrors: !!instance.ignoreCertificateErrors,
    clientCertConfigured: !!instance.clientCertSubject,
    local: local ? { binaryVersion: local.binaryVersion } : undefined,
  }
}

function mockUpdaterMode() {
  return process.env.CODEPLANE_DESKTOP_TEST_UPDATE?.trim()
}

function mockUpdateStatus() {
  const mode = mockUpdaterMode()
  if (!mode) return
  if (mode === "latest") {
    return {
      current: CodeplaneVersion,
      latest: CodeplaneVersion,
      hasUpdate: false,
      method: "npm-mock",
    }
  }
  if (mode.startsWith("available:")) {
    const latest = mode.slice("available:".length) || CodeplaneVersion
    return {
      current: CodeplaneVersion,
      latest,
      hasUpdate: compareVersions(latest, CodeplaneVersion) > 0,
      method: "npm-mock",
    }
  }
}

function mockUpdateCheckResult() {
  const mode = mockUpdaterMode()
  if (!mode) return
  if (mode === "latest") {
    return { ok: true as const, updateAvailable: false }
  }
  if (mode.startsWith("available:")) {
    const version = mode.slice("available:".length) || CodeplaneVersion
    return { ok: true as const, updateAvailable: true, version }
  }
  if (mode.startsWith("error:")) {
    return { ok: false as const, error: mode.slice("error:".length) || "Mock update failure" }
  }
}

function activeWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  return mainWindow
}

function currentWindowBounds(window: BrowserWindow): DesktopWindowBounds {
  return { ...window.getBounds(), maximized: window.isMaximized() }
}

function focusWindow(window?: BrowserWindow) {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  app.focus()
  window.focus()
}

function notificationWindow(sender: WebContents) {
  const window = BrowserWindow.fromWebContents(sender)
  if (window && !window.isDestroyed()) return window
  return activeWindow()
}

async function routeNotificationClick(sender: WebContents, href?: string) {
  const window = notificationWindow(sender)
  if (window) {
    focusWindow(window)
    if (href) window.webContents.send("notifications:click", href)
    return
  }
  const instance = getInstanceLive(currentInstanceID)
  if (instance) {
    const opened = await openInstance(instance)
    if (opened && href) activeWindow()?.webContents.send("notifications:click", href)
    return
  }
  showSetupWindow()
}

function desktopNotificationIcon() {
  const icon = iconPath()
  if (!icon) return
  const image = nativeImage.createFromPath(icon)
  if (image.isEmpty()) return
  return image
}

async function showDesktopNotification(sender: WebContents, payload: DesktopNotificationPayload) {
  const result = await showDesktopNotificationBridge<NativeImage>(payload, {
    create: (options) =>
      new Notification({
        title: options.title,
        body: options.body,
        icon: options.icon,
      }),
    icon: desktopNotificationIcon,
    isSupported: () => Notification.isSupported(),
    log: (event, data) => logger.log("main", event, data),
    routeClick: (href) => routeNotificationClick(sender, href),
    testMode: process.env.CODEPLANE_DESKTOP_TEST_NOTIFICATIONS === "1",
  })
  return result.shown
}

function showMessageBox(options: MessageBoxOptions) {
  const window = activeWindow()
  if (window) return dialog.showMessageBox(window, options)
  return dialog.showMessageBox(options)
}

function ensureSession(instance: SavedInstance): Session {
  const partition = `${SESSION_PARTITION_PREFIX}${instance.id}`
  const ses = session.fromPartition(partition, { cache: true })
  if (configuredPartitions.has(partition)) return ses
  configuredPartitions.add(partition)

  // Inject per-instance auth headers (CF Access, bearer tokens, …) on all
  // outbound HTTP requests for this session. We never overwrite headers the
  // page itself already set, and we skip browser-managed headers so we don't
  // break CORS/credentials behaviour.
  //
  // The closure deliberately re-reads the instance from the store on every
  // request — Electron only lets us register one `onBeforeSendHeaders` per
  // session, but the instance config (headers, ignoreCertificateErrors,
  // url) can be edited from the setup window any time. Pinning the original
  // `instance` argument would freeze stale headers into the session.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    const live = getInstance(instance.id) ?? instance
    const target = asUrl(live.url)
    const current = target ? asUrl(details.url) : undefined
    const targetPath = target?.pathname.replace(/\/+$/, "") || "/"
    const matchesTarget =
      !!target &&
      !!current &&
      current.origin === target.origin &&
      (current.pathname === targetPath || current.pathname.startsWith(`${targetPath === "/" ? "" : targetPath}/`))
    if (live.headers) {
      for (const [name, value] of Object.entries(live.headers)) {
        if (!name) continue
        if (HEADER_PREFIX_BLOCKED.some((blocked) => name.toLowerCase() === blocked)) continue
        if (headers[name] !== undefined) continue
        if (!matchesTarget && details.url !== target?.toString()) continue
        headers[name] = value
      }
    }
    callback({ requestHeaders: headers })
  })

  // When the instance origin returns 401 / 403 on the document load — the
  // server's HTTP Basic Auth rejected our headers — bounce the user back to
  // the Loader with an "auth-required" toast so they can re-edit the saved
  // headers (or supply the right --password). Subresource 401s are
  // intentionally ignored; only the main HTML response triggers the bounce.
  ses.webRequest.onCompleted((details) => {
    if (details.statusCode !== 401 && details.statusCode !== 403) return
    if (details.resourceType !== "mainFrame") return
    const live = getInstance(instance.id) ?? instance
    const target = asUrl(live.url)
    const completed = asUrl(details.url)
    if (!target || !completed) return
    if (completed.origin !== target.origin) return
    // The session is bound to the main window via the per-instance partition,
    // so the main window is the right surface to bounce. Fall back to any
    // open window if for some reason the main one is gone.
    const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0]
    if (!targetWindow || targetWindow.isDestroyed()) return
    logger.log("main", "instance.auth-required.bounce-to-setup", {
      instanceID: live.id,
      instanceLabel: live.label,
      status: details.statusCode,
      url: details.url,
    })
    showSetup(targetWindow, {
      error: {
        kind: "auth-required",
        message: `Server returned HTTP ${details.statusCode} — credentials missing or invalid.`,
        instanceID: live.id,
        instanceLabel: live.label,
      },
    })
  })

  // mTLS / client certificate selection — flexible, not tied to any one
  // identity provider. Looks up the cert by the subject CN the user
  // recorded in setup; macOS Keychain / Windows Cert Store / NSS DB on
  // Linux supplies the private key.
  //
  // Like `onBeforeSendHeaders` above, re-read the saved instance for every
  // call so toggling "Trust self-signed TLS certificates" in setup takes
  // effect on the next request without having to restart the app.
  ses.setCertificateVerifyProc((_request, callback) => {
    const live = getInstance(instance.id) ?? instance
    if (live.ignoreCertificateErrors) {
      callback(0)
      return
    }
    callback(-3)
  })

  // Wire up `navigator.mediaDevices.getDisplayMedia` so the in-app screenshot
  // button works. Without this handler Electron denies every request, which
  // surfaces as a generic "Screenshot fehlgeschlagen" toast in the renderer.
  // `useSystemPicker` lets macOS 15+ show its native ScreenCaptureKit picker
  // (window/screen/area). On older macOS, Windows, and Linux Electron falls
  // back to invoking the handler, where we capture the primary screen — the
  // user explicitly clicked the screenshot button, so consent is unambiguous.
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => {
          const source = sources[0]
          if (!source) {
            callback({})
            return
          }
          callback({ video: source })
        })
        .catch(() => callback({}))
    },
    { useSystemPicker: true },
  )

  return ses
}

function asUrl(input: string): URL | undefined {
  try {
    const trimmed = input.trim()
    if (!trimmed) return undefined
    const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    return new URL(withScheme)
  } catch {
    return undefined
  }
}

// Open the embedded, session-scoped OAuth window for a single MCP server.
// Triggered by the renderer's "Authorize" button (via the mcp:authorize IPC) —
// the desktop no longer opens any OAuth window automatically on instance load.
async function openInstanceMcpOAuth(
  instance: SavedInstance,
  launch: { name: string; authorizationUrl: string; redirectUri: string },
) {
  const ses = ensureSession(instance)
  await mcpOAuthManager.open(instance, ses, launch)
}

function getAppAssetPath(...parts: string[]) {
  return path.join(app.getAppPath(), ...parts)
}

function iconPath() {
  return [getAppAssetPath("build", "icon.png"), path.join(process.cwd(), "build", "icon.png")].find(existsSync)
}

function applyRuntimeIcon() {
  // Let packaged macOS builds keep using the bundle's `.icns` icon.
  // Overriding the Dock tile at runtime with the generated PNG makes the
  // running app icon render slightly differently from the closed app icon.
  if (process.platform === "darwin" && app.isPackaged) {
    logger.log("main", "icon.runtime-override.skipped", { reason: "bundle-icns-on-macos" })
    return
  }
  const icon = iconPath()
  if (!icon) return
  const image = nativeImage.createFromPath(icon)
  if (image.isEmpty()) return
  logger.log("main", "icon.applied", { icon })
  if (process.platform === "darwin") app.dock?.setIcon(image)
}

function applyRuntimeMetadata() {
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: APP_COPYRIGHT,
    version: app.getVersion(),
    website: APP_WEBSITE,
  })
}

function attachWindowDebugLogging(window: BrowserWindow, name: string) {
  logger.log("window", "created", { id: window.id, name })
  window.on("close", () => logger.log("window", "close", { id: window.id, name }))
  window.on("closed", () => logger.log("window", "closed", { id: window.id, name }))
  window.on("unresponsive", () => logger.log("window", "unresponsive", { id: window.id, name }))
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    logger.log("window.console", "message", {
      id: window.id,
      level,
      line,
      sourceId,
      message,
      name,
      url: window.webContents.getURL(),
    })
  })
  window.webContents.on("did-finish-load", () => {
    logger.log("window", "did-finish-load", {
      id: window.id,
      name,
      title: window.getTitle(),
      url: window.webContents.getURL(),
    })
  })
  window.webContents.on(
    "did-fail-load",
    (_event, code, description, validatedURL, isMainFrame, frameProcessId, frameRoutingId) => {
      logger.log("window", "did-fail-load", {
        code,
        current: window.webContents.getURL(),
        description,
        frameProcessId,
        frameRoutingId,
        id: window.id,
        isMainFrame,
        name,
        validatedURL,
      })
      // -3 (ABORTED) means the load was intentionally cancelled (e.g. we
      // navigated to a new URL before the previous load finished). Don't
      // treat that as an instance failure.
      if (code === -3) return
      if (!isMainFrame) return
      const failed = asUrl(validatedURL)
      // The setup HTML is a file:// URL — if that fails, we can't bounce to
      // anywhere useful, so just log.
      if (!failed || (failed.protocol !== "http:" && failed.protocol !== "https:")) return
      // Only bounce when the failed URL is the *current instance's* origin
      // (matching the same heuristic the version watcher uses). Cross-origin
      // failures during OAuth or external links should not yank the user
      // back to the loader.
      const inst = currentInstanceID ? getInstance(currentInstanceID) : undefined
      const instOrigin = inst ? asUrl(inst.url)?.origin : undefined
      if (instOrigin && failed.origin !== instOrigin) return
      const message = description || `Connection failed (${code})`
      logger.log("main", "instance.unreachable.bounce-to-setup", {
        code,
        description,
        instanceID: inst?.id,
        instanceLabel: inst?.label,
        validatedURL,
        windowId: window.id,
      })
      showSetup(window, {
        error: {
          kind: classifyLoadFailure(code),
          message,
          instanceID: inst?.id,
          instanceLabel: inst?.label,
        },
      })
    },
  )
  window.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    logger.log("window", "did-navigate-in-page", { id: window.id, isMainFrame, name, url })
  })
  window.webContents.on("render-process-gone", (_event, details) => {
    logger.log("window", "render-process-gone", { details, id: window.id, name })
  })
}

// Reasons the Loader can be opened with. Each translates to a renderer-side
// toast in packages/desktop/src/setup/app.tsx (which reads ?error= /
// ?errorMessage= / ?errorInstanceId= query params on mount).
type SetupErrorKind = "unreachable" | "auth-required" | "server-error" | "version-error" | "unknown-error"

// Map Chromium's net error codes to a user-facing kind. Full list:
// https://chromium.googlesource.com/chromium/src/+/master/net/base/net_error_list.h
function classifyLoadFailure(code: number): SetupErrorKind {
  // -7 (TIMED_OUT), -21 (NETWORK_CHANGED), -100..-108 (CONNECTION_*),
  // -109 (ADDRESS_UNREACHABLE), -118 (CONNECTION_TIMED_OUT),
  // -300 (INVALID_URL), -301 (DISALLOWED_URL_SCHEME) all manifest as
  // "the instance is unreachable" from the user's perspective.
  if (code === -2 || code === -7 || code === -21) return "unreachable"
  if (code <= -100 && code >= -125) return "unreachable"
  if (code >= -310 && code <= -300) return "unreachable"
  if (code === -201 || code === -202) return "auth-required" // ERR_CERT_*; treat as needs-attention
  return "server-error"
}
function showSetup(
  window: BrowserWindow,
  opts?: {
    editId?: string
    error?: { kind: SetupErrorKind; message?: string; instanceID?: string; instanceLabel?: string }
  },
) {
  const url = pathToFileURL(getAppAssetPath("dist", "setup", "index.html"))
  if (opts?.editId) {
    url.searchParams.set("edit", opts.editId)
  }
  if (opts?.error) {
    url.searchParams.set("error", opts.error.kind)
    if (opts.error.message) url.searchParams.set("errorMessage", opts.error.message)
    if (opts.error.instanceID) url.searchParams.set("errorInstanceId", opts.error.instanceID)
    if (opts.error.instanceLabel) url.searchParams.set("errorInstanceLabel", opts.error.instanceLabel)
  }
  logger.log("main", "setup.show", {
    editId: opts?.editId,
    error: opts?.error,
    url: url.toString(),
    windowId: window.id,
  })
  void window.loadURL(url.toString())
}

function compareVersions(a: string, b: string) {
  const left = a
    .trim()
    .replace(/^v/, "")
    .split(".")
    .map((value) => Number.parseInt(value, 10))
    .map((value) => (Number.isFinite(value) ? value : 0))
  const right = b
    .trim()
    .replace(/^v/, "")
    .split(".")
    .map((value) => Number.parseInt(value, 10))
    .map((value) => (Number.isFinite(value) ? value : 0))
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const next = (left[i] ?? 0) - (right[i] ?? 0)
    if (next !== 0) return next
  }
  return 0
}

function broadcastUpdater(channel: string, payload?: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(channel, payload)
  }
}

function getDesktopArch(): "arm64" | "x64" {
  return process.arch === "arm64" ? "arm64" : "x64"
}

function getDesktopPlatformLabel(): "mac" | "win" | "linux" {
  if (process.platform === "darwin") return "mac"
  if (process.platform === "win32") return "win"
  return "linux"
}

function getDesktopAssetExtension(): "zip" | "tar.gz" {
  return process.platform === "linux" ? "tar.gz" : "zip"
}

function desktopReleaseDownloadUrl(version: string) {
  return `https://github.com/isogonic/codeplane/releases/tag/${codeplaneDesktopReleaseTag(version)}`
}

// Latest desktop shell version reported by the GitHub release check. Cached so
// the status IPC can answer instantly between checks.
let desktopShellLatestVersion: string | undefined
let desktopShellUpdateInFlight: Promise<{ current: string; latest: string | null; hasUpdate: boolean }> | undefined
let desktopShellDownloadInFlight: Promise<{ assetUrl: string; destDir: string; extractedAppPath: string }> | undefined
let desktopShellStagedUpdate: { destDir: string; extractedAppPath: string } | undefined

async function fetchLatestDesktopRelease(): Promise<GitHubRelease | null> {
  const response = await fetch(`${GITHUB_RELEASES_API_URL}?per_page=30`, {
    headers: await githubApiHeaders(),
  })
  if (!response.ok) {
    throw new Error(`GitHub releases lookup failed with HTTP ${response.status}`)
  }
  const releases = (await response.json()) as GitHubRelease[]
  for (const release of releases) {
    if (release.draft || release.prerelease) continue
    if (!release.tag_name?.endsWith("-desktop")) continue
    return release
  }
  return null
}

function getDesktopAppInstallPath(): string {
  if (process.platform === "darwin") {
    const exe = app.getPath("exe")
    // exe is at Codeplane.app/Contents/MacOS/Codeplane → walk up to .app bundle
    return path.resolve(exe, "..", "..", "..")
  }
  // Windows: exe is at Codeplane/Codeplane.exe → use parent dir
  // Linux: exe is at Codeplane/codeplane → use parent dir
  return path.dirname(app.getPath("exe"))
}

function matchDesktopReleaseAsset(release: GitHubRelease): {
  url: string
  name: string
  size: number
} | null {
  if (!release.assets) return null
  const platform = getDesktopPlatformLabel()
  const arch = getDesktopArch()
  const ext = getDesktopAssetExtension()
  const version = release.tag_name!.replace(/^v/, "").replace(/-desktop$/, "")
  // macOS/Windows: codeplane-desktop-{version}-{platform}-{arch}.zip
  // Linux: codeplane-desktop-{version}-{platform}-{arch}.tar.gz
  const pattern = `codeplane-desktop-${version}-${platform}-${arch}.${ext}`
  for (const asset of release.assets) {
    if (asset.name === pattern) {
      return { url: asset.browser_download_url, name: asset.name, size: asset.size }
    }
  }
  // Try query matching for edge-cases (e.g. URL-encoded names)
  for (const asset of release.assets) {
    if (asset.name.includes(`-${platform}-${arch}`) && asset.name.endsWith(`.${ext}`)) {
      return { url: asset.browser_download_url, name: asset.name, size: asset.size }
    }
  }
  return null
}

async function downloadReleaseAsset(
  assetUrl: string,
  destPath: string,
  onProgress?: (percent: number, transferred: number, total: number) => void,
): Promise<void> {
  const headers = await githubApiHeaders()
  const response = await fetch(assetUrl, { headers, redirect: "follow" })
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`)
  }
  const total = Number.parseInt(response.headers.get("content-length") ?? "0", 10)
  if (!response.body) {
    throw new Error("Response has no body")
  }
  const reader = response.body.getReader()
  const file = createWriteStream(destPath)
  let transferred = 0
  let lastPercent = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      transferred += value.byteLength
      file.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
      if (total > 0) {
        const percent = Math.round((transferred / total) * 100)
        if (percent !== lastPercent) {
          lastPercent = percent
          onProgress?.(percent, transferred, total)
        }
      }
    }
  } finally {
    reader.releaseLock()
    file.end()
  }
  await new Promise<void>((resolve, reject) => {
    file.on("finish", resolve)
    file.on("error", reject)
  })
  if (total > 0) onProgress?.(100, transferred, total)
}

async function extractAsset(
  archivePath: string,
  destDir: string,
): Promise<void> {
  if (process.platform === "linux") {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destDir])
    return
  }
  if (process.platform === "win32") {
    // Windows has no `unzip` on PATH (spawn unzip ENOENT broke auto-update);
    // bsdtar ships as tar.exe on Windows 10+ and extracts .zip archives.
    await execFileAsync("tar", ["-xf", archivePath, "-C", destDir])
    return
  }
  await execFileAsync("unzip", ["-o", archivePath, "-d", destDir])
}

function getExtractedAppPath(destDir: string): string | null {
  if (process.platform === "darwin") {
    // electron-builder puts Codeplane.app at the root of the zip
    const direct = path.join(destDir, "Codeplane.app")
    if (existsSync(direct)) return direct
    // Fallback: search for .app bundle
    const entries = readdirSync(destDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith(".app")) return path.join(destDir, entry.name)
    }
    return null
  }
  // Windows: electron-builder zip contains a single subdirectory with the app
  // Linux: tar.gz may also have a subdirectory
  const entries = readdirSync(destDir, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory())
  // If only one directory, use it (electron-builder wraps in e.g. win-unpacked/)
  if (dirs.length === 1) return path.join(destDir, dirs[0].name)
  // If the app exe is directly in destDir, use destDir
  const exeName = process.platform === "win32" ? "Codeplane.exe" : "codeplane"
  if (existsSync(path.join(destDir, exeName))) return destDir
  return null
}

function createSwapScript(): string {
  if (process.platform === "darwin") {
    return `#!/bin/bash
PID=$1
OLD_APP="$2"
NEW_APP="$3"
while kill -0 $PID 2>/dev/null; do sleep 0.3; done
sleep 0.5
rm -rf "$OLD_APP"
mv "$NEW_APP" "$OLD_APP"
open "$OLD_APP" --args --updated
`
  }
  if (process.platform === "win32") {
    return `@echo off
set PID=%1
set "OLD_DIR=%~2"
set "NEW_DIR=%~3"
:wait
timeout /t 1 /nobreak >nul
tasklist /FI "PID eq %PID%" 2>nul | find /I "%PID%" >nul
if %errorlevel%==0 goto wait
timeout /t 1 /nobreak >nul
rmdir /s /q "%OLD_DIR%" 2>nul
move /Y "%NEW_DIR%" "%OLD_DIR%"
start "" "%OLD_DIR%\\Codeplane.exe" --updated
`
  }
  return `#!/bin/bash
PID=$1
OLD_DIR="$2"
NEW_DIR="$3"
while kill -0 $PID 2>/dev/null; do sleep 0.3; done
sleep 0.5
rm -rf "$OLD_DIR"
mv "$NEW_DIR" "$OLD_DIR"
chmod +x "$OLD_DIR/codeplane"
"$OLD_DIR/codeplane" --updated &
`
}

function stageSwapScript(): string {
  const ext = process.platform === "win32" ? ".bat" : ".sh"
  const stagedPath = path.join(os.tmpdir(), `codeplane-swap-${process.pid}${ext}`)
  writeFileSync(stagedPath, createSwapScript(), { mode: process.platform !== "win32" ? 0o755 : undefined })
  return stagedPath
}

async function shellUpdateStatus() {
  const current = app.getVersion()
  if (!app.isPackaged) {
    return { current, latest: current, hasUpdate: false, method: "dev" as const }
  }
  if (!desktopShellUpdateInFlight) {
    desktopShellUpdateInFlight = (async () => {
      try {
        const release = await fetchLatestDesktopRelease()
        const version = release?.tag_name ? release.tag_name.replace(/^v/, "").replace(/-desktop$/, "") : null
        if (version) desktopShellLatestVersion = version
        return {
          current,
          latest: version,
          hasUpdate: !!version && compareVersions(version, current) > 0,
        }
      } finally {
        desktopShellUpdateInFlight = undefined
      }
    })()
  }
  const result = await desktopShellUpdateInFlight
  return { ...result, method: "github" as const }
}

async function getDesktopUpdateStatus() {
  const mocked = mockUpdateStatus()
  if (mocked) return mocked
  return shellUpdateStatus()
}

async function getDesktopReleaseNotes(version: string) {
  const response = await fetch(`${GITHUB_RELEASES_API_URL}/tags/${codeplaneReleaseTag(version)}`, {
    headers: await githubApiHeaders(),
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`GitHub release notes lookup failed with HTTP ${response.status}`)
  }
  const release = (await response.json()) as GitHubRelease
  if (!release.tag_name) return null
  return {
    tag: release.tag_name,
    name: release.name ?? null,
    body: release.body ?? null,
    url: release.html_url ?? null,
    publishedAt: release.published_at ?? null,
  }
}

async function runRuntimeUpdateCheck(input?: { announce?: boolean }) {
  const mocked = mockUpdateCheckResult()
  if (mocked) {
    if (!mocked.ok) broadcastUpdater("updater:error", mocked.error)
    if (mocked.ok && mocked.updateAvailable && mocked.version) broadcastUpdater("updater:update-available", { version: mocked.version })
    if (mocked.ok && !mocked.updateAvailable) broadcastUpdater("updater:update-not-available", { version: CodeplaneVersion })
    return mocked
  }

  if (!app.isPackaged) {
    const message = "Desktop auto-update is only available in packaged builds."
    logger.log("main", "updater.skipped.unpacked", { message })
    return { ok: false as const, error: message }
  }

  try {
    const status = await shellUpdateStatus()
    if (status.hasUpdate && status.latest) {
      logger.log("main", "updater.update-available", status)
      broadcastUpdater("updater:update-available", { version: status.latest })
      if (input?.announce) {
        const result = await showMessageBox({
          type: "info",
          buttons: ["Install update", "Later"],
          defaultId: 0,
          cancelId: 1,
          message: `Codeplane Desktop ${status.latest} is available`,
          detail: `Current desktop version: ${status.current}\nLatest release: ${status.latest}\n\nThe app will restart automatically once the update is downloaded.`,
        })
        if (result.response === 0) return installShellUpdate(status.latest)
      }
      return { ok: true as const, updateAvailable: true, version: status.latest }
    }

    logger.log("main", "updater.update-not-available", status)
    broadcastUpdater("updater:update-not-available", { version: status.current })
    if (input?.announce) {
      await showMessageBox({
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        message: `Codeplane Desktop ${status.current} is up to date`,
        detail: "The desktop app is already on the latest released version.",
      })
    }
    return { ok: true as const, updateAvailable: false, version: status.current }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.log("main", "updater.error", { error: message })
    broadcastUpdater("updater:error", message)
    if (input?.announce) {
      await showMessageBox({
        type: "error",
        buttons: ["OK"],
        defaultId: 0,
        message: "Codeplane update check failed",
        detail: message,
      })
    }
    return { ok: false as const, error: message }
  }
}

async function installShellUpdate(version: string) {
  const mocked = mockUpdaterMode()
  if (mocked) {
    logger.log("main", "updater.download.mock", { version })
    broadcastUpdater("updater:download-progress", { percent: 100, transferred: 0, total: 0 })
    broadcastUpdater("updater:update-downloaded", { version })
    return { ok: true as const, mocked: true }
  }

  if (!app.isPackaged) {
    const message = "Desktop auto-update is only available in packaged builds."
    logger.log("main", "updater.skipped.unpacked", { message, version })
    broadcastUpdater("updater:error", message)
    return { ok: false as const, error: message }
  }

  logger.log("main", "updater.download.start", { version })
  desktopShellLatestVersion = version

  try {
    if (!desktopShellDownloadInFlight) {
      desktopShellDownloadInFlight = (async () => {
        const release = await fetchLatestDesktopRelease()
        if (!release) throw new Error("No desktop release found")
        const asset = matchDesktopReleaseAsset(release)
        if (!asset) throw new Error(`No matching asset found for ${getDesktopPlatformLabel()}/${getDesktopArch()}`)
        const updateDirPrefix = path.join(app.getPath("temp"), `codeplane-update-${version}-`)
        const updateDir = mkdtempSync(updateDirPrefix)
        const archiveExt = getDesktopAssetExtension()
        const archivePath = path.join(updateDir, `update.${archiveExt}`)
        logger.log("main", "updater.download.fetch", { url: asset.url, size: asset.size })
        await downloadReleaseAsset(asset.url, archivePath, (percent, transferred, total) => {
          broadcastUpdater("updater:download-progress", { percent, transferred, total })
        })
        logger.log("main", "updater.download.extracting", { archivePath, updateDir })
        await extractAsset(archivePath, updateDir)
        const extractedAppPath = getExtractedAppPath(updateDir)
        if (!extractedAppPath || !existsSync(extractedAppPath)) {
          throw new Error(`Extracted app not found in ${updateDir}`)
        }
        return { assetUrl: asset.url, destDir: updateDir, extractedAppPath }
      })()
    }
    const { destDir, extractedAppPath } = await desktopShellDownloadInFlight
    desktopShellDownloadInFlight = undefined
    desktopShellStagedUpdate = { destDir, extractedAppPath }
    broadcastUpdater("updater:update-downloaded", { version })
    // Give the renderer a moment to show "Restarting" state, then swap+relaunch
    setTimeout(() => quitAndInstallShellUpdate("download-complete"), 1_500)
    return { ok: true as const }
  } catch (error) {
    desktopShellDownloadInFlight = undefined
    desktopShellStagedUpdate = undefined
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.log("main", "updater.download.error", { error: errorMessage })
    broadcastUpdater("updater:error", errorMessage)
    return { ok: false as const, error: errorMessage }
  }
}

function attachWindowHandlers(window: BrowserWindow) {
  // Open external links in the user's default browser. This makes OAuth
  // popups, "open docs" buttons, etc. behave like a real native app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (asUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: "deny" }
  })

  // For navigation away from the configured instance origin, also defer
  // to the system browser so SSO popups / IdP redirects can finish there
  // and drop the user back to the app via cookies.
  window.webContents.on("will-navigate", (event, urlString) => {
    const target = asUrl(urlString)
    const current = asUrl(window.webContents.getURL())
    if (!target || !current) return
    // Same origin or our own setup file — let it through.
    if (target.origin === current.origin) return
    if (target.protocol === "file:") return
    // Allow the configured instance origin even if we're currently on a
    // different page (e.g. mid-OAuth). Look it up by any saved instance.
    const instances = savedInstances()
    const match = instances.find((item) => {
      const u = asUrl(item.url)
      return u && u.origin === target.origin
    })
    if (match) return
    event.preventDefault()
    void shell.openExternal(urlString)
  })

  // Persist raw Electron bounds. Do not clamp to a display; macOS secondary
  // monitors can legitimately use negative or far-out coordinates.
  //
  // saveBounds is debounced because `resize` and `move` fire on every
  // frame during a drag (~60-120 Hz on macOS), and each call synchronously
  // serializes the entire desktop persist blob and writeFileSync's it to
  // disk via electron-store. That blocks the main process — which on
  // macOS also drives window compositing — and is the dominant cause of
  // the "drag is laggy / behind" feel users reported. Coalesce to one
  // write per ~250 ms instead. Maximize/unmaximize fire once each so
  // they can persist immediately.
  let saveBoundsTimer: NodeJS.Timeout | undefined
  const scheduleSaveBounds = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
    saveBoundsTimer = setTimeout(() => {
      saveBoundsTimer = undefined
      saveBounds()
    }, 250)
    saveBoundsTimer.unref()
  }
  window.on("resize", scheduleSaveBounds)
  window.on("move", scheduleSaveBounds)
  window.on("maximize", saveBounds)
  window.on("unmaximize", saveBounds)
  // Always flush on close — a user dragging the window then immediately
  // quitting must still have their bounds saved.
  window.on("close", () => {
    if (saveBoundsTimer) {
      clearTimeout(saveBoundsTimer)
      saveBoundsTimer = undefined
    }
    saveBounds()
  })

  // Forward macOS-relevant window state to the renderer so CSS can react —
  // fullscreen hides traffic lights (drop the 88px reserved gutter) and
  // focus blur lets us dim the chrome the way native apps do.
  const sendWindowState = () => {
    if (window.isDestroyed()) return
    window.webContents.send("window:state", {
      fullscreen: window.isFullScreen(),
      focused: window.isFocused(),
      maximized: window.isMaximized(),
    })
  }
  window.on("enter-full-screen", sendWindowState)
  window.on("leave-full-screen", sendWindowState)
  window.on("focus", sendWindowState)
  window.on("blur", sendWindowState)
  window.on("maximize", sendWindowState)
  window.on("unmaximize", sendWindowState)
  window.webContents.once("did-finish-load", sendWindowState)

  function saveBounds() {
    if (!window || window.isDestroyed()) return
    if (window.isFullScreen()) return
    store.set("windowBounds", currentWindowBounds(window))
  }
}

function buildMenu(reload: () => void, openSetup: () => void, openInstanceSwitcher: () => void) {
  const isMac = process.platform === "darwin"
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Switch instance…",
                accelerator: "CmdOrCtrl+Shift+I",
                click: openInstanceSwitcher,
              },
              {
                label: "Add or edit instance…",
                accelerator: "CmdOrCtrl+Shift+,",
                click: openSetup,
              },
              {
                label: "Check for updates…",
                click: () => {
                  void runRuntimeUpdateCheck({ announce: true })
                },
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Switch instance…",
          accelerator: "CmdOrCtrl+Shift+I",
          click: openInstanceSwitcher,
        },
        {
          label: "Add or edit instance…",
          accelerator: "CmdOrCtrl+Shift+,",
          click: openSetup,
        },
        { type: "separator" as const },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: reload },
        ...(isMac ? [] : [{ role: "quit" as const }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" as const }, { role: "zoom" as const }, { role: "close" as const }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Codeplane on GitHub",
          click: () => void shell.openExternal("https://github.com/isogonic/codeplane"),
        },
        {
          label: "Check for updates…",
          click: () => {
            void runRuntimeUpdateCheck({ announce: true })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindowOptions(ses?: Session, savedBounds?: DesktopWindowBounds) {
  const bounds = normalizeWindowBoundsForRestore(savedBounds ?? store.get("windowBounds"))
  const isMac = process.platform === "darwin"
  return {
    ...(hasWindowPosition(bounds) ? { x: bounds.x, y: bounds.y } : {}),
    width: bounds.width,
    height: bounds.height,
    minWidth: 800,
    minHeight: 480,
    // Keep the shell opaque so the setup and reconnect screens never show
    // wallpaper through the window while a server is connecting or upgrading.
    backgroundColor: "#0e0e0e",
    show: false,
    icon: iconPath(),
    titleBarStyle: isMac ? "hiddenInset" : "default",
    // Align the traffic light cluster vertically with our 44px titlebar so
    // the close/min/zoom dots sit centered against the toolbar contents.
    ...(isMac ? { trafficLightPosition: { x: 18, y: 14 } } : {}),
    roundedCorners: true,
    webPreferences: {
      preload: getAppAssetPath("dist", "main", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      // The web app never sees Node, but persistent session storage (cookies,
      // indexedDB) is allowed so logins survive restarts.
      nodeIntegration: false,
      ...(ses ? { session: ses } : {}),
    },
  } satisfies ConstructorParameters<typeof BrowserWindow>[0]
}

function createWindow(editId?: string, savedBounds = store.get("windowBounds")) {
  currentInstanceID = undefined
  const window = new BrowserWindow(createWindowOptions(undefined, savedBounds))
  attachWindowDebugLogging(window, "setup")
  window.once("ready-to-show", () => focusWindow(window))
  attachWindowHandlers(window)
  if (savedBounds?.maximized) window.maximize()
  showSetup(window, editId ? { editId } : undefined)
  mainWindow = window
  return window
}

function loadWindowUrl(window: BrowserWindow, url: string) {
  return new Promise<void>((resolve, reject) => {
    let done = false
    const cleanup = () => {
      window.webContents.removeListener("did-fail-load", fail)
      window.webContents.removeListener("did-finish-load", finish)
    }
    const finish = () => {
      if (done) return
      done = true
      cleanup()
      logger.log("main", "window.load.success", { url, windowId: window.id })
      resolve()
    }
    const fail = (
      _event: Electron.Event,
      code: number,
      description: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => {
      if (done || !isMainFrame || validatedURL !== url) return
      queueMicrotask(() => {
        if (done) return
        if (!window.isDestroyed() && window.webContents.getURL()) {
          finish()
          return
        }
        done = true
        cleanup()
        logger.log("main", "window.load.fail", {
          code,
          description,
          url,
          validatedURL,
          windowId: window.id,
        })
        reject(new Error(`${description} (${code}) loading '${validatedURL}'`))
      })
    }
    window.webContents.once("did-finish-load", finish)
    window.webContents.on("did-fail-load", fail)
    void window.loadURL(url).catch((error) => {
      queueMicrotask(() => {
        if (done) return
        if (!window.isDestroyed() && window.webContents.getURL()) {
          finish()
          return
        }
        done = true
        cleanup()
        logger.log("main", "window.load.reject", { error, url, windowId: window.id })
        reject(error)
      })
    })
  })
}

// Watches the per-instance window after we've sent the user to a sign-in URL
// and re-runs `uiHost.prepare(...)` once they're authenticated. We listen for
// every navigation/load event AND poll on a fixed interval — many auth flows
// (CF Access cdn-cgi/access/callback, OAuth code exchanges, fetch-driven
// SPAs) finish without firing `did-navigate` to the instance origin, so the
// poll is the load-bearing path. The first call that succeeds wins; the
// others are short-circuited by the `inflight`/`closed` flags.
//
// Works for any remote instance, not just CF Access — anything where the
// session ends up holding a cookie/token that lets `/global/version` return
// JSON will resolve through the same path.
function attachInteractiveBootstrap(
  window: BrowserWindow,
  instance: SavedInstance,
  opts?: { progressTo?: WebContents },
) {
  let closed = false
  let inflight: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  const currentOrigin = asUrl(instance.url)?.origin

  const liveInstance = () => getInstance(instance.id) ?? instance

  const emit = (payload: Record<string, unknown>) => {
    const wc = opts?.progressTo
    if (!wc || wc.isDestroyed()) return
    wc.send("instances:open-progress", { instanceID: instance.id, ...payload })
  }

  const cleanup = () => {
    closed = true
    if (timer) clearTimeout(timer)
    timer = undefined
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
    window.webContents.removeListener("did-finish-load", onLoad)
    window.webContents.removeListener("did-navigate", onNavigate)
    window.webContents.removeListener("did-navigate-in-page", onNavigateInPage)
    window.removeListener("closed", cleanup)
  }

  const attempt = () => {
    if (closed || inflight || window.isDestroyed()) return
    const target = liveInstance()
    inflight = uiHost
      .prepare(target, (progress: DesktopUIPrepareProgress) => {
        logger.log("main", "instance.bootstrap.progress", { ...progress, id: target.id })
        emit(progress)
      })
      .then(async (prepared) => {
        logger.log("main", "instance.bootstrap.ready", { prepared, ...instanceSummary(target) })
        cleanup()
        currentInstanceID = target.id
        emit({ phase: "done", message: "Loading…", percent: 100, version: prepared.version })
        await clearRendererHttpCache(ensureSession(target), target, "interactive-bootstrap")
        await loadWindowUrl(window, prepared.url)
        attachServerVersionWatcher(window, target, prepared.version)
        logger.log("main", "instance.bootstrap.success", { prepared, ...instanceSummary(target) })
      })
      .catch((error) => {
        if (error instanceof DesktopVersionAuthRequiredError) {
          logger.log("main", "instance.bootstrap.wait-auth", {
            authUrl: error.authUrl,
            ...instanceSummary(target),
          })
          return
        }
        logger.log("main", "instance.bootstrap.error", { error, ...instanceSummary(target) })
      })
      .finally(() => {
        inflight = undefined
      })
  }

  const schedule = () => {
    if (closed || timer) return
    timer = setTimeout(() => {
      timer = undefined
      attempt()
    }, 150)
  }

  const onLoad = () => schedule()
  const onNavigate = (_event: Electron.Event, url: string) => {
    if (!currentOrigin) {
      schedule()
      return
    }
    if (asUrl(url)?.origin !== currentOrigin) return
    schedule()
  }
  const onNavigateInPage = (_event: Electron.Event, url: string) => {
    if (!currentOrigin) {
      schedule()
      return
    }
    if (asUrl(url)?.origin !== currentOrigin) return
    schedule()
  }

  window.on("closed", cleanup)
  window.webContents.on("did-finish-load", onLoad)
  window.webContents.on("did-navigate", onNavigate)
  window.webContents.on("did-navigate-in-page", onNavigateInPage)
  // Periodic backstop: even if no nav events fire (auth flow keeps the user
  // on a single page that fetch-redirects, or the redirect lands on a path
  // that doesn't trigger our origin check), poll the version endpoint until
  // the session is allowed through.
  pollTimer = setInterval(() => attempt(), 3_000)
  pollTimer.unref?.()
}

// Watches a connected window's server for a `current` version bump. When
// the server reports a different version than the one we connected with,
// the client is now behind: `uiHost.prepare` is keyed by version so the
// cached UI bundle is stale. We tear the connection down, re-run prepare
// (which downloads the matching new UI bundle) and reload the window.
//
// The same `instances:open-progress` IPC channel used by the initial open
// is reused for the reconnect, so the renderer's existing overlay shows
// the download progress without any new wiring.
function attachServerVersionWatcher(window: BrowserWindow, instance: SavedInstance, connectedVersion: string) {
  // Replace any prior watcher for this window. Safe whether or not one
  // existed — `stop()` is idempotent.
  windowVersionWatchers.get(window.id)?.stop()
  windowVersionWatchers.delete(window.id)
  if (window.isDestroyed()) return
  const live = getInstanceLive(instance.id) ?? instance
  const baseUrl = (() => {
    const url = asUrl(live.url)
    return url ? url.toString().replace(/\/+$/, "") : undefined
  })()
  if (!baseUrl) return

  const emit = (payload: Record<string, unknown>) => {
    if (window.isDestroyed()) return
    window.webContents.send("instances:open-progress", { instanceID: instance.id, ...payload })
  }

  const watcher = createServerVersionWatcher({
    baseUrl,
    headers: live.headers,
    currentVersion: connectedVersion,
    fetchImpl: (input, init) => {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const target = getInstanceLive(instance.id) ?? instance
      return ensureSession(target).fetch(requestUrl, init)
    },
    onChange: ({ version, previous }) => {
      if (windowReconnecting.has(window.id)) return
      windowReconnecting.add(window.id)
      logger.log("main", "instance.server-upgrade.detected", {
        id: instance.id,
        previous,
        version,
      })
      // Inject the in-page overlay BEFORE we emit any progress, so the
      // first event the overlay sees is our initial download tick.
      if (!window.isDestroyed()) {
        window.webContents
          .executeJavaScript(reconnectOverlayScript, true)
          .catch((error) => logger.log("main", "instance.server-upgrade.overlay.error", { error }))
      }
      emit({
        phase: "download",
        message: `Server upgraded ${previous} → ${version}. Downloading matching UI…`,
        percent: 4,
        version,
      })
      void (async () => {
        try {
          // Re-resolve the live instance — for local instances the URL
          // changes if the binary was restarted on a new port during the
          // upgrade. Falls back to the saved record otherwise.
          const refreshed = getInstanceLive(instance.id) ?? instance
          const prepared = await uiHost.prepare(
            refreshed,
            (progress: DesktopUIPrepareProgress) => emit(progress),
            { targetVersion: version },
          )
          if (window.isDestroyed()) return
          emit({ phase: "done", message: "Loading…", percent: 100, version: prepared.version })
          await clearRendererHttpCache(ensureSession(refreshed), refreshed, "server-upgrade")
          await loadWindowUrl(window, prepared.url)
          // Re-arm the watcher with the new connected version so we react
          // to the next bump too.
          attachServerVersionWatcher(window, refreshed, prepared.version)
          logger.log("main", "instance.server-upgrade.reconnect.success", {
            id: instance.id,
            previous,
            version: prepared.version,
          })
        } catch (error) {
          logger.log("main", "instance.server-upgrade.reconnect.error", { error, id: instance.id })
          emit({
            phase: "error",
            message: error instanceof Error ? error.message : String(error),
            percent: 0,
          })
        } finally {
          windowReconnecting.delete(window.id)
        }
      })()
    },
    onError: () => undefined,
  })
  windowVersionWatchers.set(window.id, watcher)
  window.once("closed", () => {
    windowVersionWatchers.get(window.id)?.stop()
    windowVersionWatchers.delete(window.id)
    windowReconnecting.delete(window.id)
  })
  // Force an immediate poll. If `prepare` just took the fast path with a
  // stale cached version (origin marked fresh within CACHE_TTL_MS but the
  // server has since upgraded), this revalidates within seconds instead of
  // waiting for the 15s default tick.
  watcher.ping()
}

async function openInstance(saved: SavedInstance, opts?: { progressTo?: WebContents; showErrorDialog?: boolean }) {
  const showOpenError = async (input: MessageBoxOptions) => {
    if (opts?.showErrorDialog === false) return
    await showMessageBox(input)
  }
  const emit = (payload: Record<string, unknown>) => {
    const wc = opts?.progressTo
    if (!wc || wc.isDestroyed()) return
    wc.send("instances:open-progress", { instanceID: saved.id, ...payload })
  }
  let instance = saved
  if (saved.local) {
    try {
      emit({ phase: "probe", message: "Starting local server…", percent: 4 })
      instance = await ensureLocalRunning(saved)
    } catch (error) {
      logger.log("main", "instance.local.start-failed", { error, ...instanceSummary(saved) })
      emit({ phase: "error", message: error instanceof Error ? error.message : String(error), percent: 0 })
      await showOpenError({
        type: "error",
        message: "Couldn't start the local Codeplane server",
        detail: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }
  const target = asUrl(instance.url)
  if (!target) {
    emit({ phase: "error", message: "Invalid URL", percent: 0 })
    await showOpenError({
      type: "error",
      message: "Invalid instance URL",
      detail: instance.url,
    })
    return false
  }

  try {
    logger.log("main", "instance.open.start", instanceSummary(instance))
    emit({ phase: "probe", message: "Connecting…", percent: 8 })
    const ses = ensureSession(instance)

    // Match the previous (setup) window's bounds + state so the new window
    // appears in the exact same place. Combined with the post-load fade,
    // this hides the fact that we recreate the window for the per-instance
    // session — the user perceives a single seamless transition.
    const previous = mainWindow
    const previousBounds = previous && !previous.isDestroyed() ? currentWindowBounds(previous) : undefined
    const previousFullscreen = previous && !previous.isDestroyed() ? previous.isFullScreen() : false
    const storedBounds = store.get("windowBounds")
    const restoreBounds = previousBounds ?? storedBounds
    const restoreMaximized = previousBounds ? previousBounds.maximized : storedBounds?.maximized

    const winOpts = createWindowOptions(ses, restoreBounds)
    const window = new BrowserWindow(winOpts)
    attachWindowDebugLogging(window, "instance")
    // We deliberately do NOT auto-show on ready-to-show. The setup window
    // stays in front showing the loading overlay until the instance UI
    // is fully loaded, then we swap atomically below.
    attachWindowHandlers(window)
    if (previousFullscreen) window.setFullScreen(true)
    else if (restoreMaximized) window.maximize()
    mainWindow = window
    await setLastInstanceID(instance.id)
    const prepared = await uiHost
      .prepare(instance, (progress: DesktopUIPrepareProgress) => emit(progress))
      .catch(async (error) => {
        if (!(error instanceof DesktopVersionAuthRequiredError)) throw error
        logger.log("main", "instance.open.auth-required", {
          authUrl: error.authUrl,
          ...instanceSummary(instance),
        })
        // Hand the window over to the interactive bootstrap watcher BEFORE we
        // navigate to the auth URL, so the listeners catch the very first
        // `did-finish-load` from the auth page and the later redirect back.
        attachInteractiveBootstrap(window, instance, { progressTo: opts?.progressTo })
        emit({ phase: "probe", message: "Waiting for sign-in…", percent: 12 })
        await loadWindowUrl(window, error.authUrl)
        return
      })
    if (prepared) {
      currentInstanceID = instance.id
      emit({ phase: "done", message: "Loading…", percent: 100, version: prepared.version })
      await clearRendererHttpCache(ses, instance, "instance-open")
      await loadWindowUrl(window, prepared.url)
      attachServerVersionWatcher(window, instance, prepared.version)
    }

    // Atomically swap setup → instance. Hidden window starts at opacity 0
    // so the OS doesn't draw a frame before our crossfade begins.
    if (!window.isDestroyed()) {
      window.setOpacity(0)
      focusWindow(window)
      const fadeMs = 220
      const fadeStart = Date.now()
      const fadeStep = () => {
        if (window.isDestroyed()) return
        const t = Math.min(1, (Date.now() - fadeStart) / fadeMs)
        // smooth ease-out so it feels like a real native fade
        const eased = 1 - Math.pow(1 - t, 3)
        window.setOpacity(eased)
        if (previous && previous !== window && !previous.isDestroyed()) {
          previous.setOpacity(1 - eased)
        }
        if (t < 1) setTimeout(fadeStep, 16)
        else if (previous && previous !== window && !previous.isDestroyed()) previous.close()
      }
      fadeStep()
    }
    logger.log("main", "instance.open.success", { prepared, ...instanceSummary(instance) })
    return true
  } catch (error) {
    logger.log("main", "instance.open.error", { error, ...instanceSummary(instance) })
    emit({ phase: "error", message: error instanceof Error ? error.message : String(error), percent: 0 })
    await showOpenError({
      type: "error",
      message: "Couldn't open this instance",
      detail: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

// macOS permission state is read repeatedly (every computer-use call plus
// the settings UI). Keep this path passive: `desktopCapturer.getSources()`
// can trigger the OS Screen Recording prompt and can also return empty
// thumbnails even after System Settings shows the app as granted. The actual
// computer-use capture path validates that the screen can be captured.
const PERMISSION_CACHE_TTL_MS = 1_500
type CachedBool = { value: boolean; at: number }
type DesktopSystemPermissionStatus = {
  key: string
  label: string
  granted: boolean
  active?: boolean
  restartRequired?: boolean
  preferencePane?: string
}
let accessibilityCache: CachedBool | undefined
let screenRecordingCache: CachedBool | undefined

function readCache(cache: CachedBool | undefined): boolean | undefined {
  if (!cache) return undefined
  if (Date.now() - cache.at > PERMISSION_CACHE_TTL_MS) return undefined
  return cache.value
}

async function checkMacOSAccessibility(): Promise<boolean> {
  const cached = readCache(accessibilityCache)
  if (cached !== undefined) return cached
  let value = false
  try {
    value = systemPreferences.isTrustedAccessibilityClient(false)
  } catch {
    value = false
  }
  accessibilityCache = { value, at: Date.now() }
  return value
}

async function checkMacOSScreenRecording(): Promise<boolean> {
  const cached = readCache(screenRecordingCache)
  if (cached !== undefined) return cached
  const value = macOSScreenRecordingStatusGranted()
  screenRecordingCache = { value, at: Date.now() }
  return value
}

function macOSScreenRecordingStatusGranted() {
  try {
    return systemPreferences.getMediaAccessStatus("screen") === "granted"
  } catch {
    return false
  }
}

function checkMacOSScreenRecordingState() {
  const granted = macOSScreenRecordingStatusGranted()
  return {
    granted,
    active: granted,
    restartRequired: false,
  }
}

async function missingMacOSComputerPermissions(params: DesktopComputerInput) {
  const missing: string[] = []
  if (desktopComputerNeedsAccessibility(params) && !(await checkMacOSAccessibility())) missing.push("Accessibility")
  const screenRecording = checkMacOSScreenRecordingState()
  if (!screenRecording.active) {
    missing.push(screenRecording.granted ? "Screen Recording (relaunch Codeplane Desktop)" : "Screen Recording")
  }
  return missing
}

function isMacOSComputerPermissionError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return /not authorized|not authorised|assistive access|accessibility|screen recording|screen capture|permission|privacy|tcc|denied/i.test(
    message,
  )
}

function rectFromDisplayBounds(bounds: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  }
}

function clampCaptureSize(width: number, height: number) {
  const longestEdge = Math.max(width, height)
  if (longestEdge <= DESKTOP_CAPTURE_MAX_EDGE) return { width, height }
  const scale = DESKTOP_CAPTURE_MAX_EDGE / longestEdge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function virtualDesktopBounds(displays: DesktopComputerDisplay[]) {
  const minX = Math.min(...displays.map((display) => display.bounds.x))
  const minY = Math.min(...displays.map((display) => display.bounds.y))
  const maxX = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width))
  const maxY = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height))
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function listDesktopComputerDisplays(sourceNames: Map<string, string>) {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map((display, index) => {
    const label =
      sourceNames.get(String(display.id))?.trim() ||
      ("label" in display && typeof display.label === "string" ? display.label.trim() : "") ||
      (`Display ${index + 1}`)
    return {
      id: String(display.id),
      label,
      bounds: rectFromDisplayBounds(display.bounds),
      workArea: rectFromDisplayBounds(display.workArea),
      scaleFactor: display.scaleFactor,
      rotation: display.rotation,
      primary: display.id === primary.id,
      internal: "internal" in display ? display.internal : false,
    } satisfies DesktopComputerDisplay
  })
}

const captureElectronScreen: DesktopComputerCapture = async ({ displayId }) => {
  const sourceNames = new Map<string, string>()
  const probeSources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 16, height: 16 },
    fetchWindowIcons: false,
  })
  for (const source of probeSources) {
    const sourceDisplayId = source.display_id?.trim()
    if (!sourceDisplayId) continue
    sourceNames.set(sourceDisplayId, source.name)
  }
  const displays = listDesktopComputerDisplays(sourceNames)
  const selectedDisplay = displayId ? displays.find((display) => display.id === displayId) : undefined
  if (displayId && !selectedDisplay) {
    throw new Error(`Display ${displayId} is not available to Codeplane Desktop.`)
  }
  const captureBounds = selectedDisplay ? selectedDisplay.bounds : virtualDesktopBounds(displays)
  const captureScaleFactor = selectedDisplay ? selectedDisplay.scaleFactor : Math.max(...displays.map((display) => display.scaleFactor), 1)
  const thumbnailSize = clampCaptureSize(
    Math.max(1, Math.ceil(captureBounds.width * captureScaleFactor)),
    Math.max(1, Math.ceil(captureBounds.height * captureScaleFactor)),
  )
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize,
    fetchWindowIcons: false,
  })
  const source =
    (selectedDisplay
      ? sources.find((item) => item.display_id && item.display_id === selectedDisplay.id)
      : undefined) ??
    sources.find((item) => item.name === "Entire Screen") ??
    sources.find((item) => item.display_id && item.display_id === String(screen.getPrimaryDisplay().id)) ??
    sources[0]
  if (!source) throw new Error("No screen source is available to Codeplane Desktop.")
  if (source.thumbnail.isEmpty()) {
    screenRecordingCache = { value: false, at: Date.now() }
    throw new Error("Screen capture returned an empty image.")
  }
  const size = source.thumbnail.getSize()
  if (size.width <= 0 || size.height <= 0) {
    screenRecordingCache = { value: false, at: Date.now() }
    throw new Error("Screen capture returned an invalid image.")
  }
  screenRecordingCache = { value: true, at: Date.now() }
  const currentDisplayId = selectedDisplay?.id || (source.display_id?.trim() || undefined)
  return {
    displays: displays.map((display) =>
      currentDisplayId && display.id === currentDisplayId ? { ...display, current: true } : display,
    ),
    screenshot: {
      dataUrl: source.thumbnail.toDataURL(),
      width: size.width,
      height: size.height,
      displayId: currentDisplayId,
      scope: currentDisplayId ? "display" : "virtual-desktop",
    },
  }
}

function invalidateMacOSPermissionCache() {
  accessibilityCache = undefined
  screenRecordingCache = undefined
}

function showSetupWindow(editId?: string) {
  logger.log("main", "setup.open-window", { editId })
  const previous = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const next = createWindow(editId, previous ? currentWindowBounds(previous) : undefined)
  if (previous && previous !== next && !previous.isDestroyed()) previous.close()
}

function openDesktopStartPage() {
  logger.log("main", "startup.open-selector", {
    instances: instanceState.instances.length,
    lastInstanceId: lastInstanceID() ?? null,
  })
  createWindow()
}

function setupIpc() {
  ipcMain.on("app:version", (event) => {
    event.returnValue = app.getVersion()
  })
  ipcMain.on("storage:get", (event, storageName: string | undefined, key: string) => {
    event.returnValue = readDesktopStorage(storageName, key)
  })
  ipcMain.on("storage:set", (event, storageName: string | undefined, key: string, value: string) => {
    writeDesktopStorage(storageName, key, value)
    event.returnValue = true
  })
  ipcMain.on("storage:remove", (event, storageName: string | undefined, key: string) => {
    removeDesktopStorage(storageName, key)
    event.returnValue = true
  })
  ipcMain.on("window:state-snapshot", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    event.returnValue = window
      ? {
          fullscreen: window.isFullScreen(),
          focused: window.isFocused(),
          maximized: window.isMaximized(),
          platform: process.platform,
        }
      : { fullscreen: false, focused: true, maximized: false, platform: process.platform }
  })
  ipcMain.on("desktop:log", (_event, payload: { event?: string; data?: unknown; scope?: string }) => {
    if (!payload.event) return
    logger.log(payload.scope || "renderer", payload.event, payload.data)
  })
  ipcMain.on("desktop:bootstrap", (event) => {
    try {
      const instances = savedInstances()
      const bootstrap = uiHost.bootstrap(instances, currentInstanceID)
      const defaultID = lastInstanceID()
      event.returnValue = {
        ...bootstrap,
        defaultKey: defaultID ? uiHost.proxyKey(defaultID) : null,
      }
      logger.log("main", "ipc.bootstrap", {
        currentInstanceID,
        defaultID,
        instanceCount: instances.length,
      })
    } catch {
      const fallbackID = lastInstanceID()
      event.returnValue = {
        currentKey: null,
        defaultKey: fallbackID ? uiHost.proxyKey(fallbackID) : null,
        instances: [],
      }
    }
  })
  ipcMain.handle("desktop:log-path", () => logger.path())
  // Resync from disk so instances registered out-of-band (e.g. the dev-instance
  // CLI writing straight to instances.json) show up when the picker reopens,
  // without requiring a full app restart.
  ipcMain.handle("instances:list", async () => (await syncInstanceState()).instances)
  ipcMain.handle("instances:get-default-key", () => {
    const defaultID = lastInstanceID()
    return defaultID ? uiHost.proxyKey(defaultID) : null
  })
  ipcMain.handle("instances:get-last", () => lastInstanceID())
  ipcMain.handle("instances:save", async (_event, instance: SavedInstance) => {
    logger.log("main", "instances.save", instanceSummary(instance))
    await instanceStore.save(instance)
    return (await syncInstanceState()).instances
  })
  ipcMain.handle("instances:prepare", async (event, saved: SavedInstance) => {
    logger.log("main", "instances.prepare.start", instanceSummary(saved))
    let instance = saved
    if (saved.local) {
      try {
        instance = await ensureLocalRunning(saved, (progress: LocalInstanceProgress) => {
          event.sender.send("local:install-progress", { ...progress, version: saved.local!.binaryVersion })
        })
      } catch (error) {
        logger.log("main", "instances.prepare.local-start-error", { error, ...instanceSummary(saved) })
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    try {
      const prepared = await uiHost.prepare(instance, (progress: DesktopUIPrepareProgress) => {
        event.sender.send("instances:prepare-progress", {
          instanceID: instance.id,
          ...progress,
        })
      })
      logger.log("main", "instances.prepare.success", { prepared, ...instanceSummary(instance) })
      return { ok: true as const, ...prepared }
    } catch (error) {
      if (error instanceof DesktopVersionAuthRequiredError) {
        logger.log("main", "instances.prepare.auth-required", {
          authUrl: error.authUrl,
          ...instanceSummary(instance),
        })
        return {
          ok: false as const,
          error: "Sign-in is required before the desktop app can cache this UI. The instance was saved.",
          authUrl: error.authUrl,
        }
      }
      logger.log("main", "instances.prepare.error", { error, ...instanceSummary(instance) })
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
  ipcMain.handle("instances:remove", async (_event, id: string) => {
    logger.log("main", "instances.remove", { id })
    const list = savedInstances()
    const target = list.find((entry) => entry.id === id)
    const next = await instanceStore.remove(id)
    await syncInstanceState()
    if (target?.local) {
      await localManager.stop(id).catch((error) => logger.log("main", "instances.remove.stop-error", { error, id }))
      await localManager
        .removeData(id)
        .catch((error) => logger.log("main", "instances.remove.data-error", { error, id }))
    }
    return next
  })
  ipcMain.handle("instances:cache-info", async (_event, id: string) => {
    logger.log("main", "instances.cache-info", { id })
    const target = getInstance(id)
    if (!target) return { exists: false, bytes: 0, areas: [], desktopUI: { exists: false, bytes: 0, versions: [] } }
    return getDesktopInstanceCacheInfo(target)
  })
  ipcMain.handle("instances:clear-cache", async (_event, id: string) => {
    logger.log("main", "instances.clear-cache", { id })
    const target = getInstance(id)
    if (!target) return { ok: false as const, error: "Instance not found." }
    const cleared = await clearDesktopInstanceCache(target)
    return { ok: true as const, cleared }
  })
  ipcMain.handle("instances:set-default-key", async (_event, key: string | null) => {
    logger.log("main", "instances.set-default-key", { key })
    const instances = savedInstances()
    const match = key ? instances.find((instance) => uiHost.proxyKey(instance.id) === key) : undefined
    await setLastInstanceID(match?.id)
    return true
  })
  ipcMain.handle("instances:open", async (event, id: string) => {
    logger.log("main", "instances.open", { id })
    const instance = getInstance(id)
    if (!instance) return false
    return openInstance(instance, { progressTo: event.sender })
  })
  ipcMain.handle("instances:open-log-dir", async (_event, id: string) => {
    logger.log("main", "instances.open-log-dir", { id })
    return openLocalInstanceLogDir(id)
  })
  ipcMain.handle("instances:show-setup", (_event, editId?: string) => {
    logger.log("main", "instances.show-setup", { editId })
    setTimeout(() => showSetupWindow(editId), 0)
    return true
  })
  ipcMain.handle("local:target", async () => ({
    archiveName: localManager.target.archiveName,
    archiveExt: localManager.target.archiveExt,
    binaryName: localManager.target.binaryName,
    os: localManager.target.os,
    arch: localManager.target.arch,
    packageName: localManager.target.packageName,
    defaultVersion: await readPreferredLocalVersion(CodeplaneVersion),
  }))
  ipcMain.handle("local:list-versions", async () => {
    try {
      const list = await fetchCodeplaneVersions()
      logger.log("main", "local.list-versions", { count: list.versions.length, latest: list.latest })
      return { ok: true as const, ...list }
    } catch (error) {
      logger.log("main", "local.list-versions.error", { error })
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle("local:status", async (_event, version: string) => {
    const status = await localManager.status(version || (await readPreferredLocalVersion(CodeplaneVersion)))
    logger.log("main", "local.status", status)
    return status
  })
  ipcMain.handle("local:install", async (event, input: { version?: string }) => {
    const version = input?.version || (await readPreferredLocalVersion(CodeplaneVersion))
    logger.log("main", "local.install.start", { version })
    try {
      const result = await localManager.download(version, (progress: LocalInstanceProgress) => {
        event.sender.send("local:install-progress", { ...progress, version })
      })
      await writePreferredLocalVersion(version)
      logger.log("main", "local.install.success", result)
      return { ok: true as const, ...result }
    } catch (error) {
      logger.log("main", "local.install.error", { error, version })
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle("local:start", async (event, input: { id: string; binaryVersion: string }) => {
    logger.log("main", "local.start.request", input)
    try {
      const running = await localManager.start(input, (progress: LocalInstanceProgress) => {
        event.sender.send("local:install-progress", { ...progress, version: input.binaryVersion })
      })
      return { ok: true as const, ...running }
    } catch (error) {
      logger.log("main", "local.start.error", { error, ...input })
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle("local:stop", async (_event, id: string) => {
    logger.log("main", "local.stop.request", { id })
    await localManager.stop(id).catch((error) => logger.log("main", "local.stop.error", { error, id }))
    return true
  })
  ipcMain.handle("local:running", () => {
    const ids: string[] = []
    for (const instance of savedInstances()) {
      if (instance.local && localManager.isRunning(instance.id)) ids.push(instance.id)
    }
    return ids
  })
  ipcMain.handle("instances:probe", async (_event, input: string | DesktopHostInstance) => {
    const instance =
      typeof input === "string"
        ? ({ id: `probe:${Date.now()}`, url: input } satisfies DesktopHostInstance)
        : { ...input, id: input.id || `probe:${Date.now()}` }
    const target = asUrl(instance.url)
    if (!target) return { ok: false, error: "Invalid URL" }
    try {
      logger.log("main", "instances.probe.start", instanceSummary(instance))
      const ses = ensureSession(instance)
      const nativeFetch =
        "fetch" in ses && typeof ses.fetch === "function"
          ? ses.fetch.bind(ses)
          : fetch
      const response = await nativeFetch(new URL("global/version", target).toString(), {
        method: "GET",
        redirect: "follow",
      })
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, status: response.status }
      const data = (await response.json().catch(() => ({}))) as { current?: string; latest?: string }
      logger.log("main", "instances.probe.success", {
        latest: data.latest ?? null,
        status: response.status,
        version: data.current ?? null,
        ...instanceSummary(instance),
      })
      return { ok: true, version: data.current ?? null, latest: data.latest ?? null }
    } catch (error) {
      logger.log("main", "instances.probe.error", { error, ...instanceSummary(instance) })
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle("auth:open-external", async (_event, url: string) => {
    const target = asUrl(url)
    if (!target) return false
    logger.log("main", "auth.open-external", { url: target.toString() })
    await shell.openExternal(target.toString())
    return true
  })

  // Begin an MCP OAuth flow in an embedded, sandboxed, session-scoped window.
  // The renderer's "Authorize" button calls this after the backend hands back
  // an authorization URL; the window auto-closes once the provider redirects to
  // the (server-hosted) callback, and the backend completes the token exchange.
  ipcMain.handle(
    "mcp:authorize",
    async (
      _event,
      input: { name: string; authorizationUrl: string; redirectUri: string },
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const authUrl = asUrl(input?.authorizationUrl ?? "")
      const redirectUri = asUrl(input?.redirectUri ?? "")
      if (!authUrl || (authUrl.protocol !== "https:" && authUrl.protocol !== "http:")) {
        return { ok: false, error: "Invalid authorization URL" }
      }
      if (!redirectUri || (redirectUri.protocol !== "https:" && redirectUri.protocol !== "http:")) {
        return { ok: false, error: "Invalid redirect URI" }
      }
      const instance = getInstance(currentInstanceID)
      if (!instance) return { ok: false, error: "No active instance" }
      const name = typeof input?.name === "string" && input.name ? input.name : "MCP server"
      try {
        logger.log("main", "mcp.oauth.authorize.open", { mcpName: name, ...instanceSummary(instance) })
        await openInstanceMcpOAuth(instance, {
          name,
          authorizationUrl: authUrl.toString(),
          redirectUri: redirectUri.toString(),
        })
        return { ok: true }
      } catch (error) {
        logger.log("main", "mcp.oauth.authorize.error", {
          error: error instanceof Error ? error.message : String(error),
          ...instanceSummary(instance),
        })
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  // Open a child BrowserWindow at the instance URL so the user can sign in
  // through whatever auth proxy sits in front of it (Cloudflare Access,
  // identity-aware proxy, custom SSO redirect). When the child window
  // either reaches the instance origin successfully (HTTP 200 from the
  // version endpoint via its own session) or the user closes it, we
  // collect the cookies set on the instance origin and return them as a
  // single Cookie header line. The caller (setup form) merges that into
  // the saved instance's headers blob, so future requests carry the
  // proof-of-auth cookies until they expire — at which point the existing
  // bounce-to-Loader auth-required flow tells the user to sign in again.
  ipcMain.handle(
    "instances:sign-in-with-browser",
    async (
      _event,
      input: { id: string; url: string },
    ): Promise<{ ok: true; cookieHeader: string; cookieCount: number } | { ok: false; error: string }> => {
      const target = asUrl(input.url)
      if (!target) return { ok: false, error: "Invalid URL" }
      logger.log("main", "instances.sign-in-with-browser.start", { id: input.id, url: target.toString() })

      // Use the same per-instance session as the main window so any cookies
      // captured here are immediately available to the production load.
      const probeInstance: SavedInstance = { id: input.id, url: target.toString() }
      const ses = ensureSession(probeInstance)

      const child = new BrowserWindow({
        width: 540,
        height: 720,
        title: `Sign in to ${target.host}`,
        autoHideMenuBar: true,
        webPreferences: {
          session: ses,
          partition: undefined,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      })

      const collectCookieHeader = async (): Promise<{ count: number; line: string }> => {
        // Cookies set on subdomains and parents both apply to the instance
        // origin per RFC 6265. Pull the union and dedupe by name (last write
        // wins so the freshest value from the sign-in flow wins over any
        // stale one already in the jar).
        const cookies = await ses.cookies.get({ url: target.toString() })
        const seen = new Map<string, string>()
        for (const cookie of cookies) {
          if (!cookie.name) continue
          seen.set(cookie.name, cookie.value)
        }
        const line = Array.from(seen.entries())
          .map(([name, value]) => `${name}=${value}`)
          .join("; ")
        return { count: seen.size, line }
      }

      try {
        await new Promise<void>((resolve, reject) => {
          let settled = false
          const finish = () => {
            if (settled) return
            settled = true
            resolve()
          }
          const fail = (error: Error) => {
            if (settled) return
            settled = true
            reject(error)
          }
          child.on("closed", () => finish())
          // If the user finishes auth and lands back on the instance origin
          // root, we treat that as a success signal and auto-close the
          // child window after a short grace so any setting cookies from
          // the redirect chain land first.
          child.webContents.on("did-navigate", (_event, navigatedUrl) => {
            const u = asUrl(navigatedUrl)
            if (!u || u.origin !== target.origin) return
            // Probe the version endpoint via the child session; if it
            // returns 200 with a JSON body, the auth proof is in place.
            void (async () => {
              try {
                const fetchFn =
                  "fetch" in ses && typeof ses.fetch === "function" ? ses.fetch.bind(ses) : fetch
                const response = await fetchFn(new URL("global/version", target).toString(), {
                  method: "GET",
                  redirect: "follow",
                })
                if (!response.ok) return
                const body = (await response.json().catch(() => ({}))) as { current?: unknown }
                if (typeof body.current !== "string") return
                logger.log("main", "instances.sign-in-with-browser.success-detected", {
                  id: input.id,
                  url: target.toString(),
                })
                setTimeout(() => {
                  if (!child.isDestroyed()) child.close()
                }, 800)
              } catch {
                // Silent — keep the window open and let the user continue.
              }
            })()
          })
          void child.loadURL(target.toString()).catch((err) => fail(err instanceof Error ? err : new Error(String(err))))
        })

        const collected = await collectCookieHeader()
        if (collected.count === 0) {
          logger.log("main", "instances.sign-in-with-browser.no-cookies", { id: input.id })
          return { ok: false, error: "No cookies were set during the sign-in flow." }
        }
        logger.log("main", "instances.sign-in-with-browser.success", {
          cookieCount: collected.count,
          id: input.id,
        })
        return { ok: true, cookieHeader: collected.line, cookieCount: collected.count }
      } catch (error) {
        logger.log("main", "instances.sign-in-with-browser.error", { error, id: input.id })
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )
  ipcMain.handle("system-permissions:check", async () => {
    const permissions: DesktopSystemPermissionStatus[] = []

    if (process.platform === "darwin") {
      const accessibilityGranted = await checkMacOSAccessibility()
      permissions.push({
        key: "accessibility",
        label: "Accessibility",
        granted: accessibilityGranted,
        active: accessibilityGranted,
        preferencePane: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      })

      const screenRecording = checkMacOSScreenRecordingState()
      permissions.push({
        key: "screen-recording",
        label: "Screen Recording",
        granted: screenRecording.granted,
        active: screenRecording.active,
        restartRequired: screenRecording.restartRequired,
        preferencePane: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      })
    }

    if (process.platform === "win32") {
      permissions.push(
        { key: "accessibility", label: "UI Automation / Accessibility", granted: true, active: true },
        { key: "screen-recording", label: "Screen capture", granted: true, active: true },
      )
    }

    if (process.platform === "linux") {
      permissions.push(
        { key: "accessibility", label: "X11 / input access", granted: true, active: true },
        { key: "screen-recording", label: "Display access", granted: true, active: true },
      )
    }

    return { platform: process.platform, permissions }
  })

  ipcMain.handle("system-permissions:request", async (_event, permissionKey: string) => {
    if (process.platform === "darwin") {
      // The user is actively re-granting — drop any stale cached value so
      // the next check reflects the post-grant state instead of the snapshot
      // from earlier in the session.
      invalidateMacOSPermissionCache()
      if (permissionKey === "accessibility") {
        try {
          systemPreferences.isTrustedAccessibilityClient(true)
        } catch {
          // Fall through to opening the preference pane below.
        }
      }
      if (permissionKey === "screen-recording") {
        await desktopCapturer.getSources({ types: ["screen"] }).catch(() => undefined)
      }
      const url =
        permissionKey === "accessibility"
          ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
          : permissionKey === "screen-recording"
            ? "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            : "x-apple.systempreferences:com.apple.preference.security"
      try {
        await shell.openExternal(url)
        return true
      } catch {
        return false
      }
    }
    if (process.platform === "win32") {
      try {
        await shell.openExternal("ms-settings:privacy")
        return true
      } catch {
        return false
      }
    }
    return false
  })

  ipcMain.handle("notifications:is-supported", () => Notification.isSupported())
  ipcMain.handle("notifications:notify", async (event, payload: DesktopNotificationPayload) => {
    const notified = await showDesktopNotification(event.sender, payload)
    logger.log("main", "notifications.notify.result", {
      href: payload.href,
      notified,
      title: payload.title,
    })
    return notified
  })
  ipcMain.handle("updater:status", async () => {
    const status = await getDesktopUpdateStatus()
    logger.log("main", "updater.status", status)
    return status
  })
  ipcMain.handle("updater:check", async () => {
    const result = await runRuntimeUpdateCheck()
    logger.log("main", "updater.check", result)
    return result
  })
  ipcMain.handle("updater:release-notes", async (_event, version: string) => {
    const result = await getDesktopReleaseNotes(version)
    logger.log("main", "updater.release-notes", { found: !!result, version })
    return result
  })
  ipcMain.handle("updater:download", async () => {
    try {
      const status = await getDesktopUpdateStatus()
      if (!status.latest || !status.hasUpdate) {
        logger.log("main", "updater.download.skipped", status)
        return { ok: true as const }
      }
      return installShellUpdate(status.latest)
    } catch (error) {
      const response = { ok: false as const, error: error instanceof Error ? error.message : String(error) }
      logger.log("main", "updater.download.error", response)
      return response
    }
  })
  ipcMain.handle("updater:install", () => {
    if (mockUpdaterMode()) {
      logger.log("main", "updater.install.mock")
      return { ok: true as const, mocked: true }
    }
    logger.log("main", "updater.install.requested")
    if (app.isPackaged) {
      // Run on next tick so the IPC reply ships before the app exits.
      setImmediate(() => quitAndInstallShellUpdate("ipc-request"))
    }
    return { ok: true as const }
  })

  // Cleanly relaunch the Electron shell. Used after the user grants TCC
  // permissions in System Settings — macOS only re-reads TCC at process
  // start, so the running app keeps seeing "denied" until it's restarted.
  // Renderer-side `platform.restart()` reloads the *server*, not the shell,
  // which doesn't reset TCC state. This IPC quits the Electron process and
  // immediately relaunches it. `setImmediate` so the IPC reply ships before
  // exit; the kept-alive renderer Promise resolves to `true` either way.
  ipcMain.handle("app:relaunch-shell", () => {
    logger.log("main", "app.relaunch.requested")
    if (!app.isPackaged) {
      // In development the dev script is the responsible parent; relaunch
      // would leave the user without an app. Tell the renderer so it can
      // surface a "please quit and reopen manually" toast.
      return { ok: false as const, error: "Relaunch is only available in packaged builds." }
    }
    setImmediate(() => {
      try {
        app.relaunch()
        app.exit(0)
      } catch (error) {
        logger.log("main", "app.relaunch.error", { error })
      }
    })
    return { ok: true as const }
  })
}

let shellQuitAndInstallScheduled = false

function quitAndInstallShellUpdate(reason: string) {
  if (shellQuitAndInstallScheduled) return
  shellQuitAndInstallScheduled = true
  logger.log("main", "updater.quit-and-install", { reason })

  const staged = desktopShellStagedUpdate
  if (!staged) {
    logger.log("main", "updater.quit-and-install.no-staged-update", {})
    shellQuitAndInstallScheduled = false
    return
  }

  const oldAppPath = getDesktopAppInstallPath()
  const swapScript = stageSwapScript()
  logger.log("main", "updater.swap.spawn", { oldAppPath, newAppPath: staged.extractedAppPath, swapScript })
  const args = [String(process.pid), oldAppPath, staged.extractedAppPath]
  try {
    spawn(swapScript, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref()
  } catch (error) {
    logger.log("main", "updater.swap.error", { error })
    shellQuitAndInstallScheduled = false
    return
  }

  // Give the swap script process a moment to start, then quit.
  setTimeout(() => app.quit(), 200)
}

function setupAutoUpdater() {
  if (process.env.CODEPLANE_DESKTOP_DISABLE_AUTO_UPDATE === "1" || mockUpdaterMode()) {
    logger.log("main", "updater.disabled", {
      disableEnv: process.env.CODEPLANE_DESKTOP_DISABLE_AUTO_UPDATE === "1",
      mockMode: mockUpdaterMode() || null,
    })
    return
  }
  if (!app.isPackaged) {
    logger.log("main", "updater.disabled.unpacked", {})
    return
  }

  setTimeout(() => void runRuntimeUpdateCheck().catch(() => undefined), 5_000)
  setInterval(() => void runRuntimeUpdateCheck().catch(() => undefined), 60 * 60 * 1000)
}

// Single-instance lock so opening another shortcut focuses the existing window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  logger.log("main", "single-instance-lock.denied")
  app.quit()
} else {
  app.on("second-instance", () => {
    logger.log("main", "single-instance-lock.second-instance")
    focusWindow(mainWindow)
  })

  // mTLS / client cert prompt — defer to the OS picker rather than baking a
  // decision into the app. Users with certs see the system dialog and the
  // chosen identity is associated with the per-instance session for the
  // rest of the lifetime of the window.
  app.on("select-client-certificate", (event, _webContents: WebContents, _url, certificateList, callback) => {
    logger.log("main", "select-client-certificate", { count: certificateList.length })
    if (certificateList.length === 0) return
    event.preventDefault()
    callback(certificateList[0])
  })

  // HTTP basic auth prompt — let the OS-style dialog handle it. The web
  // page can also handle this itself if it owns the URL.
  app.on("login", (event, _webContents, _request, authInfo, callback) => {
    logger.log("main", "login", { host: authInfo.host, isProxy: authInfo.isProxy, realm: authInfo.realm })
    if (authInfo.isProxy) return
    // Let Electron surface the native credential dialog for non-proxy
    // HTTP Basic Auth challenges. Do NOT call preventDefault or pass empty
    // credentials — doing so suppresses the OS prompt and sends a blank
    // Authorization header, permanently breaking auth_basic connections.
    event.preventDefault()
    callback()
  })

  app
    .whenReady()
    .then(async () => {
      logger.log("main", "ready")
      applyRuntimeIcon()
      applyRuntimeMetadata()
      await loadInstanceState()
      setupIpc()
      setupAutoUpdater()
      void uiHost.cleanup()
      openDesktopStartPage()

      buildMenu(
        () => mainWindow?.webContents.reload(),
        () => showSetupWindow(),
        () => showSetupWindow(),
      )

      app.on("activate", () => {
        logger.log("main", "activate")
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
        else focusWindow(mainWindow)
      })
    })
    // Without this, a rejection from loadInstanceState/setupIpc/setupAutoUpdater
    // would be swallowed silently and the user would see a frozen splash
    // window. Surface it both in the log and as a fatal dialog so the boot
    // failure is visible.
    .catch((err: unknown) => {
      const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
      logger.error("main", "ready.failed", { error: message })
      dialog.showErrorBox("Codeplane failed to start", message)
      app.exit(1)
    })

  app.on("window-all-closed", () => {
    logger.log("main", "window-all-closed", { platform: process.platform })
    if (process.platform !== "darwin") app.quit()
  })

  // Tear down any local Codeplane processes the desktop spawned so they
  // don't outlive the app and squat on their state directories.
  let teardownPromise: Promise<void> | undefined
  app.on("before-quit", (event) => {
    if (teardownPromise) return
    const runningCount = localManager.listRunning().length
    if (runningCount === 0) return
    logger.log("main", "before-quit.local-stop", { count: runningCount })
    event.preventDefault()
    teardownPromise = localManager
      .stopAll()
      .catch((error) => logger.log("main", "before-quit.stop-error", { error }))
      .finally(() => {
        logger.log("main", "before-quit.local-stop.done", {})
        app.quit()
      })
  })
}
