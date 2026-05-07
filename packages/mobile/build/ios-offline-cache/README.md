# Codeplane Offline Cache — iOS native plugin (phase 2b)

This directory holds the Capacitor plugin that lets the in-app webview
load a Codeplane instance from the on-device cache that
[`packages/mobile/src/platform/asset-cache.ts`](../../src/platform/asset-cache.ts)
already populates. **Phase 2a** (downloading + persisting the bytes,
showing progress + cache size in the picker) is wired up and shipping
in the JS bundle today; the steps below land **phase 2b** — actually
serving those bytes via a `WKURLSchemeHandler` so the picker can open
an instance offline.

## What it does at runtime

1. Picker calls `Capacitor.Plugins.CodeplaneOfflineCache.openInstance({ instanceId, version, originUrl })`.
2. The Swift plugin instantiates a fullscreen `UIViewController` hosting a `WKWebView`.
3. The `WKWebViewConfiguration` registers a `WKURLSchemeHandler` for the custom scheme `codeplane-cache:`.
4. The webview navigates to `codeplane-cache://<instanceId>/`.
5. For every request the webview makes:
   - **Static path** (`.html` / `.js` / `.css` / fonts / images): scheme handler reads from `Filesystem.Directory.Cache/codeplane-ui/<instanceId>/<version>/<path>` and replies with the bytes + correct MIME type.
   - **API / WebSocket** (`/api/*`, `/v2/*`, `/sync`, `/socket.io`, etc.): scheme handler proxies to `<originUrl><path>` via `URLSession.shared`, copying cookies from the shared `WKWebsiteDataStore` into the upstream request and the upstream `Set-Cookie` headers back into the data store. Same model as the desktop's `ui-host` HTTP proxy.

The picker stays mounted behind the modal; the user dismisses with the
floating "Done" pill the same way the existing `@capgo/inappbrowser`
flow works.

## Files in this directory

- `README.md` — this file.
- `OfflineCachePlugin.swift` — `CAPPlugin` subclass exposing `openInstance` / `closeInstance` / `isSupported`.
- `OfflineCachePlugin.m` — `CAP_PLUGIN` macro registering the Swift plugin under the JS name `CodeplaneOfflineCache`.
- `CodeplaneCacheSchemeHandler.swift` — the `WKURLSchemeHandler` itself: file-served + URLSession proxy.

## How to install (one-time, after `bun run cap:add:ios`)

1. Copy the four files into `ios/App/App/plugins/OfflineCachePlugin/`.
2. In Xcode, drag the folder into the `App` target → check "Copy items if needed", "Create groups", and the App target's Compile Sources.
3. Make sure `OfflineCachePlugin.m` is listed under Build Phases → Compile Sources.
4. `bun run cap:sync` to regenerate the Pods + bridge.

## Status

- [x] JS-side asset crawler + state + UI ([asset-cache.ts](../../src/platform/asset-cache.ts), wired into [App.tsx](../../src/app.tsx) and [instance-list.tsx](../../src/components/instance-list.tsx)).
- [ ] `OfflineCachePlugin.swift` skeleton (in this directory — implementation TODO).
- [ ] `CodeplaneCacheSchemeHandler.swift` skeleton (in this directory — implementation TODO).
- [ ] `webview-host.tsx` flips to use this plugin when `assetCache.get()` returns `status: "ready"` and falls back to `@capgo/inappbrowser` otherwise.

The skeletons compile but no-op until the bodies are filled in. They're checked in so the plugin is queued up for the next iteration without needing another scaffolding round.
