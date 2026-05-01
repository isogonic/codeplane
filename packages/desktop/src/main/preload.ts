import { contextBridge, ipcRenderer } from "electron"

type SavedInstance = {
  id: string
  url: string
  label?: string
  headers?: Record<string, string>
  ignoreCertificateErrors?: boolean
  clientCertSubject?: string
}

const api = {
  instances: {
    list: () => ipcRenderer.invoke("instances:list") as Promise<SavedInstance[]>,
    getLastId: () => ipcRenderer.invoke("instances:get-last") as Promise<string | undefined>,
    save: (instance: SavedInstance) => ipcRenderer.invoke("instances:save", instance) as Promise<SavedInstance[]>,
    remove: (id: string) => ipcRenderer.invoke("instances:remove", id) as Promise<SavedInstance[]>,
    open: (id: string) => ipcRenderer.invoke("instances:open", id) as Promise<boolean>,
    probe: (url: string) =>
      ipcRenderer.invoke("instances:probe", url) as Promise<{
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
  updater: {
    check: () =>
      ipcRenderer.invoke("updater:check") as Promise<
        { ok: true; updateAvailable: boolean; version?: string } | { ok: false; error: string }
      >,
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
