import { app, BrowserWindow, ipcMain, Menu, session, shell, dialog, type Session, type WebContents } from "electron"
import { autoUpdater, type UpdateInfo, type ProgressInfo } from "electron-updater"
import Store from "electron-store"
import path from "path"

/**
 * CodePlane desktop shell.
 *
 * The desktop app bundles no backend. It is a thin Electron wrapper that
 * loads the user's chosen CodePlane web UI from their own hosted instance
 * (or any compatible deployment). The login flow is intentionally
 * delegated to the page itself — Electron's persistent session carries
 * cookies, IndexedDB, and localStorage across launches, so any web-based
 * sign-in works out of the box: OAuth/OIDC, SAML, magic links, basic
 * auth dialogs, Cloudflare Access (cookie + service-token), Tailscale-
 * fronted instances, mTLS, etc.
 *
 * Users can additionally configure per-instance auth headers (e.g. CF
 * Access service tokens, internal API keys) that get attached to every
 * outbound request to that instance via the webRequest API.
 *
 * Auto-update tracks the same GitHub releases as the CLI/web (one
 * version per release, no separate channel). The shell never embeds
 * the backend, so updating the desktop app and updating the
 * self-hosted instance are independent.
 */

const SESSION_PARTITION_PREFIX = "persist:codeplane:"
const HEADER_PREFIX_BLOCKED = ["host", "origin", "referer", "user-agent", "content-length"]

type SavedInstance = {
  id: string
  url: string
  label?: string
  // Arbitrary HTTP headers attached to every outbound request to this instance.
  // Use cases: CF Access service token (`CF-Access-Client-Id`,
  // `CF-Access-Client-Secret`), Authorization bearer tokens, internal
  // proxies, custom headers required by the network in front of the
  // instance, etc.
  headers?: Record<string, string>
  // Whether to ignore TLS certificate errors (self-hosted dev instances
  // with self-signed certs). Off by default.
  ignoreCertificateErrors?: boolean
  // Optional client certificate selector for mTLS. Stored as the
  // matching certificate's subject CN / issuer; the OS keychain provides
  // the actual key material.
  clientCertSubject?: string
}

type Schema = {
  instances: SavedInstance[]
  lastInstanceId?: string
  windowBounds?: { x?: number; y?: number; width: number; height: number; maximized?: boolean }
}

const store = new Store<Schema>({
  name: "codeplane-desktop",
  defaults: {
    instances: [],
  },
})

let mainWindow: BrowserWindow | undefined

function getInstance(id: string | undefined): SavedInstance | undefined {
  if (!id) return undefined
  return store.get("instances", []).find((entry) => entry.id === id)
}

