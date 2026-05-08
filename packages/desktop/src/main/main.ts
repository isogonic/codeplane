import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  session,
  shell,
  dialog,
  type MessageBoxOptions,
  type Session,
  type WebContents,
} from "electron"
import Store from "electron-store"
import { autoUpdater, type UpdateDownloadedEvent, type UpdateInfo, type ProgressInfo } from "electron-updater"
import { CodeplaneHome } from "@codeplane-ai/shared/home"
import {
  fetchCodeplaneVersions,
  readPreferredLocalVersion,
  writePreferredLocalVersion,
} from "@codeplane-ai/shared/local-runtime"
import { createInstanceStore, type State as InstanceStoreState } from "@codeplane-ai/shared/instance-store"
import { createServerVersionWatcher, type ServerVersionWatcher } from "@codeplane-ai/shared/server-version-watcher"
import { existsSync } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
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
import { createLocalInstanceManager, type LocalInstanceProgress } from "./local-instance"
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

const SESSION_PARTITION_PREFIX = "persist:codeplane:"
const HEADER_PREFIX_BLOCKED = ["host", "origin", "referer", "user-agent", "content-length"]
const GITHUB_API_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "codeplane-desktop-updater",
}

let githubTokenCache: { token: string | null; resolvedAt: number } | undefined
const GITHUB_TOKEN_TTL_MS = 5 * 60 * 1000

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
const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/devinoldenburg/codeplane/releases"
const DESKTOP_STORAGE_DIRECT = "__direct__"
const APP_ID = "ai.codeplane.desktop"
const APP_NAME = "Codeplane"
const APP_COPYRIGHT = "Copyright © 2026 Devin Oldenburg"
const APP_WEBSITE = "https://codeplane.ai"
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
  windowBounds?: { x?: number; y?: number; width: number; height: number; maximized?: boolean }
}

type DesktopNotificationPayload = {
  title: string
  description?: string
  href?: string
}

type GitHubRelease = {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
  name?: string | null
  body?: string | null
  html_url?: string | null
  published_at?: string | null
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
// Per-window watcher: started after the window first reaches a server's
// `current` version, stopped on window-close, version-bump, or reconnect.
// Keyed by window id so multiple instance windows don't share state.
const windowVersionWatchers = new Map<number, ServerVersionWatcher>()
const windowReconnecting = new Set<number>()
const localManager = createLocalInstanceManager({
  binariesDir: codeplaneHome.local_server_binaries,
  configDir: codeplaneHome.root,
  dataDir: codeplaneHome.local_server,
  log: (event, data) => logger.log("local-instance", event, data),
  // electron-updater owns the lifecycle of the local runtime spawned by
  // the desktop. Tells the spawned server's Installation.method() to
  // return "desktop" so /global/upgrade short-circuits with the
  // "use the desktop's Updates panel" message instead of attempting
  // an npm install.
  desktopManaged: true,
})
const uiHost = createDesktopUIHost({
  cacheDir: app.getPath("userData"),
  getInstance: getInstanceLive,
  getSession: ensureSession,
  ensureReady: async (instance) => {
    const saved = getInstance(instance.id)
    if (!saved?.local) return instance
    return ensureLocalRunning(saved)
  },
  log: (event, data) => logger.log("ui-host", event, data),
})

app.setName(APP_NAME)
app.setAppUserModelId(APP_ID)
logger.log("main", "bootstrap", {
  appName: APP_NAME,
  codeplaneRoot: codeplaneHome.root,
  cwd: process.cwd(),
  logPath: logger.path(),
  logDir: logger.dir(),
  userData: app.getPath("userData"),
})
// Mirror the log location to stderr too so users running the bundled
// app from a terminal (or attached to the packaged binary's console)
// can find the file without first having to find a log entry that
// reveals it.
// eslint-disable-next-line no-console -- intentional one-time bootstrap announcement
console.error(`[codeplane-desktop] logging to ${logger.path()}`)

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
  const existing = localManager.getRunning(instance.id)
  if (existing) return { ...instance, url: existing.url }
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
  const title = payload.title.trim()
  if (!title) return false
  if (process.env.CODEPLANE_DESKTOP_TEST_NOTIFICATIONS === "1") {
    logger.log("main", "notifications.notify.mock", {
      href: payload.href,
      title,
    })
    return true
  }
  const supported = Notification.isSupported()
  logger.log("main", "notifications.notify.request", {
    href: payload.href,
    supported,
    title,
  })
  if (!supported) return false
  // macOS requires a non-empty body for the notification banner to render
  // reliably. An empty body is sometimes coalesced away by Notification
  // Center even when permission is granted, leaving no visible alert.
  const body = payload.description?.trim() || title
  const notification = new Notification({
    title,
    body,
    icon: desktopNotificationIcon(),
  })
  notification.on("click", () => {
    logger.log("main", "notifications.notify.click", {
      href: payload.href,
      title,
    })
    void routeNotificationClick(sender, payload.href)
  })
  notification.on("close", () => {
    logger.log("main", "notifications.notify.close", {
      href: payload.href,
      title,
    })
  })
  // `notification.show()` is fire-and-forget, but the "show" event only
  // fires when the OS actually surfaces the banner. If permission is
  // denied, Focus is on, or the app isn't registered with Notification
  // Center, none of those events fire — silently dropping the alert.
  // Wait for the show callback (or timeout) so the renderer can surface
  // a meaningful "notifications unavailable" toast instead of falsely
  // reporting success.
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (shown: boolean, reason: string) => {
      if (settled) return
      settled = true
      logger.log("main", "notifications.notify.settle", {
        href: payload.href,
        reason,
        shown,
        title,
      })
      resolve(shown)
    }
    notification.once("show", () => settle(true, "show"))
    notification.once("failed" as Parameters<typeof notification.on>[0], () => settle(false, "failed"))
    try {
      notification.show()
    } catch (error) {
      logger.log("main", "notifications.notify.throw", {
        error: error instanceof Error ? error.message : String(error),
        href: payload.href,
        title,
      })
      settle(false, "throw")
      return
    }
    setTimeout(() => settle(false, "timeout"), 1500)
  })
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

