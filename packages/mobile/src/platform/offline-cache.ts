/**
 * Mobile offline-cache native bridge — phase 2b.
 *
 * Capacitor plugin handle for the iOS-side `CodeplaneOfflineCache`
 * plugin (see `packages/mobile/build/ios-offline-cache/` and
 * `packages/mobile/ios/App/App/plugins/OfflineCachePlugin/`). It
 * exposes the offline UI presenter to the picker:
 *
 *   1. `isSupported()` — true on iOS 11+ where `WKURLSchemeHandler`
 *      exists. The picker checks this AND `assetCache.get(...)` is
 *      `ready` before opting an instance into the offline path —
 *      otherwise it falls back to the live-origin `@capgo/inappbrowser`
 *      flow.
 *
 *   2. `openInstance(...)` — present a fullscreen modal hosting a
 *      WKWebView whose URL scheme `codeplane-cache:` is handled by
 *      `CodeplaneCacheSchemeHandler.swift`. Static asset requests
 *      are served from the on-disk crawl tree the JS-side
 *      `asset-cache.ts` already populates; everything else (API,
 *      SSE, websocket-upgrade-as-HTTP) is proxied to the live origin
 *      via `URLSession.shared` with the per-instance auth headers
 *      injected. Cookies share `WKWebsiteDataStore.default()` with
 *      the existing InAppBrowser flow so SSO sessions carry over
 *      between paths.
 *
 *   3. `closeInstance(...)` — explicit dismiss. Implicit dismiss
 *      (interactive swipe / `viewDidDisappear`) ALSO fires the same
 *      `closeEvent` listener so the picker reconciles state without
 *      the JS side having to call back.
 *
 * No Android implementation yet — the plugin's `isSupported()` will
 * resolve to `{ supported: false }` on Android and the picker stays
 * on the InAppBrowser path. Android needs a `WebViewAssetLoader` +
 * `shouldInterceptRequest` adapter; that's the obvious follow-up
 * (single Kotlin file, same shape as the Swift handler) but it
 * doesn't gate the iOS rollout.
 */

import { registerPlugin } from "@capacitor/core"
import { Filesystem, Directory } from "@capacitor/filesystem"
import type { PluginListenerHandle } from "@capacitor/core"

interface NativeOfflineCachePlugin {
  isSupported(): Promise<{ supported: boolean; minIOS?: string; reason?: string }>
  openInstance(input: {
    instanceId: string
    version: string
    originUrl: string
    cacheDir: string
    authHeaders?: Record<string, string>
    toolbarColor?: string
    title?: string
  }): Promise<{ id: string; scheme: string; rootDir: string }>
  closeInstance(input?: { instanceId?: string }): Promise<void>
  addListener(
    eventName: "closeEvent",
    listenerFunc: (event: { id: string }) => void,
  ): Promise<PluginListenerHandle>
  removeAllListeners(): Promise<void>
}

const Native = registerPlugin<NativeOfflineCachePlugin>("CodeplaneOfflineCache", {
  // No web fallback — the picker checks `isSupported()` at call time
  // and only routes through this plugin when the platform implementation
  // is present. Returning a stub web that always says `supported: false`
  // would shave one bridge round-trip but adds a place behaviour can
  // drift between the two.
})

/**
 * Cached `isSupported()` result. The probe never changes within an
 * app lifetime (it's a runtime OS-version check, not a feature gate
 * the user can flip), so we cache after the first call to avoid
 * paying the bridge cost on every picker render.
 */
let supportedCache: Promise<boolean> | undefined

const probeSupport = async (): Promise<boolean> => {
  try {
    const result = await Native.isSupported()
    return Boolean(result.supported)
  } catch {
    // Plugin missing (web build, Android without the Kotlin port,
    // …) — falling back to the InAppBrowser path is the safe default.
    return false
  }
}

const SCHEME = "codeplane-cache"

export type OfflineCacheOpenInput = {
  instanceId: string
  version: string
  originUrl: string
  authHeaders?: Record<string, string>
  toolbarColor?: string
  title?: string
}

export type OfflineCacheAPI = {
  /** True on iOS 11+ with the plugin compiled in. Cached. */
  isSupported: () => Promise<boolean>
  /** URL scheme served from disk. The picker can use this to pre-build
   *  in-app deep links if it wants to swap an InAppBrowser-bound URL
   *  for an offline-bound one. */
  scheme: () => string
  /**
   * Present the cached UI for the instance + version. Resolves once
   * the modal is on screen. Listen for `closeEvent` to re-mount the
   * picker — implicit dismiss fires the same event.
   */
  openInstance: (input: OfflineCacheOpenInput) => Promise<{ id: string }>
  closeInstance: (input?: { instanceId?: string }) => Promise<void>
  addCloseListener: (cb: (id: string) => void) => Promise<PluginListenerHandle>
  removeAllListeners: () => Promise<void>
}

/**
 * Resolve the absolute filesystem path for a `Filesystem.Directory.Cache`
 * relative path. The Swift plugin needs an ABSOLUTE path because its
 * `URL(fileURLWithPath:)` doesn't know about Capacitor's directory
 * sandbox; calling `Filesystem.getUri` from the JS side bridges that.
 *
 * Returns a `file://` URI on iOS. We strip the prefix before handing
 * it to the plugin so Swift's `URL(fileURLWithPath:)` lands clean.
 */
const resolveCacheBaseDir = async (): Promise<string> => {
  const result = await Filesystem.getUri({
    path: "",
    directory: Directory.Cache,
  })
  let absolute = result.uri
  if (absolute.startsWith("file://")) {
    absolute = absolute.slice("file://".length)
  }
  return absolute.replace(/\/+$/, "")
}

export const offlineCache: OfflineCacheAPI = {
  isSupported() {
    if (!supportedCache) supportedCache = probeSupport()
    return supportedCache
  },
  scheme() {
    return SCHEME
  },
  async openInstance(input) {
    const cacheDir = await resolveCacheBaseDir()
    const result = await Native.openInstance({
      instanceId: input.instanceId,
      version: input.version,
      originUrl: input.originUrl,
      cacheDir,
      authHeaders: input.authHeaders,
      toolbarColor: input.toolbarColor,
      title: input.title,
    })
    return { id: result.id }
  },
  closeInstance(input) {
    return Native.closeInstance(input)
  },
  async addCloseListener(cb) {
    return Native.addListener("closeEvent", (event) => cb(event.id))
  },
  removeAllListeners() {
    return Native.removeAllListeners()
  },
}
