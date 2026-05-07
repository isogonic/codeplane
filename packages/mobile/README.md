# @codeplane-ai/mobile

Codeplane Mobile is the iOS and Android counterpart to [`@codeplane-ai/desktop`](../desktop).
It is a thin native shell that always opens on the instance picker,
then loads the matching Codeplane web UI for the selected server.

The mobile app **shares the visual language of the desktop** (same CSS
variables, same SolidJS UI library) but every interaction is rebuilt
for touch:

- bottom sheets instead of centred modals
- 44 pt minimum touch targets, 16 px form fonts (no iOS auto-zoom)
- safe-area aware layout that paints behind the notch / home indicator
- haptics on selection / open
- system back button (Android) and edge-swipe (iOS) wired to the picker
- offline indicator wired to the Capacitor `Network` plugin
- secrets stored in the OS keychain, never in plaintext

## Architecture

```
packages/mobile/
├── capacitor.config.ts          ← appId, scheme, plugin config
├── vite.config.ts               ← Solid + Tailwind build → dist/
├── index.html                   ← viewport-fit=cover + CSP
├── src/
│   ├── main.tsx                 ← bootstrap
│   ├── app.tsx                  ← picker ↔ instance host state machine
│   ├── styles/
│   │   ├── index.css            ← imports @codeplane-ai/ui's tailwind
│   │   └── mobile.css           ← mobile-only overrides (safe-area, sheets)
│   ├── platform/                ← Capacitor bridge
│   │   ├── api.ts               ← codeplaneMobile (mirrors codeplaneDesktop)
│   │   ├── storage.ts           ← Preferences-backed kv
│   │   ├── headers-store.ts     ← keychain-backed auth secrets
│   │   └── instance-store.ts    ← saved instances list
│   ├── components/
│   │   ├── mobile-shell.tsx     ← outer chrome (back, splash, status bar)
│   │   ├── mobile-header.tsx    ← iOS-style nav bar
│   │   ├── bottom-sheet.tsx     ← modal-replacement
│   │   ├── instance-list.tsx    ← touch-friendly list
│   │   ├── instance-form.tsx    ← full-screen edit
│   │   └── webview-host.tsx     ← embedded instance UI
│   └── screens/
│       ├── setup.tsx            ← picker (port of desktop setup/app.tsx)
│       └── instance-host.tsx    ← opens an instance
├── build/                       ← platform manifest fragments
│   ├── ios-info.plist.fragment.xml
│   ├── android-manifest.fragment.xml
│   └── android-network-security-config.xml
└── resources/                   ← icon.png + splash.png source assets
```

The mobile app reuses two existing workspace packages directly:

- **`@codeplane-ai/shared`** — `SavedInstance` types, `parseHeaders` /
  `formatHeaders` helpers, the same per-instance schema desktop uses.
- **`@codeplane-ai/ui`** — Tailwind layer + design-token CSS variables
  so colours, typography and component styling match desktop pixel-for-pixel.

## Prerequisites

| Tool                 | Why                              |
| -------------------- | -------------------------------- |
| Node ≥ 20 / Bun 1.3+ | workspace dep manager            |
| Xcode 15+            | iOS build (macOS only)           |
| Android Studio       | Android build (any host OS)      |
| JDK 17+              | required by the Android Gradle plugin |
| CocoaPods            | iOS native dep install           |

## First-time setup

```bash
# 1. install deps from the repo root
bun install

# 2. build the picker bundle
bun run --cwd packages/mobile build

# 3. generate the platform-specific projects (only once)
bun run --cwd packages/mobile cap:add:ios
bun run --cwd packages/mobile cap:add:android

# 4. drop your icon + splash sources in resources/, then generate variants
cp ../desktop/build/icon.png resources/icon.png
bunx @capacitor/assets generate --android --ios

# 5. apply the manifest fragments in build/ to the generated projects
#    (one-time copy/paste — see comments in the fragment files)
```

After that, the iteration loop is:

```bash
bun run --cwd packages/mobile dev          # Vite dev server (browser preview)
bun run --cwd packages/mobile cap:run:ios  # build + run on iOS simulator/device
bun run --cwd packages/mobile cap:run:android
```

## Releasing

```bash
bun run --cwd packages/mobile package:ios       # produces an .xcarchive
bun run --cwd packages/mobile package:android   # produces app/build/outputs/apk
```

The remaining steps (App Store Connect upload, Play Console upload,
signing certificates) live outside this repo.

## Sign-in

