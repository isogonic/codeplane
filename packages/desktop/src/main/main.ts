import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  dialog,
  type MessageBoxOptions,
  type Session,
  type WebContents,
} from "electron"
import { autoUpdater, type UpdateInfo, type ProgressInfo } from "electron-updater"
import Store from "electron-store"
import { CodeplaneDesktopReleaseSuffix, codeplaneDesktopReleaseTag } from "@codeplane-ai/shared/version"
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
import { CodeplaneVersion } from "@codeplane-ai/shared/version"
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
 * Auto-update tracks dedicated desktop releases (`vX.Y.Z-desktop`)
 * from the same repo. The shell never embeds the backend, so updating
 * the desktop app and updating the self-hosted instance are independent.
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
const GITHUB_RELEASE_DOWNLOAD_URL = "https://github.com/devinoldenburg/codeplane/releases/download"
const DESKTOP_RELEASE_SUFFIX = CodeplaneDesktopReleaseSuffix
const DESKTOP_STORAGE_DIRECT = "__direct__"
const APP_ID = "ai.codeplane.desktop"
const APP_NAME = "Codeplane"
const APP_COPYRIGHT = "Copyright © 2026 Devin Oldenburg"
const APP_WEBSITE = "https://codeplane.ai"
const USER_DATA_OVERRIDE = process.env.CODEPLANE_DESKTOP_USER_DATA_DIR?.trim()
const LEGACY_USER_DATA_NAME = "@codeplane-ai/desktop"

if (USER_DATA_OVERRIDE) {
  app.setPath("userData", USER_DATA_OVERRIDE)
} else {
  const legacyUserData = path.join(app.getPath("appData"), LEGACY_USER_DATA_NAME)
  if (existsSync(legacyUserData)) app.setPath("userData", legacyUserData)
}

type DesktopPersist = Record<string, Record<string, string>>

type Schema = {
  instances: SavedInstance[]
  lastInstanceId?: string
  persist?: DesktopPersist
  windowBounds?: { x?: number; y?: number; width: number; height: number; maximized?: boolean }
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
const logger = createDesktopLogger(process.env.CODEPLANE_DESKTOP_LOG_DIR?.trim() || path.join(app.getPath("userData"), "logs"))

let mainWindow: BrowserWindow | undefined
let currentInstanceID: string | undefined
const configuredPartitions = new Set<string>()
const localManager = createLocalInstanceManager({
  binariesDir: path.join(app.getPath("userData"), "local-binaries"),
  dataDir: app.getPath("userData"),
  log: (event, data) => logger.log("local-instance", event, data),
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
  cwd: process.cwd(),
  logPath: logger.path(),
  userData: app.getPath("userData"),
})

function getInstance(id: string | undefined): SavedInstance | undefined {
  if (!id) return undefined
  return store.get("instances", []).find((entry) => entry.id === id)
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

async function ensureLocalRunning(instance: SavedInstance): Promise<SavedInstance> {
  if (!instance.local) return instance
  const existing = localManager.getRunning(instance.id)
  if (existing) return { ...instance, url: existing.url }
  const running = await localManager.start({
    id: instance.id,
    binaryVersion: instance.local.binaryVersion,
  })
  return { ...instance, url: running.url }
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
      current: app.getVersion(),
      latest: app.getVersion(),
      hasUpdate: false,
      method: "desktop-mock",
    }
  }
  if (mode.startsWith("available:")) {
    const latest = mode.slice("available:".length) || app.getVersion()
    return {
      current: app.getVersion(),
      latest,
      hasUpdate: compareVersions(latest, app.getVersion()) > 0,
      method: "desktop-mock",
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
    const version = mode.slice("available:".length) || app.getVersion()
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
  const target = asUrl(instance.url)

  // Inject per-instance auth headers (CF Access, bearer tokens, …) on all
  // outbound HTTP requests for this session. We never overwrite headers the
  // page itself already set, and we skip browser-managed headers so we don't
  // break CORS/credentials behaviour.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    const current = target ? asUrl(details.url) : undefined
    const targetPath = target?.pathname.replace(/\/+$/, "") || "/"
    const matchesTarget =
      !!target &&
      !!current &&
      current.origin === target.origin &&
      (current.pathname === targetPath || current.pathname.startsWith(`${targetPath === "/" ? "" : targetPath}/`))
    if (instance.headers) {
      for (const [name, value] of Object.entries(instance.headers)) {
        if (!name) continue
        if (HEADER_PREFIX_BLOCKED.some((blocked) => name.toLowerCase() === blocked)) continue
        if (headers[name] !== undefined) continue
        if (!matchesTarget && details.url !== target?.toString()) continue
        headers[name] = value
      }
    }
    callback({ requestHeaders: headers })
  })

  // mTLS / client certificate selection — flexible, not tied to any one
  // identity provider. Looks up the cert by the subject CN the user
  // recorded in setup; macOS Keychain / Windows Cert Store / NSS DB on
  // Linux supplies the private key.
  ses.setCertificateVerifyProc((request, callback) => {
    if (instance.ignoreCertificateErrors) {
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
    },
  )
  window.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    logger.log("window", "did-navigate-in-page", { id: window.id, isMainFrame, name, url })
  })
  window.webContents.on("render-process-gone", (_event, details) => {
    logger.log("window", "render-process-gone", { details, id: window.id, name })
  })
}

