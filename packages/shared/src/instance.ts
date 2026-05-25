export type SavedInstance = {
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

function hasConfiguredHeaders(headers: Record<string, string> | undefined) {
  return Object.values(headers ?? {}).some((value) => value.trim().length > 0)
}

export function hasRemoteAccessSettings(instance: SavedInstance) {
  return (
    !instance.url.startsWith("local://") ||
    hasConfiguredHeaders(instance.headers) ||
    Boolean(instance.ignoreCertificateErrors) ||
    Boolean(instance.clientCertSubject)
  )
}

export function instanceEditorKind(instance: SavedInstance): "local" | "remote" {
  if (!instance.local) return "remote"
  return hasRemoteAccessSettings(instance) ? "remote" : "local"
}

export type PrepareProgress = {
  instanceID: string
  phase: "probe" | "download" | "finalize" | "done"
  message: string
  percent: number
  version?: string
  completed?: number
  total?: number
  cacheHit?: boolean
}

export type OpenProgress = {
  instanceID: string
  phase: "probe" | "download" | "finalize" | "done" | "error"
  message: string
  percent: number
  version?: string
  completed?: number
  total?: number
  cacheHit?: boolean
}

export type LocalInstallProgress = {
  version: string
  phase: "detect" | "download" | "extract" | "start" | "ready"
  message: string
  percent: number
  binaryVersion?: string
  transferred?: number
  total?: number
}

export type LocalTarget = {
  archiveName: string
  archiveExt: ".zip" | ".tar.gz" | ".tgz"
  binaryName: string
  os: "darwin" | "linux" | "windows"
  arch: "x64" | "arm64"
  packageName?: string
  defaultVersion?: string
}

export type LocalStatus = {
  binaryVersion: string
  installed: boolean
  binaryPath: string
  archive: string
  cliInstalled?: boolean
  cliPath?: string
}

export function localInstanceUrl(id: string) {
  return `local://${id}`
}
