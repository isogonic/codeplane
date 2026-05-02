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
  archiveExt: ".zip" | ".tar.gz"
  binaryName: string
  os: "darwin" | "linux" | "windows"
  arch: "x64" | "arm64"
  defaultVersion?: string
}

export type LocalStatus = {
  binaryVersion: string
  installed: boolean
  binaryPath: string
  archive: string
}