function showSetup(window: BrowserWindow, opts?: { editId?: string }) {
  const url = pathToFileURL(getAppAssetPath("dist", "setup", "index.html"))
  if (opts?.editId) {
    url.searchParams.set("edit", opts.editId)
  }
  logger.log("main", "setup.show", { editId: opts?.editId, url: url.toString(), windowId: window.id })
  void window.loadURL(url.toString())
}

function desktopReleaseVersion(input: string) {
  return input.trim().replace(/^v/, "").replace(new RegExp(`${DESKTOP_RELEASE_SUFFIX}$`), "")
}

function compareVersions(a: string, b: string) {
  const left = desktopReleaseVersion(a)
    .split(".")
    .map((value) => Number.parseInt(value, 10))
    .map((value) => (Number.isFinite(value) ? value : 0))
  const right = desktopReleaseVersion(b)
    .split(".")
    .map((value) => Number.parseInt(value, 10))
    .map((value) => (Number.isFinite(value) ? value : 0))
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const next = (left[i] ?? 0) - (right[i] ?? 0)
    if (next !== 0) return next
  }
  return 0
}

function desktopReleaseTag(version: string) {
  return codeplaneDesktopReleaseTag(desktopReleaseVersion(version))
}

async function resolveDesktopReleaseTag() {
  const releasesResponse = await fetch(`${GITHUB_RELEASES_API_URL}?per_page=100`, {
    headers: await githubApiHeaders(),
  })
  if (!releasesResponse.ok) {
    throw new Error(`GitHub desktop release lookup failed with HTTP ${releasesResponse.status}`)
  }
  const releases = ((await releasesResponse.json()) as GitHubRelease[])
    .filter((release) => release.tag_name?.endsWith(DESKTOP_RELEASE_SUFFIX) && !release.draft && !release.prerelease)
    .sort((a, b) => compareVersions(b.tag_name ?? "", a.tag_name ?? ""))
  return releases[0]?.tag_name
}

async function getDesktopUpdateStatus() {
  const mocked = mockUpdateStatus()
  if (mocked) return mocked
  const current = app.getVersion()
  const latestTag = await resolveDesktopReleaseTag()
  const latest = latestTag ? desktopReleaseVersion(latestTag) : null
  return {
    current,
    latest,
    hasUpdate: !!latest && compareVersions(latest, current) > 0,
    method: "desktop",
  }
}