// macOS Squirrel.Mac validates the downloaded update's code signature against
// the running app's designated requirement. Our CI builds with
// CSC_IDENTITY_AUTO_DISCOVERY=false (no Developer ID), so each release is
// ad-hoc signed and SecCodeCheckValidity rejects every in-place update with
// "Code signature at URL ... did not pass validation". There's no Squirrel
// flag to bypass this — it's a macOS security guarantee. Detect the error and
// steer the user to download the new DMG manually instead.
function isCodeSignatureValidationError(message: string) {
  if (!message) return false
  const lower = message.toLowerCase()
  if (lower.includes("did not pass validation")) return true
  if (lower.includes("code signature at url")) return true
  // Localized trailer ("code requirements not met") seen on the German build.
  if (lower.includes("code-anforderungen")) return true
  if (lower.includes("code signing requirement")) return true
  return false
}

function desktopReleaseDownloadUrl(version: string) {
  return `https://github.com/devinoldenburg/codeplane/releases/tag/${codeplaneDesktopReleaseTag(version)}`
}

// Latest desktop shell version reported by electron-updater. Cached so the
// status IPC can answer instantly between checks, and so we know which
// version is being downloaded when we eventually get update-downloaded.
let desktopShellLatestVersion: string | undefined
let desktopShellUpdateInFlight: Promise<{ current: string; latest: string | null; hasUpdate: boolean }> | undefined
// Once Squirrel.Mac rejects an update with a code-signature error in this
// session, every subsequent install attempt will fail the same way (the
// running app's signature doesn't change at runtime). Latch the state so we
// route the user straight to manual download instead of re-triggering the
// failing install path. Also set preemptively in setupAutoUpdater() when the
// running mac bundle has no Developer ID signature (CI builds with
// CSC_IDENTITY_AUTO_DISCOVERY=false) — we know in-place auto-update will
// always be rejected, so don't bother trying.
let desktopShellManualDownloadOnly = false

