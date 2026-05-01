import { contextBridge, ipcRenderer } from "electron"

type SavedInstance = {
  id: string
  url: string
  label?: string
  headers?: Record<string, string>
  ignoreCertificateErrors?: boolean
  clientCertSubject?: string
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
  debug: {
    log: (event: string, data?: unknown, scope = "renderer") => ipcRenderer.send("desktop:log", { data, event, scope }),
    logPath: () => ipcRenderer.invoke("desktop:log-path") as Promise<string>,
  },
  updater: {
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
