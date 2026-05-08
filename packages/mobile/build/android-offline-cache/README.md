# Codeplane Offline Cache — Android native plugin (phase 2b)

This directory holds the Android (Java) counterpart of the iOS
`packages/mobile/build/ios-offline-cache/` plugin. Same JS surface
(`Capacitor.Plugins.CodeplaneOfflineCache`), same picker behaviour
(`tryOpenInOfflineCache()` in [`webview-host.tsx`](../../src/components/webview-host.tsx)
gates on `assetCache.get()` being `ready` + the cached version
matching the picker's last-probed remote version), same proxy /
serve split (static asset → disk, dynamic path → live origin via
`HttpURLConnection` with per-instance auth headers and the shared
`CookieManager`).

Three files:

- **`OfflineCachePlugin.java`** — `@CapacitorPlugin(name="CodeplaneOfflineCache")`
  exposing `isSupported()` / `openInstance()` / `closeInstance()`.
  Capacitor 7 auto-discovers the annotation, no manual register call
  in `MainActivity` required.
- **`OfflineCacheInterceptor.java`** — `WebViewClient.shouldInterceptRequest`
  body. Static-vs-proxy decision, MIME table mirrored byte-for-byte
  with the iOS `CodeplaneCacheSchemeHandler.swift` / desktop
  `ui-host.ts`, SPA fallback to `index.html` for non-API paths.
- **`OfflineCacheActivity.java`** — fullscreen `Activity` hosting the
  WebView. Closes via the floating ✕ pill, system back button, OR a
  `closeInstance()` API call (delivered via local broadcast). Fires
  `closeEvent` to JS listeners on dismiss.

## Synthetic host

iOS uses a custom URL scheme (`codeplane-cache://<id>/`) registered
via `setURLSchemeHandler`. Android's `WebView` doesn't have an
equivalent registration API — but `shouldInterceptRequest` fires for
every URL including ordinary `https://` ones, so we point the WebView
at `https://codeplane.cache/` (a synthetic host that nobody owns) and
pattern-match on it inside the interceptor. Same end result: every
request the SPA issues lands in our handler, where we serve it from
disk or proxy it to the real origin.

## Install

After running `bun run cap:add:android`:

1. Copy the three `.java` files into
   `packages/mobile/android/app/src/main/java/ai/codeplane/mobile/`.
2. Add the activity declaration to
   `packages/mobile/android/app/src/main/AndroidManifest.xml`:

   ```xml
   <activity
       android:name=".OfflineCacheActivity"
       android:exported="false"
       android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation"
       android:theme="@style/AppTheme" />
   ```

3. `bun run cap:sync` — Capacitor's annotation processor picks up the
   `@CapacitorPlugin` and registers it on the next bridge bootstrap.

The repo ships with all of the above pre-installed; this README is
documentation for what was done, not a manual checklist for the next
clone.

## Status (matches the iOS sibling)

- [x] `OfflineCachePlugin.java` — annotated, picked up by Capacitor.
- [x] `OfflineCacheInterceptor.java` — static + proxy intercept.
- [x] `OfflineCacheActivity.java` — fullscreen modal with WebView,
      close pill, broadcast finish receiver.
- [x] AndroidManifest.xml — `OfflineCacheActivity` declared.
- [x] `webview-host.tsx` flips to use this plugin when
      `assetCache.get()` returns `status: "ready"` and falls back to
      `@capgo/inappbrowser` otherwise.
