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
  local?: boolean
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
  openLogDir(id: string): Promise<boolean>
  show(editId?: string): Promise<boolean>
}

export type SystemPermissionStatus = {
  key: string
  label: string
  granted: boolean
  preferencePane?: string
}

export type SystemPermissionsAPI = {
  check: () => Promise<{ platform: string; permissions: SystemPermissionStatus[] }>
  request: (permissionKey: string) => Promise<boolean>
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

  /**
   * Desktop shell version when running inside the Electron host. The
   * Electron app updates its shell on a different release line
   * (`vX.Y.Z-desktop`) than the connected server. Surfaced read-only here
   * so in-instance UIs can show "Desktop X.Y.Z" alongside the server
   * version. The actual desktop-update lifecycle lives on the selector
   * page and never reaches this context.
   */
  desktopAppVersion?: string

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

  /** Check and request OS-level permissions needed by desktop-only tools */
  systemPermissions?: SystemPermissionsAPI

  /**
   * Quit and immediately relaunch the native desktop shell. Surfaced
   * separately from `restart()` (which reloads the server) because
   * permission grants on macOS only take effect after the *Electron
   * process* itself restarts — server reloads don't reset TCC state.
   * Returns whether the relaunch was scheduled (false on dev builds or
   * non-desktop platforms).
   */
  relaunchShell?(): Promise<boolean>
}

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
