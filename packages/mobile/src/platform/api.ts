/**
 * codeplaneMobile — the mobile equivalent of the desktop's
 * `window.codeplaneDesktop` preload bridge.
 *
 * The renderer code (screens, components) calls into this single API.
 * Each method is implemented either directly with a Capacitor plugin
 * or with a small pure-JS fallback. Keeping the surface flat means we
 * can later swap implementations (Capacitor vs. PWA vs. test harness)
 * without touching the screens.
 */

import { Capacitor } from "@capacitor/core"
import { App as CapApp, type URLOpenListenerEvent } from "@capacitor/app"
import { StatusBar, Style as StatusBarStyle } from "@capacitor/status-bar"
import { Keyboard } from "@capacitor/keyboard"
import { Haptics, ImpactStyle } from "@capacitor/haptics"
import { LocalNotifications } from "@capacitor/local-notifications"
import { Device } from "@capacitor/device"
import { Network } from "@capacitor/network"
import { SplashScreen } from "@capacitor/splash-screen"
import { mobileInstanceStore } from "./instance-store"
import { mobilePreferences } from "./storage"
import { mobileHeadersStore } from "./headers-store"
import { createLiveActivities, type CodeplaneLiveActivitiesAPI } from "./live-activities"
import { createSSO, type SSOAPI } from "./sso"
import { ssoTokenStore } from "./sso-store"
import { uiCache, type UICacheAPI } from "./ui-cache"
import { assetCache, type AssetCacheAPI } from "./asset-cache"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import type { SSOConfig } from "./sso-types"

export type MobilePlatform = "ios" | "android" | "web"

export type MobileDeviceInfo = {
  platform: MobilePlatform
  model: string
  osVersion: string
  manufacturer: string
  isVirtual: boolean
  webViewVersion?: string
}

export type MobileNetworkInfo = {
  connected: boolean
  connectionType: "wifi" | "cellular" | "none" | "unknown"
}

export type DeepLinkHandler = (url: URL) => void

export type CodeplaneMobileAPI = {
  platform: MobilePlatform
  isNative: boolean
  device: () => Promise<MobileDeviceInfo>
  network: {
    current: () => Promise<MobileNetworkInfo>
    onChange: (cb: (info: MobileNetworkInfo) => void) => () => void
  }
  haptics: {
    impactLight: () => Promise<void>
    impactMedium: () => Promise<void>
    selection: () => Promise<void>
  }
  statusBar: {
    setLight: () => Promise<void>
    setDark: () => Promise<void>
  }
  keyboard: {
    hide: () => Promise<void>
    onShow: (cb: (height: number) => void) => () => void
    onHide: (cb: () => void) => () => void
  }
  splash: {
    hide: () => Promise<void>
  }
  storage: {
    getItem: (key: string) => Promise<string | null>
    setItem: (key: string, value: string) => Promise<void>
    removeItem: (key: string) => Promise<void>
  }
  notifications: {
    request: () => Promise<boolean>
    notify: (input: { title: string; description?: string; href?: string }) => Promise<boolean>
    onClick: (cb: (href?: string) => void) => () => void
  }
  deepLinks: {
    onOpen: (cb: DeepLinkHandler) => () => void
  }
  back: {
    onBack: (cb: () => boolean | void) => () => void
  }
  instances: {
    list: () => Promise<SavedInstance[]>
    save: (instance: SavedInstance) => Promise<SavedInstance[]>
    remove: (id: string) => Promise<SavedInstance[]>
    getLastId: () => Promise<string | undefined>
    setLastId: (id: string) => Promise<void>
    /**
     * Auth headers are stored separately in the OS keychain / encrypted
     * preferences. The renderer never sees plaintext on disk — same
     * threat model as desktop's per-session header handling.
     */
    secrets: {
      get: (instanceId: string) => Promise<Record<string, string>>
      set: (instanceId: string, headers: Record<string, string>) => Promise<void>
      clear: (instanceId: string) => Promise<void>
    }
    /**
     * Per-instance UI preferences kept in the picker (NOT in the
     * remote Codeplane server). Currently just the Live Activities
     * opt-in; this object can grow later without changing the
     * `SavedInstance` schema shared with desktop.
     */
    prefs: {
      getLiveActivitiesEnabled: (instanceId: string) => Promise<boolean>
      setLiveActivitiesEnabled: (instanceId: string, enabled: boolean) => Promise<void>
      /**
       * Per-instance set of session IDs the user explicitly opted in to
       * the Live Activity surface. Empty by default — Live Activities
       * are user-driven, not auto-selected, so the picker only shows
       * activities for sessions in this set. Capped at
       * `MAX_LIVE_ACTIVITY_SESSIONS` (2) by the toggle handshake.
       */
      getLiveActivitySessionIds: (instanceId: string) => Promise<string[]>
      setLiveActivitySessionIds: (instanceId: string, ids: string[]) => Promise<void>
    }
    /**
     * Per-instance SSO config (OAuth 2.0 + PKCE). Public client
     * material only — the tokens that come back live in the keychain
     * via `liveActivities.signIn` → `sso-store.ts`.
     */
    ssoConfig: {
      get: (instanceId: string) => Promise<SSOConfig | null>
      set: (instanceId: string, config: SSOConfig) => Promise<void>
      clear: (instanceId: string) => Promise<void>
    }
  }
  liveActivities: CodeplaneLiveActivitiesAPI
  sso: SSOAPI
  /**
   * Per-instance UI version awareness — same shape as the desktop's
   * `ui-host` cache: probe `/global/version`, track when the user last
   * "opened" a particular version, surface stale-vs-fresh state, and
   * watch for new releases on a 10-minute interval.
   */
  uiCache: UICacheAPI
  /**
   * Phase-2 asset cache — downloads every reachable static asset for
   * a Codeplane release into the device's `Filesystem.Directory.Cache`
   * sandbox. Mirrors the desktop's `crawlUI` exactly so a given
   * version produces the same set of files on disk regardless of
   * platform. The native `WKURLSchemeHandler` (phase 2b) reads back
   * from the same root.
   */
  assetCache: AssetCacheAPI
}