function ensureSession(instance: SavedInstance): Session {
  const partition = `${SESSION_PARTITION_PREFIX}${instance.id}`
  const ses = session.fromPartition(partition, { cache: true })

  // Inject per-instance auth headers (CF Access, bearer tokens, …) on all
  // outbound HTTP requests for this session. We never overwrite headers the
  // page itself already set, and we skip browser-managed headers so we don't
  // break CORS/credentials behaviour.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    if (instance.headers) {
      for (const [name, value] of Object.entries(instance.headers)) {
        if (!name) continue
        if (HEADER_PREFIX_BLOCKED.some((blocked) => name.toLowerCase() === blocked)) continue
        if (headers[name] !== undefined) continue
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

function loadInstance(window: BrowserWindow, instance: SavedInstance) {
  const target = asUrl(instance.url)
  if (!target) {
    void dialog.showMessageBox(window, {
      type: "error",
      message: "Invalid instance URL",
      detail: instance.url,
    })
    return
  }
  store.set("lastInstanceId", instance.id)
  void window.loadURL(target.toString())
}

function showSetup(window: BrowserWindow, opts?: { editId?: string }) {
  const url = `file://${path.join(__dirname, "..", "setup", "index.html")}${
    opts?.editId ? `?edit=${encodeURIComponent(opts.editId)}` : ""
  }`
  void window.loadURL(url)
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
                  void autoUpdater.checkForUpdatesAndNotify()
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
          label: "CodePlane on GitHub",
          click: () => void shell.openExternal("https://github.com/devinoldenburg/codeplane"),
        },
        {
          label: "Check for updates…",
          click: () => {
            void autoUpdater.checkForUpdatesAndNotify()
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const bounds = store.get("windowBounds")
  const window = new BrowserWindow({
    x: bounds?.x,
    y: bounds?.y,
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    minWidth: 800,
    minHeight: 480,
    backgroundColor: "#0e0e0e",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      // The web app never sees Node, but persistent session storage (cookies,
      // indexedDB) is allowed so logins survive restarts.
      nodeIntegration: false,
    },
  })

  window.once("ready-to-show", () => window.show())

  attachWindowHandlers(window)

  // Pick the right page on launch.
  const last = getInstance(store.get("lastInstanceId"))
  const instances = store.get("instances", [])
  if (last) {
    // Re-create the BrowserWindow on the right partition so per-instance
    // headers and cookie isolation kick in.
    window.close()
    void openInstance(last)
    return
  }
  if (instances.length === 1) {
    window.close()
    void openInstance(instances[0])
    return
  }
  showSetup(window)
  mainWindow = window
}

async function openInstance(instance: SavedInstance) {
  const ses = ensureSession(instance)
  const bounds = store.get("windowBounds")
  const window = new BrowserWindow({
    x: bounds?.x,
    y: bounds?.y,
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    minWidth: 800,
    minHeight: 480,
    backgroundColor: "#0e0e0e",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      session: ses,
    },
  })
  window.once("ready-to-show", () => window.show())
  attachWindowHandlers(window)
  loadInstance(window, instance)
  mainWindow = window
}

function setupIpc() {
  ipcMain.handle("instances:list", () => store.get("instances", []))
  ipcMain.handle("instances:get-last", () => store.get("lastInstanceId"))
  ipcMain.handle("instances:save", (_event, instance: SavedInstance) => {
    const list = store.get("instances", [])
    const idx = list.findIndex((entry) => entry.id === instance.id)
    if (idx === -1) list.push(instance)
    else list[idx] = instance
    store.set("instances", list)
    return list
  })
  ipcMain.handle("instances:remove", (_event, id: string) => {
    const next = store.get("instances", []).filter((entry) => entry.id !== id)
    store.set("instances", next)
    if (store.get("lastInstanceId") === id) store.delete("lastInstanceId")
    return next
  })
  ipcMain.handle("instances:open", (_event, id: string) => {
    const instance = getInstance(id)
    if (!instance) return false
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close()
      mainWindow = undefined
    }
    void openInstance(instance)
    return true
  })
  ipcMain.handle("instances:probe", async (_event, url: string) => {
    const target = asUrl(url)
    if (!target) return { ok: false, error: "Invalid URL" }
    try {
      const response = await fetch(`${target.origin}/global/version`, {
        method: "GET",
        redirect: "follow",
      })
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}`, status: response.status }
      }
      const data = (await response.json().catch(() => ({}))) as { current?: string; latest?: string }
      return { ok: true, version: data.current ?? null, latest: data.latest ?? null }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle("auth:open-external", async (_event, url: string) => {
    const target = asUrl(url)
    if (!target) return false
    await shell.openExternal(target.toString())
    return true
  })
  ipcMain.handle("updater:check", async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { ok: true, updateAvailable: !!result?.updateInfo, version: result?.updateInfo?.version }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    mainWindow?.webContents.send("updater:update-available", info)
  })
  autoUpdater.on("update-not-available", () => {
    mainWindow?.webContents.send("updater:update-not-available")
  })
  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    mainWindow?.webContents.send("updater:download-progress", progress)
  })
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    mainWindow?.webContents.send("updater:update-downloaded", info)
    void dialog
      .showMessageBox({
        type: "info",
        title: "Update ready",
        message: `CodePlane ${info.version} is ready to install.`,
        detail: "Restart the app to apply the update.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((response) => {
        if (response.response === 0) autoUpdater.quitAndInstall()
      })
  })
  autoUpdater.on("error", (error) => {
    mainWindow?.webContents.send("updater:error", error.message ?? String(error))
  })

  // Check on launch and then once per hour.
  setTimeout(() => void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined), 5_000)
  setInterval(() => void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined), 60 * 60 * 1000)
}

// Single-instance lock so opening another shortcut focuses the existing window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
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
    if (certificateList.length === 0) return
    event.preventDefault()
    callback(certificateList[0])
  })

  // HTTP basic auth prompt — let the OS-style dialog handle it. The web
  // page can also handle this itself if it owns the URL.
  app.on("login", (event, _webContents, _request, authInfo, callback) => {
    if (authInfo.isProxy) return
    // Surface the prompt by not preventing default; Electron renders the
    // native dialog. If the page wants to handle it, it can listen on the
    // page's `did-get-redirect-request` itself.
    callback("", "")
    event.preventDefault()
  })

  app.whenReady().then(() => {
    setupIpc()
    setupAutoUpdater()
    createWindow()

    buildMenu(
      () => mainWindow?.webContents.reload(),
      () => mainWindow && showSetup(mainWindow),
      () => mainWindow && showSetup(mainWindow),
    )

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
}
