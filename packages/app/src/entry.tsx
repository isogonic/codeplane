// @refresh reload

import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { type Platform, type PlatformServerManager, PlatformProvider } from "@/context/platform"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { handleNotificationClick } from "@/utils/notification-click"
import { silenceResizeObserverNoise } from "@/utils/silence-resize-observer"
import { CodeplaneVersion } from "@codeplane-ai/shared/version"
import { ServerConnection } from "./context/server"

silenceResizeObserverNoise()

const DEFAULT_SERVER_URL_KEY = "codeplane.settings.dat:defaultServerUrl"

// The desktop preload exposes a wider API surface (desktopUpdater for
// the selector page, instances bridge, local-instance manager, etc.).
// In-instance UI only needs the small subset below — typed loosely with
// `unknown` so the rest of the bridge stays opaque to consumers here.
type DesktopWindowState = { fullscreen: boolean; focused: boolean; maximized: boolean }
type DesktopWindowApi = {
  state: DesktopWindowState
  onStateChange?: (cb: (state: DesktopWindowState) => void) => () => void
}
declare global {
  interface Window {
    codeplaneDesktop?: {
      platform?: string
      version?: string
      serverManager?: PlatformServerManager
      window?: DesktopWindowApi
      [key: string]: unknown
    }
  }
}

const getLocale = () => {
  if (typeof navigator !== "object") return "en" as const
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("zh")) return "zh" as const
  }
  return "en" as const
}

const getRootNotFoundError = () => {
  const key = "error.dev.rootNotFound" as const
  const locale = getLocale()
  return locale === "zh" ? (zh[key] ?? en[key]) : en[key]
}

const getStorage = (key: string) => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorage = (key: string, value: string | null) => {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) {
      localStorage.setItem(key, value)
      return
    }
    localStorage.removeItem(key)
  } catch {
    return
  }
}

const readDefaultServerUrl = () => getStorage(DEFAULT_SERVER_URL_KEY)
const writeDefaultServerUrl = (url: string | null) => setStorage(DEFAULT_SERVER_URL_KEY, url)

const notify: Platform["notify"] = async (title, description, href) => {
  if (!("Notification" in window)) return

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied")
      : Notification.permission

  if (permission !== "granted") return

  const inView = document.visibilityState === "visible" && document.hasFocus()
  if (inView) return

  const notification = new Notification(title, {
    body: description ?? "",
    icon: "/favicon-96x96-v3.png",
  })

  notification.onclick = () => {
    handleNotificationClick(href)
    notification.close()
  }
}

const openLink: Platform["openLink"] = (url) => {
  window.open(url, "_blank")
}

const back: Platform["back"] = () => {
  window.history.back()
}

const forward: Platform["forward"] = () => {
  window.history.forward()
}

const restart: Platform["restart"] = async () => {
  window.location.reload()
}

const root = document.getElementById("root")
if (!(root instanceof HTMLElement) && import.meta.env.DEV) {
  throw new Error(getRootNotFoundError())
}

const getCurrentUrl = () => {
  if (location.hostname.includes("example.invalid")) return "http://localhost:4096"
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_CODEPLANE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_CODEPLANE_SERVER_PORT ?? "4096"}`
  return location.origin
}

const isLocalDevHost = () => location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "::1"

const getDefaultUrl = () => {
  if (import.meta.env.DEV && isLocalDevHost()) return getCurrentUrl()
  const lsDefault = readDefaultServerUrl()
  if (lsDefault) return lsDefault
  return getCurrentUrl()
}

const getDesktopOS = (value: string) => {
  if (value === "darwin" || /mac/i.test(value)) return "macos" as const
  if (value === "win32" || /win/i.test(value)) return "windows" as const
  if (value === "linux" || /linux/i.test(value)) return "linux" as const
}

const getDesktopHost = () => {
  const exposed = window.codeplaneDesktop?.platform
  if (exposed) return { desktop: true as const, os: getDesktopOS(exposed) }
  if (typeof navigator !== "object" || !/electron/i.test(navigator.userAgent)) return
  return { desktop: true as const, os: getDesktopOS(navigator.platform || navigator.userAgent) }
}

// Tag <html> with platform/OS so CSS can reliably target the macOS
// desktop shell (vibrancy-aware backgrounds, native scrollbars, hairline
// borders). Mirror window state so the chrome can dim on blur and drop
// the traffic-light gutter when the user enters fullscreen.
const desktopHostInfo = getDesktopHost()
if (typeof document !== "undefined") {
  const html = document.documentElement
  if (desktopHostInfo) {
    html.dataset.desktop = "true"
    if (desktopHostInfo.os) html.dataset.os = desktopHostInfo.os
  } else {
    html.dataset.desktop = "false"
  }
  const win = window.codeplaneDesktop?.window
  const applyState = (state: DesktopWindowState) => {
    html.dataset.fullscreen = state.fullscreen ? "true" : "false"
    html.dataset.windowFocused = state.focused ? "true" : "false"
    html.dataset.maximized = state.maximized ? "true" : "false"
  }
  if (win?.state) applyState(win.state)
  win?.onStateChange?.(applyState)
}

const desktopServerManager = window.codeplaneDesktop?.serverManager
const desktopServerList = () =>
  (desktopServerManager?.instances ?? []).map(
    (instance): ServerConnection.Http => ({
      type: "http",
      displayName: instance.label,
      http: {
        key: instance.key,
        remoteUrl: instance.remoteUrl,
        url: instance.proxyUrl,
      },
    }),
  )

const desktopActiveKey = () =>
  desktopServerManager?.currentKey ??
  desktopServerManager?.defaultKey ??
  desktopServerManager?.instances[0]?.key ??
  null

const platform: Platform = {
  platform: "web",
  ...getDesktopHost(),
  version: window.codeplaneDesktop?.version ?? CodeplaneVersion,
  desktopAppVersion: window.codeplaneDesktop?.version,
  serverManager: desktopServerManager,
  openLink,
  back,
  forward,
  restart,
  notify,
  getDefaultServer: async () => {
    if (desktopServerManager) {
      const key = await desktopServerManager.getDefaultKey()
      return key ? ServerConnection.Key.make(key) : null
    }
    if (import.meta.env.DEV && isLocalDevHost()) return ServerConnection.Key.make(getCurrentUrl())
    const stored = readDefaultServerUrl()
    return stored ? ServerConnection.Key.make(stored) : null
  },
  setDefaultServer: (value) => {
    if (desktopServerManager) {
      return desktopServerManager.setDefaultKey(value ?? null).then(() => undefined)
    }
    writeDefaultServerUrl(value)
  },
}

if (root instanceof HTMLElement) {
  const servers = desktopServerManager ? desktopServerList() : ([{ type: "http", http: { url: getCurrentUrl() } }] as const)
  const defaultServer = desktopServerManager ? desktopActiveKey() : ServerConnection.Key.make(getDefaultUrl())
  render(
    () => (
      <PlatformProvider value={platform}>
        <AppBaseProviders>
          <AppInterface
            defaultServer={ServerConnection.Key.make(defaultServer ?? getDefaultUrl())}
            servers={[...servers]}
            disableHealthCheck={!desktopServerManager}
          />
        </AppBaseProviders>
      </PlatformProvider>
    ),
    root,
  )
}