// Detect whether the running macOS bundle has a real Developer ID signature.
// Without one, Squirrel.Mac's in-place update is always rejected by
// SecCodeCheckValidity, so we preempt the failure and route to manual download.
// Returns true on non-mac (the check is irrelevant) so callers don't have to
// branch.
async function macOsHasDeveloperIdSignature(): Promise<boolean> {
  if (process.platform !== "darwin") return true
  if (!app.isPackaged) return true
  try {
    const exe = app.getPath("exe")
    return await new Promise<boolean>((resolve) => {
      execFile(
        "codesign",
        ["-dvv", exe],
        { timeout: 5_000, maxBuffer: 1024 * 64 },
        (err, _stdout, stderr) => {
          if (err) return resolve(false)
          const text = String(stderr ?? "")
          // Properly signed builds emit "Authority=Developer ID Application: …"
          // (or "Authority=Apple Distribution: …" for App Store builds).
          // Ad-hoc signed CI builds have "Signature=adhoc" and no Authority line.
          if (/Authority=Developer ID Application/i.test(text)) return resolve(true)
          if (/Authority=Apple Distribution/i.test(text)) return resolve(true)
          resolve(false)
        },
      )
    })
  } catch {
    return false
  }
}

async function shellUpdateStatus() {
  const current = app.getVersion()
  // In dev (unpackaged) electron-updater throws — surface the current shell
  // version and skip the network probe so the UI can render a clean idle state.
  if (!app.isPackaged) {
    return { current, latest: current, hasUpdate: false, method: "dev" as const }
  }
  if (!desktopShellUpdateInFlight) {
    desktopShellUpdateInFlight = (async () => {
      try {
        const result = await autoUpdater.checkForUpdates()
        const version = result?.updateInfo?.version ?? null
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
      // When we already know in-place install is impossible (unsigned mac
      // build), skip the "Install update" UI step and surface the manual
      // download URL immediately so the user can act on the very first
      // check without going through a guaranteed-to-fail download attempt.
      if (desktopShellManualDownloadOnly) {
        const url = desktopReleaseDownloadUrl(status.latest)
        logger.log("main", "updater.preempted-manual-download", { version: status.latest, url })
        broadcastUpdater("updater:requires-manual-download", {
          version: status.latest,
          url,
          reason:
            "This build of Codeplane Desktop is not code-signed with an Apple Developer ID, so macOS rejects in-place updates. Download the new version manually instead.",
        })
        return { ok: true as const, updateAvailable: true, version: status.latest, manualDownloadOnly: true as const }
      }
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

  if (desktopShellManualDownloadOnly) {
    const url = desktopReleaseDownloadUrl(version)
    logger.log("main", "updater.download.manual-required", { version, url })
    broadcastUpdater("updater:requires-manual-download", {
      version,
      url,
      reason: "Previous in-place update was rejected by macOS code-signature validation.",
    })
    return { ok: false as const, error: "Manual download required" }
  }

  logger.log("main", "updater.download.start", { version })
  desktopShellLatestVersion = version
  try {
    // electron-updater starts the download asynchronously and emits
    // download-progress / update-downloaded events. We let those events
    // drive the renderer; the eventual quitAndInstall lives in the
    // update-downloaded handler so the UI gets a chance to render the
    // "Restarting" state before the app exits.
    await autoUpdater.downloadUpdate()
    return { ok: true as const }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.log("main", "updater.download.error", { error: errorMessage })
    // Squirrel.Mac's code-signature failure surfaces both as an autoUpdater
    // 'error' event (handled in setupAutoUpdater, which routes the user to
    // manual download) AND a downloadUpdate() rejection. The event fires
    // synchronously before this catch runs and latches manualDownloadOnly,
    // so don't broadcast 'updater:error' here — it would clobber the
    // 'manual-required' state the renderer just transitioned into.
    if (desktopShellManualDownloadOnly || isCodeSignatureValidationError(errorMessage)) {
      return { ok: false as const, error: errorMessage }
    }
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

  // Restore window bounds.
  const bounds = store.get("windowBounds")
  if (bounds?.maximized) window.maximize()
  window.on("resize", saveBounds)
  window.on("move", saveBounds)
  window.on("maximize", saveBounds)
  window.on("unmaximize", saveBounds)

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
    const next = window.getBounds()
    store.set("windowBounds", { ...next, maximized: window.isMaximized() })
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
          click: () => void shell.openExternal("https://github.com/devinoldenburg/codeplane"),
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

function createWindowOptions(ses?: Session) {
  const bounds = store.get("windowBounds")
  const isMac = process.platform === "darwin"
  return {
    x: bounds?.x,
    y: bounds?.y,
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    minWidth: 800,
    minHeight: 480,
    // On macOS we let the native NSVisualEffectView material show through —
    // a transparent backgroundColor lets the renderer paint translucent
    // surfaces (titlebar, sidebar) on top of vibrancy. Other platforms keep
    // the opaque fallback so first paint never flashes white.
    backgroundColor: isMac ? "#00000000" : "#0e0e0e",
    show: false,
    icon: iconPath(),
    titleBarStyle: isMac ? "hiddenInset" : "default",
    // Align the traffic light cluster vertically with our 44px titlebar so
    // the close/min/zoom dots sit centered against the toolbar contents.
    ...(isMac ? { trafficLightPosition: { x: 18, y: 14 } } : {}),
    // Native macOS material — feels like a real Cocoa app instead of an
    // Electron shell painted with a flat color. `under-window` blends the
    // desktop wallpaper into the chrome, matching Finder / Mail / Notes.
    ...(isMac
      ? {
          vibrancy: "under-window" as const,
          visualEffectState: "followWindow" as const,
        }
      : {}),
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

function createWindow(editId?: string) {
  currentInstanceID = undefined
  const window = new BrowserWindow(createWindowOptions())
  attachWindowDebugLogging(window, "setup")
  window.once("ready-to-show", () => window.show())
  attachWindowHandlers(window)
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
        emit({ phase: "done", message: "Loading…", percent: 100, version: prepared.version })
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

async function openInstance(saved: SavedInstance, opts?: { progressTo?: WebContents }) {
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
      await showMessageBox({
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
    await showMessageBox({
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
    const previousBounds = previous && !previous.isDestroyed() ? previous.getBounds() : undefined
    const previousFullscreen = previous && !previous.isDestroyed() ? previous.isFullScreen() : false
    const previousMaximized = previous && !previous.isDestroyed() ? previous.isMaximized() : false

    const winOpts = createWindowOptions(ses)
    if (previousBounds) {
      winOpts.x = previousBounds.x
      winOpts.y = previousBounds.y
      winOpts.width = previousBounds.width
      winOpts.height = previousBounds.height
    }
    const window = new BrowserWindow(winOpts)
    attachWindowDebugLogging(window, "instance")
    // We deliberately do NOT auto-show on ready-to-show. The setup window
    // stays in front showing the loading overlay until the instance UI
    // is fully loaded, then we swap atomically below.
    attachWindowHandlers(window)
    if (previousFullscreen) window.setFullScreen(true)
    else if (previousMaximized) window.maximize()
    mainWindow = window
    currentInstanceID = instance.id
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
      emit({ phase: "done", message: "Loading…", percent: 100, version: prepared.version })
      await loadWindowUrl(window, prepared.url)
      attachServerVersionWatcher(window, instance, prepared.version)
    }

    // Atomically swap setup → instance. Hidden window starts at opacity 0
    // so the OS doesn't draw a frame before our crossfade begins.
    if (!window.isDestroyed()) {
      window.setOpacity(0)
      window.show()
      window.focus()
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
    await showMessageBox({
      type: "error",
      message: "Couldn't open this instance",
      detail: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

function showSetupWindow(editId?: string) {
  logger.log("main", "setup.open-window", { editId })
  const previous = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const next = createWindow(editId)
  if (previous && previous !== next && !previous.isDestroyed()) previous.close()
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
      event.returnValue = {
        currentKey: null,
        defaultKey: lastInstanceID() ? uiHost.proxyKey(lastInstanceID()!) : null,
        instances: [],
      }
    }
  })
  ipcMain.handle("desktop:log-path", () => logger.path())
  ipcMain.handle("instances:list", () => savedInstances())
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
}

let shellQuitAndInstallScheduled = false

function quitAndInstallShellUpdate(reason: string) {
  if (shellQuitAndInstallScheduled) return
  shellQuitAndInstallScheduled = true
  logger.log("main", "updater.quit-and-install", { reason })
  // isSilent=true skips the elevation dialog where applicable; the second
  // arg forces a relaunch so the user lands back in the app on the new
  // version. The before-quit handler still gets a chance to stop local
  // instances cleanly.
  try {
    autoUpdater.quitAndInstall(false, true)
  } catch (error) {
    logger.log("main", "updater.quit-and-install.error", { error })
    shellQuitAndInstallScheduled = false
  }
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

  // Drive the install ourselves once the user clicks "Install update", and
  // restart automatically when the download finishes so changes apply.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (...args: unknown[]) => logger.log("main", "updater.info", { args }),
    warn: (...args: unknown[]) => logger.log("main", "updater.warn", { args }),
    error: (...args: unknown[]) => logger.log("main", "updater.error", { args }),
    debug: (...args: unknown[]) => logger.log("main", "updater.debug", { args }),
  }

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    desktopShellLatestVersion = info.version
    broadcastUpdater("updater:update-available", { version: info.version })
  })
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    broadcastUpdater("updater:update-not-available", { version: info.version })
  })
  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    broadcastUpdater("updater:download-progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    })
  })
  autoUpdater.on("update-downloaded", (info: UpdateDownloadedEvent) => {
    desktopShellLatestVersion = info.version
    logger.log("main", "updater.download.success", { version: info.version })
    broadcastUpdater("updater:update-downloaded", { version: info.version })
    // Give the renderer a moment to render the "Restarting" state before
    // the app exits, then relaunch on the new shell so changes apply.
    setTimeout(() => quitAndInstallShellUpdate("download-complete"), 1_500)
  })
  autoUpdater.on("error", (error: Error) => {
    const message = error?.message ?? String(error)
    logger.log("main", "updater.error", { error: message })
    if (process.platform === "darwin" && isCodeSignatureValidationError(message)) {
      desktopShellManualDownloadOnly = true
      const version = desktopShellLatestVersion ?? null
      const url = version ? desktopReleaseDownloadUrl(version) : "https://github.com/devinoldenburg/codeplane/releases/latest"
      logger.log("main", "updater.requires-manual-download", { version, url, message })
      broadcastUpdater("updater:requires-manual-download", { version, url, reason: message })
      return
    }
    broadcastUpdater("updater:error", message)
  })

  // Preemptively flip the manual-download latch on unsigned mac builds so the
  // very first check goes straight to the manual-download UI instead of a
  // guaranteed-to-fail autoUpdater.downloadUpdate() attempt. The detection
  // runs in the background — runRuntimeUpdateCheck below will pick up the
  // updated flag on its own 5s-delayed first run.
  if (process.platform === "darwin") {
    void macOsHasDeveloperIdSignature().then((signed) => {
      if (signed) {
        logger.log("main", "updater.signature.developer-id", {})
        return
      }
      desktopShellManualDownloadOnly = true
      logger.log("main", "updater.signature.preempted-unsigned", {})
    })
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
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
    // Surface the prompt by not preventing default; Electron renders the
    // native dialog. If the page wants to handle it, it can listen on the
    // page's `did-get-redirect-request` itself.
    callback("", "")
    event.preventDefault()
  })

  app.whenReady().then(async () => {
    logger.log("main", "ready")
    applyRuntimeIcon()
    applyRuntimeMetadata()
    await loadInstanceState()
    setupIpc()
    setupAutoUpdater()
    void uiHost.cleanup()
    createWindow()

    buildMenu(
      () => mainWindow?.webContents.reload(),
      () => showSetupWindow(),
      () => showSetupWindow(),
    )

    app.on("activate", () => {
      logger.log("main", "activate")
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
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
