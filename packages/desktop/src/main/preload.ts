import { contextBridge, ipcRenderer } from "electron"
import type {
  LocalInstallProgress,
  LocalStatus,
  LocalTarget,
  OpenProgress,
  PrepareProgress,
  SavedInstance,
} from "@codeplane-ai/shared/instance"

type DesktopStorageApi = {
  getItem: (storageName: string | undefined, key: string) => string | null
  setItem: (storageName: string | undefined, key: string, value: string) => void
  removeItem: (storageName: string | undefined, key: string) => void
}

type DesktopNotificationApi = {
  isSupported: () => Promise<boolean>
  notify: (input: { title: string; description?: string; href?: string }) => Promise<boolean>
  onClick: (cb: (href?: string) => void) => () => void
}

type DesktopInstanceCacheInfo = {
  exists: boolean
  bytes: number
  areas: Array<{
    key: string
    label: string
    path: string
    bytes: number
  }>
  desktopUI: {
    exists: boolean
    bytes: number
    versions: string[]
  }
}

const bootstrap = ipcRenderer.sendSync("desktop:bootstrap") as {
  currentKey: string | null
  defaultKey: string | null
  instances: Array<{
    id: string
    key: string
    label?: string
    local?: boolean
    proxyUrl: string
    remoteUrl: string
  }>
}

type WindowState = {
  fullscreen: boolean
  focused: boolean
  maximized: boolean
  platform: NodeJS.Platform
}

const windowStateSnapshot = ipcRenderer.sendSync("window:state-snapshot") as WindowState