const detectPlatform = (): MobilePlatform => {
  const p = Capacitor.getPlatform()
  return p === "ios" || p === "android" ? p : "web"
}

const wrapNetworkType = (t: string): MobileNetworkInfo["connectionType"] => {
  if (t === "wifi" || t === "cellular" || t === "none" || t === "unknown") return t
  return "unknown"
}

export function createCodeplaneMobile(): CodeplaneMobileAPI {
  const platform = detectPlatform()
  const isNative = platform !== "web"

  const api: CodeplaneMobileAPI = {
    platform,
    isNative,

    async device() {
      try {
        const info = await Device.getInfo()
        return {
          platform: (info.platform as MobilePlatform) ?? platform,
          model: info.model ?? "unknown",
          osVersion: info.osVersion ?? "",
          manufacturer: info.manufacturer ?? "",
          isVirtual: !!info.isVirtual,
          webViewVersion: info.webViewVersion,
        }
      } catch {
        return {
          platform,
          model: "browser",
          osVersion: "",
          manufacturer: "",
          isVirtual: false,
        }
      }
    },

    network: {
      async current() {
        try {
          const status = await Network.getStatus()
          return {
            connected: !!status.connected,
            connectionType: wrapNetworkType(status.connectionType ?? "unknown"),
          }
        } catch {
          return { connected: navigator.onLine, connectionType: "unknown" }
        }
      },
      onChange(cb) {
        let listener: { remove: () => Promise<void> } | undefined
        Network.addListener("networkStatusChange", (status) =>
          cb({
            connected: !!status.connected,
            connectionType: wrapNetworkType(status.connectionType ?? "unknown"),
          }),
        )
          .then((l) => {
            listener = l
          })
          .catch(() => {
            const onOnline = () => cb({ connected: true, connectionType: "unknown" })
            const onOffline = () => cb({ connected: false, connectionType: "none" })
            window.addEventListener("online", onOnline)
            window.addEventListener("offline", onOffline)
            listener = {
              async remove() {
                window.removeEventListener("online", onOnline)
                window.removeEventListener("offline", onOffline)
              },
            }
          })
        return () => {
          listener?.remove().catch(() => {})
        }
      },
    },

    haptics: {
      async impactLight() {
        if (!isNative) return
        await Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
      },
      async impactMedium() {
        if (!isNative) return
        await Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
      },
      async selection() {
        if (!isNative) return
        await Haptics.selectionStart().catch(() => {})
        await Haptics.selectionEnd().catch(() => {})
      },
    },

    statusBar: {
      // Method names describe the FOREGROUND tone (the icon/text colour),
      // not the underlying Capacitor enum. The Capacitor enum's `Light`
      // and `Dark` are named for the *background* the style is meant to
      // sit on top of (Light = "for light backgrounds → dark text",
      // Dark = "for dark backgrounds → light text") — easy to get wrong,
      // hence this single point of inversion.
      async setLight() {
        // Light foreground (light icons + text), to be used over the
        // dark `--background-base` the picker locks itself to.
        if (!isNative) return
        await StatusBar.setStyle({ style: StatusBarStyle.Dark }).catch(() => {})
      },
      async setDark() {
        // Dark foreground (dark icons + text), used over light surfaces.
        if (!isNative) return
        await StatusBar.setStyle({ style: StatusBarStyle.Light }).catch(() => {})
      },
    },

    keyboard: {
      async hide() {
        if (!isNative) return
        await Keyboard.hide().catch(() => {})
      },
      onShow(cb) {
        if (!isNative) return () => {}
        let l: { remove: () => Promise<void> } | undefined
        Keyboard.addListener("keyboardDidShow", (info) => cb(info.keyboardHeight ?? 0))
          .then((handle) => {
            l = handle
          })
          .catch(() => {})
        return () => {
          l?.remove().catch(() => {})
        }
      },
      onHide(cb) {
        if (!isNative) return () => {}
        let l: { remove: () => Promise<void> } | undefined
        Keyboard.addListener("keyboardDidHide", () => cb())
          .then((handle) => {
            l = handle
          })
          .catch(() => {})
        return () => {
          l?.remove().catch(() => {})
        }
      },
    },

    splash: {
      async hide() {
        await SplashScreen.hide({ fadeOutDuration: 240 }).catch(() => {})
      },
    },

    storage: mobilePreferences,

    notifications: {
      async request() {
        try {
          const result = await LocalNotifications.requestPermissions()
          return result.display === "granted"
        } catch {
          return false
        }
      },
      async notify({ title, description, href }) {
        try {
          await LocalNotifications.schedule({
            notifications: [
              {
                id: Math.floor(Math.random() * 1e9),
                title,
                body: description ?? "",
                extra: { href: href ?? null },
              },
            ],
          })
          return true
        } catch {
          return false
        }
      },
      onClick(cb) {
        let listener: { remove: () => Promise<void> } | undefined
        LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
          const href = event.notification.extra?.href
          cb(typeof href === "string" ? href : undefined)
        })
          .then((l) => {
            listener = l
          })
          .catch(() => {})
        return () => {
          listener?.remove().catch(() => {})
        }
      },
    },

    deepLinks: {
      onOpen(cb) {
        let listener: { remove: () => Promise<void> } | undefined
        CapApp.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
          try {
            cb(new URL(event.url))
          } catch {
            // ignore malformed deep links
          }
        })
          .then((l) => {
            listener = l
          })
          .catch(() => {})
        return () => {
          listener?.remove().catch(() => {})
        }
      },
    },

    back: {
      onBack(cb) {
        let listener: { remove: () => Promise<void> } | undefined
        CapApp.addListener("backButton", () => {
          // The handler returns `true` to indicate it handled the press.
          // If it returns `false`/undefined, we fall back to the default
          // (exits the app on Android).
          const handled = cb()
          if (!handled) CapApp.exitApp().catch(() => {})
        })
          .then((l) => {
            listener = l
          })
          .catch(() => {})
        return () => {
          listener?.remove().catch(() => {})
        }
      },
    },

    instances: (() => {
      const base = mobileInstanceStore(mobileHeadersStore)
      // Wrap `remove` so we also drop the cached SSO tokens AND the
      // UI cache record. The base store already drops the SSO config;
      // tokens + ui-cache live in their own stores and the
      // instance-store doesn't import from them directly (kept the
      // dep direction one-way for testability).
      const remove = async (id: string) => {
        const next = await base.remove(id)
        await ssoTokenStore.clear(id)
        await uiCache.clear(id)
        // Wipe any cached UI bytes too — keeping ~tens of MB around
        // for a server the user just deleted is a sandbox-quota
        // landmine, especially after months of churn.
        await assetCache.clear(id)
        return next
      }
      return {
        ...base,
        remove,
        prefs: {
          async getLiveActivitiesEnabled(instanceId: string) {
            const v = await mobilePreferences.getItem(`cp:prefs:la:${instanceId}`)
            // Default ON — the whole point is for the user not to babysit
            // the screen. They opt out via the instance settings sheet.
            return v == null ? true : v === "1"
          },
          async setLiveActivitiesEnabled(instanceId: string, enabled: boolean) {
            await mobilePreferences.setItem(`cp:prefs:la:${instanceId}`, enabled ? "1" : "0")
          },
          async getLiveActivitySessionIds(instanceId: string) {
            const raw = await mobilePreferences.getItem(`cp:prefs:la:sessions:${instanceId}`)
            if (!raw) return []
            try {
              const parsed = JSON.parse(raw)
              if (!Array.isArray(parsed)) return []
              return parsed.filter((id): id is string => typeof id === "string")
            } catch {
              // Corrupt JSON — drop it rather than letting one rogue write
              // poison the activity surface forever.
              return []
            }
          },
          async setLiveActivitySessionIds(instanceId: string, ids: string[]) {
            // De-dupe defensively; the toggle path is the single writer
            // but we don't want a future bug to leak duplicates into the
            // monitor's selection.
            const unique = Array.from(new Set(ids))
            await mobilePreferences.setItem(
              `cp:prefs:la:sessions:${instanceId}`,
              JSON.stringify(unique),
            )
          },
        },
        ssoConfig: base.ssoConfig,
      }
    })(),
    liveActivities: createLiveActivities(),
    sso: createSSO(),
    uiCache,
    assetCache,
  }

  // Auto-crawl wiring — when `ui-cache` flips any record to `stale`,
  // the asset-cache module reaches into the instance store via this
  // resolver, builds the crawl URL, and starts downloading. Wiring
  // this here (rather than in App.tsx) means it survives picker
  // mount/unmount and still works for instances added after first
  // launch. The resolver returns a minimal shape (`{ id, url }`);
  // headers come from the keychain inside the crawler.
  api.assetCache.bindAutoCrawl(async (instanceId: string) => {
    const list = await api.instances.list()
    const match = list.find((i) => i.id === instanceId)
    if (!match) return null
    return { id: match.id, url: match.url }
  })

  return api
}
