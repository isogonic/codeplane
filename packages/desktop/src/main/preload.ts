import { contextBridge, ipcRenderer } from "electron"

type SavedInstance = {
  id: string
  url: string
  label?: string
  headers?: Record<string, string>
  ignoreCertificateErrors?: boolean
  clientCertSubject?: string
  iconDataUrl?: string
  local?: {
    binaryVersion: string
  }
}

type PrepareProgress = {
  instanceID: string
  phase: "probe" | "download" | "finalize" | "done"
  message: string
  percent: number
  version?: string
  completed?: number
  total?: number
  cacheHit?: boolean
}

type OpenProgress = {
  instanceID: string
  phase: "probe" | "download" | "finalize" | "done" | "error"
  message: string
  percent: number
  version?: string
  completed?: number
  total?: number
  cacheHit?: boolean
}

type LocalInstallProgress = {
  version: string
  phase: "detect" | "download" | "extract" | "start" | "ready"
  message: string
  percent: number
  binaryVersion?: string
  transferred?: number
  total?: number
}

type LocalTarget = {
  archiveName: string
  archiveExt: ".zip" | ".tar.gz"
  binaryName: string
  os: "darwin" | "linux" | "windows"
  arch: "x64" | "arm64"
  defaultVersion: string
}

type LocalStatus = {
  binaryVersion: string
  installed: boolean
  binaryPath: string
  archive: string
}

const bootstrap = ipcRenderer.sendSync("desktop:bootstrap") as {
  currentKey: string | null
  defaultKey: string | null
  instances: Array<{
    id: string
    key: string
    label?: string
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
  serverManager: {
    currentKey: bootstrap.currentKey,
    defaultKey: bootstrap.defaultKey,
    instances: bootstrap.instances,
    getDefaultKey: () => ipcRenderer.invoke("instances:get-default-key") as Promise<string | null>,
    setDefaultKey: (key: string | null) => ipcRenderer.invoke("instances:set-default-key", key) as Promise<boolean>,
    open: (id: string) => ipcRenderer.invoke("instances:open", id) as Promise<boolean>,
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
  },
  auth: {
    openExternal: (url: string) => ipcRenderer.invoke("auth:open-external", url) as Promise<boolean>,
  },
  local: {
    target: () => ipcRenderer.invoke("local:target") as Promise<LocalTarget>,
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
  // Desktop-app updater. Owns the lifecycle of the *Electron shell*
  // exclusively — never the connected remote instance. Releases use the
  // dedicated `vX.Y.Z-desktop` GitHub tags so desktop bumps stay decoupled
  // from server bumps. Surfaces the full state machine (check → download
  // → progress → downloaded → install) so the selector page can render a
  // self-contained inline UI without relying on native modals.
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
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld("codeplaneDesktop", api)

export type CodePlaneDesktopAPI = typeof api
