import { createSimpleContext } from "@codeplane-ai/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor } from "solid-js"
import { ServerConnection } from "./server"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }
type OpenFilePickerOptions = { title?: string; multiple?: boolean; accept?: string[]; extensions?: string[] }
type SaveFilePickerOptions = { title?: string; defaultPath?: string }
export type PlatformUpdateStatus = {
  current: string
  latest: string | null
  hasUpdate: boolean
  method: string
}
export type PlatformUpdateCheckResult =
  | { ok: true; updateAvailable: boolean; version?: string }
  | { ok: false; error: string }
export type PlatformReleaseNotes = {
  tag: string
  name: string | null
  body: string | null
  url: string | null
  publishedAt: string | null
}
export type PlatformServerInstance = {
  id: string
  key: string
  label?: string
  proxyUrl: string
  remoteUrl: string
}
export type PlatformServerManager = {
  currentKey: string | null
  defaultKey: string | null
  instances: PlatformServerInstance[]
  getDefaultKey(): Promise<string | null>
  setDefaultKey(key: string | null): Promise<boolean>
  open(id: string): Promise<boolean>
  show(editId?: string): Promise<boolean>
}
export type PlatformUpdater = {
  status(): Promise<PlatformUpdateStatus>
  check(): Promise<PlatformUpdateCheckResult>
  releaseNotes(version: string): Promise<PlatformReleaseNotes | null>
  onUpdateAvailable(cb: (info: { version: string }) => void): () => void
  onUpdateDownloaded(cb: (info: { version: string }) => void): () => void
  onProgress(cb: (info: { percent: number; transferred: number; total: number }) => void): () => void
  onError(cb: (message: string) => void): () => void
}

export type Platform = {
  /** Platform discriminator */
  platform: "web"

  /** Whether the app is hosted inside the native desktop shell */
  desktop?: boolean

  /** Host OS when running through a native wrapper */
  os?: "macos" | "windows" | "linux"

  /** App version */
  version?: string

  /** Native updater bridge when the host app owns releases separately from the connected server */
  updater?: PlatformUpdater

  /** Desktop instance bridge when the host app owns server switching/versioned UI */
  serverManager?: PlatformServerManager

  /** Open a URL in the default browser */
  openLink(url: string): void

  /** Open a local path in a local app */
  openPath?(path: string, app?: string): Promise<void>

  /** Restart the app  */
  restart(): Promise<void>

  /** Navigate back in history */
  back(): void

  /** Navigate forward in history */
  forward(): void

  /** Send a system notification (optional deep link) */
  notify(title: string, description?: string, href?: string): Promise<void>

  /** Open directory picker dialog */
  openDirectoryPickerDialog?(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>

  /** Open file picker dialog */
  openFilePickerDialog?(opts?: OpenFilePickerOptions): Promise<PickerPaths>

  /** Save file picker dialog */
  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Fetch override */
  fetch?: typeof fetch

  /** Get the configured default server URL (platform-specific) */
  getDefaultServer?(): Promise<ServerConnection.Key | null>

  /** Set the default server URL to use on app startup (platform-specific) */
  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  /** Parse markdown to HTML using a host parser, returning unprocessed code blocks */
  parseMarkdown?(markdown: string): Promise<string>

  /** Webview zoom level when provided by the host */
  webviewZoom?: Accessor<number>

  /** Check if an editor app exists */
  checkAppExists?(appName: string): Promise<boolean>

  /** Read image from clipboard */
  readClipboardImage?(): Promise<File | null>
}

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