Sign-in works **automatically**, the same way it does on desktop —
no setup, no client IDs, no provider list. When the user taps an
instance in the picker, the mobile shell opens it in the **system
browser** (`SFSafariViewController` on iOS, Custom Tabs on Android)
via [`@capacitor/browser`](https://capacitorjs.com/docs/apis/browser).
The system browser is a real native browser session: full cookie
support, full top-level navigation, full OAuth redirect handling.

That means the Codeplane server's own sign-in screen — whatever IdP
it uses (Google, GitHub, Microsoft, Sign in with Apple, magic link,
SAML, …) — just works. The user taps "Sign In" inside Codeplane's
UI, the IdP's page opens, they authenticate, the redirect comes back
to the Codeplane host which sets a session cookie, and they land on
the signed-in dashboard. Exactly like Electron's `BrowserWindow` on
desktop.

When the user taps **Done** in the system browser (iOS) or backs out
(Android), the shell routes them back to the picker.

### Why the system browser, not an iframe

Three reasons we don't try to embed the instance in an iframe inside
the picker WebView:

1. **App Store policy.** Apple's review guideline 4.5 disallows
   embedded auth flows in WKWebView. Sign-in must happen in
   `SFSafariViewController` or `ASWebAuthenticationSession`.
2. **Third-party cookie restrictions.** Modern WebKit blocks
   third-party cookies in iframes by default — OAuth flows that
   bounce through `accounts.google.com` etc. can't set the cookies
   they need to.
3. **`X-Frame-Options: DENY`.** Many IdPs explicitly refuse to be
   framed, so an in-iframe sign-in flow would just show a blank page.

The system browser side-steps all three: it's a top-level browser
window, it's not an iframe, and Apple explicitly endorses it for
in-app auth.

### Optional: programmatic SSO API

There's still a programmatic OAuth 2.0 + PKCE module in
[`src/platform/sso.ts`](src/platform/sso.ts) for advanced workflows
that need first-party token handling (e.g. service-token bootstrap,
push-driven Live Activities that authenticate against a Codeplane
server API directly). It is **not** wired into the form by default —
the system-browser path covers what 99% of users need.

## iOS Live Activities

Long-running tasks and queued message bursts surface on the Lock Screen
and Dynamic Island via ActivityKit. The user opts in per instance with
the **Live Activities** toggle in the instance edit sheet (defaults to
on for iOS 16.1+ devices that have it enabled in Settings).

The auto-trigger heuristic lives in
[`src/platform/task-monitor.ts`](src/platform/task-monitor.ts):

- start once a task has been running ≥ 12 s, **or**
- start as soon as `queueDepth ≥ 3`,
- update at most every ~3 s (ActivityKit's recommended throttle),
- end with a 4 s grace so the terminal state is visible on the Lock Screen.

The Swift sources, postMessage protocol the embedded instance UI must
emit, and Xcode integration steps are documented in
[`build/ios-live-activity/README.md`](build/ios-live-activity/README.md).

The widget design uses the desktop's brand palette (`#0B0D10` background,
`#5B8CFF` accent, brand chevron) so the activity reads as part of the
same product. When a task reports no `progress`, the bar is animated
indeterminate instead of stuck at 0%.

## How it relates to the desktop

| Concept                     | Desktop                                | Mobile                                       |
| --------------------------- | -------------------------------------- | -------------------------------------------- |
| Outer shell                 | Electron `BrowserWindow`               | Capacitor `WKWebView` / `WebView`            |
| Renderer bridge             | `window.codeplaneDesktop` via preload  | `window.codeplaneMobile` via `platform/api`  |
| Saved instances             | `electron-store` JSON                  | `@capacitor/preferences`                     |
| Auth header storage         | per-`Session` `webRequest` injection   | OS keychain (`capacitor-secure-storage-plugin`) |
| Picker UI                   | `setup/app.tsx` (Solid)                | `screens/setup.tsx` (same Solid components, mobile UX) |
| Instance UI host            | second `BrowserWindow` (`ui-host.ts`)  | `<iframe>` in `webview-host.tsx`             |
| Custom URL scheme           | `app.setAsDefaultProtocolClient`       | `CFBundleURLTypes` + Android `intent-filter` |

## Status

This package is the production-shaped scaffold:

- ✅ All renderer code (picker, edit form, instance host) is implemented.
- ✅ Platform bridge wires Preferences, secure storage, deep links,
  splash, status bar, haptics, network status, notifications.
- ✅ Capacitor config plus iOS / Android manifest fragments.
- ⚠️  `npx cap add ios` / `cap add android` must be run on a machine
  with the respective toolchains; those commands generate the native
  Xcode / Gradle projects this repo deliberately does not commit.
- ⚠️  Per-request native header injection on the embedded instance
  webview is implemented through `CapacitorHttp` for the picker side;
  the embedded `<iframe>` inherits cookies but for header-only auth
  flows you'll want to bridge through a service worker — tracked as a
  follow-up.