async function getDesktopReleaseNotes(version: string) {
  const response = await fetch(`${GITHUB_RELEASES_API_URL}/tags/${desktopReleaseTag(version)}`, {
    headers: await githubApiHeaders(),
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`GitHub desktop release notes lookup failed with HTTP ${response.status}`)
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

async function configureDesktopUpdater(desktopTag: string) {
  const token = await resolveGithubToken()
  autoUpdater.setFeedURL({
    provider: "generic",
    url: `${GITHUB_RELEASE_DOWNLOAD_URL}/${desktopTag}`,
    ...(token ? { requestHeaders: { Authorization: `Bearer ${token}` } } : {}),
  } as Parameters<typeof autoUpdater.setFeedURL>[0])
  autoUpdater.previousBlockmapBaseUrlOverride = `${GITHUB_RELEASE_DOWNLOAD_URL}/v${app.getVersion()}${DESKTOP_RELEASE_SUFFIX}`
}

async function runDesktopUpdateCheck<T>(action: () => Promise<T>) {
  const desktopTag = await resolveDesktopReleaseTag()
  if (!desktopTag) return null
  await configureDesktopUpdater(desktopTag)
  return action()
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
    const instances = store.get("instances", [])
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
                  void runDesktopUpdateCheck(() => autoUpdater.checkForUpdatesAndNotify())
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
            void runDesktopUpdateCheck(() => autoUpdater.checkForUpdatesAndNotify())
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

function attachInteractiveBootstrap(window: BrowserWindow, instance: SavedInstance) {
  let closed = false
  let inflight: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const currentOrigin = asUrl(instance.url)?.origin

  const cleanup = () => {
    closed = true
    if (timer) clearTimeout(timer)
    timer = undefined
    window.webContents.removeListener("did-finish-load", onLoad)
    window.webContents.removeListener("did-navigate", onNavigate)
    window.webContents.removeListener("did-navigate-in-page", onNavigateInPage)
    window.removeListener("closed", cleanup)
  }

  const attempt = () => {
    if (closed || inflight || window.isDestroyed()) return
    inflight = uiHost
      .prepare(instance)
      .then(async (prepared) => {
        logger.log("main", "instance.bootstrap.ready", { prepared, ...instanceSummary(instance) })
        cleanup()
        await loadWindowUrl(window, prepared.url)
        logger.log("main", "instance.bootstrap.success", { prepared, ...instanceSummary(instance) })
      })
      .catch((error) => {
        if (error instanceof DesktopVersionAuthRequiredError) {
          logger.log("main", "instance.bootstrap.wait-auth", {
            authUrl: error.authUrl,
            ...instanceSummary(instance),
          })
          return
        }
        logger.log("main", "instance.bootstrap.error", { error, ...instanceSummary(instance) })
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
    store.set("lastInstanceId", instance.id)
    const prepared = await uiHost
      .prepare(instance, (progress: DesktopUIPrepareProgress) => emit(progress))
      .catch(async (error) => {
      if (!(error instanceof DesktopVersionAuthRequiredError)) throw error
      logger.log("main", "instance.open.auth-required", {
        authUrl: error.authUrl,
        ...instanceSummary(instance),
      })
      attachInteractiveBootstrap(window, instance)
      await loadWindowUrl(window, error.authUrl)
      return
    })
    if (prepared) {
      emit({ phase: "done", message: "Loading…", percent: 100, version: prepared.version })
      await loadWindowUrl(window, prepared.url)
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
      const instances = store.get("instances", [])
      const bootstrap = uiHost.bootstrap(instances, currentInstanceID)
      const defaultID = store.get("lastInstanceId")
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
        defaultKey: store.get("lastInstanceId") ? uiHost.proxyKey(store.get("lastInstanceId")!) : null,
        instances: [],
      }
    }
  })
  ipcMain.handle("desktop:log-path", () => logger.path())
  ipcMain.handle("instances:list", () => store.get("instances", []))
  ipcMain.handle("instances:get-default-key", () => {
    const defaultID = store.get("lastInstanceId")
    return defaultID ? uiHost.proxyKey(defaultID) : null
  })
  ipcMain.handle("instances:get-last", () => store.get("lastInstanceId"))
  ipcMain.handle("instances:save", (_event, instance: SavedInstance) => {
    logger.log("main", "instances.save", instanceSummary(instance))
    const list = store.get("instances", [])
    const idx = list.findIndex((entry) => entry.id === instance.id)
    if (idx === -1) list.push(instance)
    else list[idx] = instance
    store.set("instances", list)
    return list
  })
  ipcMain.handle("instances:prepare", async (event, saved: SavedInstance) => {
    logger.log("main", "instances.prepare.start", instanceSummary(saved))
    let instance = saved
    if (saved.local) {
      try {
        instance = await ensureLocalRunning(saved)
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
    const list = store.get("instances", [])
    const target = list.find((entry) => entry.id === id)
    const next = list.filter((entry) => entry.id !== id)
    store.set("instances", next)
    if (store.get("lastInstanceId") === id) store.delete("lastInstanceId")
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
    const instances = store.get("instances", [])
    const match = key ? instances.find((instance) => uiHost.proxyKey(instance.id) === key) : undefined
    if (match) {
      store.set("lastInstanceId", match.id)
      return true
    }
    store.delete("lastInstanceId")
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
  ipcMain.handle("local:target", () => ({
    archiveName: localManager.target.archiveName,
    archiveExt: localManager.target.archiveExt,
    binaryName: localManager.target.binaryName,
    os: localManager.target.os,
    arch: localManager.target.arch,
    defaultVersion: CodeplaneVersion,
  }))
  ipcMain.handle("local:status", async (_event, version: string) => {
    const status = await localManager.status(version || CodeplaneVersion)
    logger.log("main", "local.status", status)
    return status
  })
  ipcMain.handle("local:install", async (event, input: { version?: string }) => {
    const version = input?.version || CodeplaneVersion
    logger.log("main", "local.install.start", { version })
    try {
      const result = await localManager.download(version, (progress: LocalInstanceProgress) => {
        event.sender.send("local:install-progress", { version, ...progress })
      })
      logger.log("main", "local.install.success", result)
      return { ok: true as const, ...result }
    } catch (error) {
      logger.log("main", "local.install.error", { error, version })
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle("local:start", async (_event, input: { id: string; binaryVersion: string }) => {
    logger.log("main", "local.start.request", input)
    try {
      const running = await localManager.start(input)
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
    for (const instance of store.get("instances", [])) {
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
  ipcMain.handle("updater:status", async () => {
    const status = await getDesktopUpdateStatus()
    logger.log("main", "updater.status", status)
    return status
  })
  ipcMain.handle("updater:check", async () => {
    const mocked = mockUpdateCheckResult()
    if (mocked) {
      logger.log("main", "updater.check.mock", mocked)
      return mocked
    }
    try {
      const result = await runDesktopUpdateCheck(() => autoUpdater.checkForUpdates())
      const response = { ok: true as const, updateAvailable: !!result?.updateInfo, version: result?.updateInfo?.version }
      logger.log("main", "updater.check", response)
      return response
    } catch (error) {
      const response = { ok: false as const, error: error instanceof Error ? error.message : String(error) }
      logger.log("main", "updater.check.error", response)
      return response
    }
  })
  ipcMain.handle("updater:release-notes", async (_event, version: string) => {
    const result = await getDesktopReleaseNotes(version)
    logger.log("main", "updater.release-notes", { found: !!result, version })
    return result
  })
  // Manually start the download. Auto-update already flips `autoDownload`
  // on, so this is mostly here so the renderer can drive the flow with
  // explicit user intent and stay in lockstep with the inline UI.
  ipcMain.handle("updater:download", async () => {
    if (mockUpdaterMode()) {
      logger.log("main", "updater.download.mock")
      return { ok: true as const, mocked: true }
    }
    try {
      await runDesktopUpdateCheck(async () => {
        await autoUpdater.downloadUpdate()
      })
      logger.log("main", "updater.download.requested")
      return { ok: true as const }
    } catch (error) {
      const response = { ok: false as const, error: error instanceof Error ? error.message : String(error) }
      logger.log("main", "updater.download.error", response)
      return response
    }
  })
  // Quit and apply the downloaded installer. The renderer decides when —
  // we never auto-restart the user out from under their work.
  ipcMain.handle("updater:install", () => {
    if (mockUpdaterMode()) {
      logger.log("main", "updater.install.mock")
      return { ok: true as const, mocked: true }
    }
    logger.log("main", "updater.install.requested")
    setImmediate(() => autoUpdater.quitAndInstall())
    return { ok: true as const }
  })
}

function setupAutoUpdater() {
  if (process.env.CODEPLANE_DESKTOP_DISABLE_AUTO_UPDATE === "1" || mockUpdaterMode()) {
    logger.log("main", "updater.disabled", {
      disableEnv: process.env.CODEPLANE_DESKTOP_DISABLE_AUTO_UPDATE === "1",
      mockMode: mockUpdaterMode() || null,
    })
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  // Broadcast updater events to every open window so each surface
  // (selector card, instance window banners) can render its own state.
  const broadcastUpdater = (channel: string, payload?: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      window.webContents.send(channel, payload)
    }
  }
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    logger.log("main", "updater.update-available", info)
    broadcastUpdater("updater:update-available", info)
  })
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    logger.log("main", "updater.update-not-available", info)
    broadcastUpdater("updater:update-not-available", info)
  })
  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    logger.log("main", "updater.download-progress", progress)
    broadcastUpdater("updater:download-progress", progress)
  })
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    logger.log("main", "updater.update-downloaded", info)
    broadcastUpdater("updater:update-downloaded", info)
    // No native dialog — the renderer owns the install UX. We still apply
    // on quit via `autoInstallOnAppQuit` so the update is never lost.
  })
  autoUpdater.on("error", (error) => {
    logger.log("main", "updater.error", error)
    broadcastUpdater("updater:error", error.message ?? String(error))
  })

  // Check on launch and then once per hour.
  setTimeout(() => void runDesktopUpdateCheck(() => autoUpdater.checkForUpdatesAndNotify()).catch(() => undefined), 5_000)
  setInterval(() => void runDesktopUpdateCheck(() => autoUpdater.checkForUpdatesAndNotify()).catch(() => undefined), 60 * 60 * 1000)
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

  app.whenReady().then(() => {
    logger.log("main", "ready")
    applyRuntimeIcon()
    applyRuntimeMetadata()
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
  app.on("before-quit", () => {
    logger.log("main", "before-quit.local-stop", { count: store.get("instances", []).filter((i) => i.local).length })
    void localManager.stopAll()
  })
}