const api = {
  version: ipcRenderer.sendSync("app:version") as string,
  storage: {
    getItem: (storageName: string | undefined, key: string) =>
      ipcRenderer.sendSync("storage:get", storageName, key) as string | null,
    setItem: (storageName: string | undefined, key: string, value: string) => {
      ipcRenderer.sendSync("storage:set", storageName, key, value)
    },
    removeItem: (storageName: string | undefined, key: string) => {
      ipcRenderer.sendSync("storage:remove", storageName, key)
    },
  } satisfies DesktopStorageApi,
  serverManager: {
    currentKey: bootstrap.currentKey,
    defaultKey: bootstrap.defaultKey,
    instances: bootstrap.instances,
    getDefaultKey: () => ipcRenderer.invoke("instances:get-default-key") as Promise<string | null>,
    setDefaultKey: (key: string | null) => ipcRenderer.invoke("instances:set-default-key", key) as Promise<boolean>,
    open: (id: string) => ipcRenderer.invoke("instances:open", id) as Promise<boolean>,
    openLogDir: (id: string) => ipcRenderer.invoke("instances:open-log-dir", id) as Promise<boolean>,
    show: (editId?: string) => ipcRenderer.invoke("instances:show-setup", editId) as Promise<boolean>,
  },
  instances: {
    list: () => ipcRenderer.invoke("instances:list") as Promise<SavedInstance[]>,
    getLastId: () => ipcRenderer.invoke("instances:get-last") as Promise<string | undefined>,
    save: (instance: SavedInstance) => ipcRenderer.invoke("instances:save", instance) as Promise<SavedInstance[]>,
    prepare: (instance: SavedInstance) =>
      ipcRenderer.invoke("instances:prepare", instance) as Promise<
        | { ok: true; url: string; version: string }
        | { ok: false; error: string; authUrl?: string }
      >,
    remove: (id: string) => ipcRenderer.invoke("instances:remove", id) as Promise<SavedInstance[]>,
    cacheInfo: (id: string) => ipcRenderer.invoke("instances:cache-info", id) as Promise<DesktopInstanceCacheInfo>,
    clearCache: (id: string) =>
      ipcRenderer.invoke("instances:clear-cache", id) as Promise<
        { ok: true; cleared: DesktopInstanceCacheInfo } | { ok: false; error: string }
      >,
    open: (id: string) => ipcRenderer.invoke("instances:open", id) as Promise<boolean>,
    showSetup: (editId?: string) => ipcRenderer.invoke("instances:show-setup", editId) as Promise<boolean>,
    onPrepareProgress: (cb: (info: PrepareProgress) => void) => {
      const listener = (_event: unknown, info: PrepareProgress) => cb(info)
      ipcRenderer.on("instances:prepare-progress", listener)
      return () => ipcRenderer.removeListener("instances:prepare-progress", listener)
    },
    onOpenProgress: (cb: (info: OpenProgress) => void) => {
      const listener = (_event: unknown, info: OpenProgress) => cb(info)
      ipcRenderer.on("instances:open-progress", listener)
      return () => ipcRenderer.removeListener("instances:open-progress", listener)
    },
    probe: (input: string | SavedInstance) =>
      ipcRenderer.invoke("instances:probe", input) as Promise<{
        ok: boolean
        version?: string | null
        latest?: string | null
        status?: number
        error?: string
      }>,
    signInWithBrowser: (input: { id: string; url: string }) =>
      ipcRenderer.invoke("instances:sign-in-with-browser", input) as Promise<
        { ok: true; cookieHeader: string; cookieCount: number } | { ok: false; error: string }
      >,
  },
  auth: {
    openExternal: (url: string) => ipcRenderer.invoke("auth:open-external", url) as Promise<boolean>,
  },
  mcp: {
    // Open the embedded OAuth window for a remote MCP server. Returns once the
    // window has been launched (not when auth completes — the renderer polls
    // mcp.status for that).
    authorize: (input: { name: string; authorizationUrl: string; redirectUri: string }) =>
      ipcRenderer.invoke("mcp:authorize", input) as Promise<{ ok: true } | { ok: false; error: string }>,
  },
  notifications: {
    isSupported: () => ipcRenderer.invoke("notifications:is-supported") as Promise<boolean>,
    notify: (input: { title: string; description?: string; href?: string }) =>
      ipcRenderer.invoke("notifications:notify", input) as Promise<boolean>,
    onClick: (cb: (href?: string) => void) => {
      const listener = (_event: unknown, href?: string) => cb(href)
      ipcRenderer.on("notifications:click", listener)
      return () => ipcRenderer.removeListener("notifications:click", listener)
    },
  } satisfies DesktopNotificationApi,
  local: {
    target: () => ipcRenderer.invoke("local:target") as Promise<LocalTarget>,
    listVersions: () =>
      ipcRenderer.invoke("local:list-versions") as Promise<
        | { ok: true; latest?: string; distTags: Record<string, string>; versions: string[] }
        | { ok: false; error: string }
      >,
    status: (version?: string) => ipcRenderer.invoke("local:status", version) as Promise<LocalStatus>,
    install: (input: { version?: string }) =>
      ipcRenderer.invoke("local:install", input) as Promise<
        | ({ ok: true } & LocalStatus)
        | { ok: false; error: string }
      >,
    start: (input: { id: string; binaryVersion: string }) =>
      ipcRenderer.invoke("local:start", input) as Promise<
        | { ok: true; id: string; binaryVersion: string; port: number; url: string }
        | { ok: false; error: string }
      >,
    stop: (id: string) => ipcRenderer.invoke("local:stop", id) as Promise<boolean>,
    running: () => ipcRenderer.invoke("local:running") as Promise<string[]>,
    onInstallProgress: (cb: (info: LocalInstallProgress) => void) => {
      const listener = (_event: unknown, info: LocalInstallProgress) => cb(info)
      ipcRenderer.on("local:install-progress", listener)
      return () => ipcRenderer.removeListener("local:install-progress", listener)
    },
  },
  debug: {
    log: (event: string, data?: unknown, scope = "renderer") => ipcRenderer.send("desktop:log", { data, event, scope }),
    logPath: () => ipcRenderer.invoke("desktop:log-path") as Promise<string>,
  },
  // Window state — used by the renderer to drop the traffic-light gutter
  // when the user enters macOS fullscreen and to dim chrome on blur the
  // way native macOS apps do.
  window: {
    state: windowStateSnapshot,
    onStateChange: (cb: (state: Omit<WindowState, "platform">) => void) => {
      const listener = (_event: unknown, state: Omit<WindowState, "platform">) => cb(state)
      ipcRenderer.on("window:state", listener)
      return () => ipcRenderer.removeListener("window:state", listener)
    },
  },
  // Desktop shell updater. Drives electron-updater against the GitHub
  // releases for this app, downloads the installer for the current
  // platform, then quits-and-installs to relaunch on the new version.
  desktopUpdater: {
    status: () =>
      ipcRenderer.invoke("updater:status") as Promise<{
        current: string
        latest: string | null
        hasUpdate: boolean
        method: string
      }>,
    check: () =>
      ipcRenderer.invoke("updater:check") as Promise<
        { ok: true; updateAvailable: boolean; version?: string } | { ok: false; error: string }
      >,
    download: () =>
      ipcRenderer.invoke("updater:download") as Promise<
        { ok: true; mocked?: boolean } | { ok: false; error: string }
      >,
    install: () =>
      ipcRenderer.invoke("updater:install") as Promise<{ ok: true; mocked?: boolean }>,
    releaseNotes: (version: string) =>
      ipcRenderer.invoke("updater:release-notes", version) as Promise<{
        tag: string
        name: string | null
        body: string | null
        url: string | null
        publishedAt: string | null
      } | null>,
    onUpdateAvailable: (cb: (info: { version: string }) => void) => {
      const listener = (_event: unknown, info: { version: string }) => cb(info)
      ipcRenderer.on("updater:update-available", listener)
      return () => ipcRenderer.removeListener("updater:update-available", listener)
    },
    onUpdateNotAvailable: (cb: (info: { version: string } | undefined) => void) => {
      const listener = (_event: unknown, info: { version: string } | undefined) => cb(info)
      ipcRenderer.on("updater:update-not-available", listener)
      return () => ipcRenderer.removeListener("updater:update-not-available", listener)
    },
    onUpdateDownloaded: (cb: (info: { version: string }) => void) => {
      const listener = (_event: unknown, info: { version: string }) => cb(info)
      ipcRenderer.on("updater:update-downloaded", listener)
      return () => ipcRenderer.removeListener("updater:update-downloaded", listener)
    },
    onProgress: (cb: (info: { percent: number; transferred: number; total: number }) => void) => {
      const listener = (
        _event: unknown,
        info: { percent: number; transferred: number; total: number },
      ) => cb(info)
      ipcRenderer.on("updater:download-progress", listener)
      return () => ipcRenderer.removeListener("updater:download-progress", listener)
    },
    onError: (cb: (message: string) => void) => {
      const listener = (_event: unknown, message: string) => cb(message)
      ipcRenderer.on("updater:error", listener)
      return () => ipcRenderer.removeListener("updater:error", listener)
    },
    onRequiresManualDownload: (
      cb: (info: { version: string | null; url: string; reason: string }) => void,
    ) => {
      const listener = (
        _event: unknown,
        info: { version: string | null; url: string; reason: string },
      ) => cb(info)
      ipcRenderer.on("updater:requires-manual-download", listener)
      return () => ipcRenderer.removeListener("updater:requires-manual-download", listener)
    },
  },
  platform: process.platform,
  systemPermissions: {
    check: () =>
      ipcRenderer.invoke("system-permissions:check") as Promise<{
        platform: string
        permissions: {
          key: string
          label: string
          granted: boolean
          active?: boolean
          restartRequired?: boolean
          preferencePane?: string
        }[]
      }>,
    request: (permissionKey: string) =>
      ipcRenderer.invoke("system-permissions:request", permissionKey) as Promise<boolean>,
  },
  // Quit and immediately relaunch the Electron shell. macOS TCC entries
  // are read at process start, so granting Accessibility / Screen Recording
  // mid-session has no effect until the app restarts — this gives the
  // permissions dialog a one-click way to do that.
  relaunchShell: () =>
    ipcRenderer.invoke("app:relaunch-shell") as Promise<{ ok: true } | { ok: false; error: string }>,
}

contextBridge.exposeInMainWorld("codeplaneDesktop", api)

export type CodeplaneDesktopAPI = typeof api
