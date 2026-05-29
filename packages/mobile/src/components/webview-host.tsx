import { Component, Show, createEffect, createSignal, getOwner, onCleanup, onMount, runWithOwner } from "solid-js"
import { InAppBrowser, ToolBarType } from "@capgo/inappbrowser"
import type { CodeplaneMobileAPI } from "../platform/api"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import {
  isTaskMessage,
  isToggleMessage,
  MAX_LIVE_ACTIVITY_SESSIONS,
  type LiveActivityStateMessage,
} from "@codeplane-ai/shared/live-activity-protocol"
import { createTaskMonitor } from "../platform/task-monitor"

/**
 * Host for an opened Codeplane instance.
 *
 * Reproducing the desktop's per-instance `BrowserWindow` model on
 * iOS / Android requires a top-level webview that is *ours* — not an
 * iframe inside the picker, and not the system browser surface. Two
 * earlier attempts taught us why:
 *
 *   1. **`<iframe>` in the picker WKWebView** — gave us cookie
 *      persistence (the picker WebView's jar survives launches), but
 *      every SSO flow we care about refused to render. Cloudflare
 *      Access serves its team-domain login with
 *      `X-Frame-Options: SAMEORIGIN`. Google / Microsoft / GitHub /
 *      Okta send `X-Frame-Options: DENY`. WebKit further partitions
 *      third-party iframe cookies per top-level origin, so even when
 *      a redirect made it through, the `CF_Authorization` cookie set
 *      on the team domain landed in the picker's storage partition
 *      and was invisible the next time the user opened the instance.
 *
 *   2. **`@capacitor/browser` (SFSafariViewController)** — fixed
 *      every framing and partitioning issue, but felt like a
 *      half-step out of the app: presented as a sheet, with Safari's
 *      own chrome, and Apple's documented cookie-sharing semantics
 *      with Safari are subtle in practice (recurring SSO prompts on
 *      some IdP redirect chains, especially when the IdP issues
 *      first-party cookies that ITP later evicts).
 *
 * The fix is the third option, which is what Electron's
 * `BrowserWindow` is on the desktop: a dedicated, top-level
 * `WKWebView` (iOS) / `WebView` (Android) that **shares the system
 * cookie jar with the app** (`WKWebsiteDataStore.default()` on iOS),
 * presents fullscreen inside our own modal, and handles every SSO
 * redirect natively — there's no frame at all, so no
 * `X-Frame-Options`, and no third-party-cookie partitioning to
 * worry about.
 *
 * `@capgo/inappbrowser` (`InAppBrowser.openWebView`) is the
 * Capacitor 7-compatible plugin that gives us exactly this surface.
 * The `closeEvent` callback brings the user back to the picker
 * (matches the desktop's "close window → return to picker") and the
 * compact toolbar shows just the host name and a Done button —
 * native iOS sheet ergonomics, no browser chrome.
 *
 * Why we still keep an `<iframe>` path on the web fallback:
 *   1. There is no `WKWebView` in a desktop browser — InAppBrowser
 *      falls back to `window.open` which would pop a tab.
 *   2. The picker is normally developed against a Codeplane instance
 *      we run locally — same-origin, so the iframe restrictions
 *      above don't bite during development.
 */
export const WebviewHost: Component<{
  instance: SavedInstance
  api: CodeplaneMobileAPI
  onClose: () => void
}> = (props) => {
  const [loaded, setLoaded] = createSignal(false)
  const [online, setOnline] = createSignal(true)
  const [browserOpen, setBrowserOpen] = createSignal(false)
  const [openError, setOpenError] = createSignal<string | null>(null)
  /**
   * Web fallback only: gate the iframe behind an explicit Sign-in tap
   * so the picker is usable in dev without a live instance to load.
   * On native we drive the InAppBrowser lifecycle directly through
   * `browserOpen()`. The flag survives instance switches (see the
   * createEffect below) so a re-route to a new instance starts a
   * fresh load.
   */
  const [started, setStarted] = createSignal(false)
  let frameRef: HTMLIFrameElement | undefined
  let taskMonitor: ReturnType<typeof createTaskMonitor> | undefined
  const injectTimers: number[] = []

  // Captured synchronously during render so teardown registered later
  // from the *async* `onMount` (after its first `await`, where Solid's
  // ambient owner is already gone) still attaches to this component's
  // owner — otherwise the cleanup silently never runs and we leak the
  // network/window/InAppBrowser listeners on every instance close.
  const owner = getOwner()

  const clearInjectTimers = () => {
    for (const timer of injectTimers) clearTimeout(timer)
    injectTimers.length = 0
  }

  const isNative = props.api.isNative
  const host = () => {
    try {
      return new URL(props.instance.url).host
    } catch {
      return props.instance.url
    }
  }

  const watchNetwork = async () => {
    const status = await props.api.network.current()
    setOnline(status.connected)
    return props.api.network.onChange((info) => setOnline(info.connected))
  }

  /**
   * Source of truth for which sessions the user opted in to the Live
   * Activity surface. Mirrored into Capacitor preferences so it
   * survives kills, and re-broadcast to the embedded UI on every
   * change so the toggle stays in sync.
   */
  const [optedInSessionIds, setOptedInSessionIds] = createSignal<string[]>([])
  /**
   * Tri-state cache of "does the OS surface Live Activities at all?".
   * Set once on mount via `liveActivities.isSupported()` and reused
   * for every broadcast so we don't await on each toggle.
   */
  const [laSupported, setLASupported] = createSignal(false)

  /** Push a `codeplane:la-state` snapshot to the iframe. The native
   *  InAppBrowser path uses `executeScript` instead, since there's no
   *  iframe contentWindow to talk to. */
  const broadcastLAState = (lastError?: LiveActivityStateMessage["lastError"]) => {
    const message: LiveActivityStateMessage = {
      type: "codeplane:la-state",
      // Web fallback always reports "not supported" because there is
      // no Lock Screen for it to render on; native iOS reports per
      // ActivityKit. The dev-time iframe still wires the toggle so it
      // can be QA'd, but the toggle hides behind `supported` on real
      // mobile builds where the OS isn't iOS 16.2+.
      supported: laSupported(),
      enabledSessionIds: optedInSessionIds(),
      maxAllowed: MAX_LIVE_ACTIVITY_SESSIONS,
      lastError,
    }
    if (frameRef?.contentWindow) {
      try {
        frameRef.contentWindow.postMessage(message, "*")
      } catch {
        /* contentWindow is cross-origin and got navigated away — drop */
      }
    }
    // Native InAppBrowser path: re-inject the snapshot via
    // `executeScript` so the embedded UI's window-level message
    // listener picks up the new state. Fire-and-forget — the embedded
    // UI keeps the previous frame state if the inject fails for any
    // reason (e.g. modal already torn down).
    if (isNative) {
      void injectLAState()
    }
  }

  /**
   * Apply a `codeplane:la-toggle` request from the embedded UI. The
   * shell is the source of truth — we add to / remove from the set
   * here, persist, then broadcast back so the UI's optimistic state
   * always reconciles to what's actually stored.
   */
  const applyLAToggle = async (sessionId: string, on: boolean) => {
    const current = optedInSessionIds()
    if (on && !current.includes(sessionId)) {
      if (current.length >= MAX_LIVE_ACTIVITY_SESSIONS) {
        // Reject with a diagnostic — the UI surfaces it as a tooltip
        // so the user knows why their tap didn't take.
        broadcastLAState({ reason: "limit", sessionId })
        return
      }
      const next = [...current, sessionId]
      setOptedInSessionIds(next)
      await props.api.instances.prefs.setLiveActivitySessionIds(props.instance.id, next)
      taskMonitor?.setOptedInSessionIds(next)
    } else if (!on && current.includes(sessionId)) {
      const next = current.filter((id) => id !== sessionId)
      setOptedInSessionIds(next)
      await props.api.instances.prefs.setLiveActivitySessionIds(props.instance.id, next)
      taskMonitor?.setOptedInSessionIds(next)
    }
    broadcastLAState()
  }

  const onWindowMessage = (event: MessageEvent) => {
    if (!isToggleMessage(event.data)) return
    void applyLAToggle(event.data.sessionId, event.data.enabled)
  }

  /**
   * Fetch the LA prefs + native support flag and populate the
   * webview-host's reactive signals. **Runs on every host instance,
   * including native.** Previously this lived inside
   * `wireTaskMonitor`, which early-returns on native because the
   * iframe-based task monitor doesn't apply there — but the prefs
   * and the `isSupported()` probe DO apply on native (they drive
   * the `__codeplaneLA` snapshot the picker injects into the
   * InAppBrowser's WKWebView). Pre-fix: native always saw
   * `laSupported()` stuck at its default `false`, so the embedded
   * UI's "Show on Lock Screen" menu item never rendered.
   */
  type LAStateLoad = {
    liveActivitiesEnabled: boolean
    opted: string[]
    supportedStatus: { supported: boolean; enabled: boolean }
  }

  /**
   * One-shot loader for the LA state. Reads the persisted prefs and
   * the native `isSupported` flag, populates the signals, and returns
   * the resolved object so callers that need its fields can read them
   * without re-fetching.
   *
   * Wrapped by `ensureLAStateLoaded` for promise-caching — see below.
   */
  const loadLAState = async (): Promise<LAStateLoad> => {
    const [liveActivitiesEnabled, opted, supportedStatus] = await Promise.all([
      props.api.instances.prefs.getLiveActivitiesEnabled(props.instance.id),
      props.api.instances.prefs.getLiveActivitySessionIds(props.instance.id),
      props.api.liveActivities.isSupported().catch(() => ({ supported: false, enabled: false })),
    ])
    setOptedInSessionIds(opted)
    setLASupported(supportedStatus.supported)
    return { liveActivitiesEnabled, opted, supportedStatus }
  }

  /**
   * Cached promise for the LA-state load. Every `injectLAState` call
   * awaits this so the snapshot we send to the page reflects the real
   * `isSupported` answer, not whatever `laSupported()` happened to
   * return at the moment of the call.
   *
   * Why: SolidJS runs `createEffect` before `onMount`. The effect
   * calls `openInWebView()` which, on resolve, fires the inject
   * staircase. Meanwhile `onMount` kicks off `wireTaskMonitor` which
   * is what populates `laSupported`. Whichever async settles first
   * wins — and on a cold launch the WKWebView often opens BEFORE the
   * native `liveActivities.isSupported()` round-trip completes, so
   * the first inject's `supported: laSupported()` is the default
   * `false`. The page's `LiveActivityProvider` reads that snapshot,
   * sets `supported = false`, and the toggle stays hidden until the
   * user navigates the embedded UI (next `urlChangeEvent` re-injects
   * — but by then they've already seen it disappear).
   *
   * Promise-caching here means: the first caller (whoever wins the
   * race) starts the load; everyone else awaits the SAME promise.
   * No duplicate native round-trips, no stale reads.
   */
  let laStatePromise: Promise<LAStateLoad> | undefined
  const ensureLAStateLoaded = (): Promise<LAStateLoad> => {
    if (!laStatePromise) laStatePromise = loadLAState()
    return laStatePromise
  }

  const wireTaskMonitor = async () => {
    // Always populate the LA state — it drives the snapshot the
    // shell injects on every navigation, so it has to be ready
    // regardless of whether we're on native or web. We go through
    // `ensureLAStateLoaded()` so this shares the same cached promise
    // as `injectLAState` — whichever caller arrives first does the
    // native round-trip.
    const state = await ensureLAStateLoaded()
    // We create a monitor on BOTH transports:
    //   • web preview / dev — `frame` listens on `window.message` for
    //     events from the iframe's contentWindow.
    //   • native iOS — no `frame`, so the monitor's iframe listener is
    //     skipped. The host instead pumps events into `taskMonitor.ingest`
    //     from its `messageFromWebview` listener (set up in the native
    //     post-open block below). Either way the same selectTopTwo /
    //     start / update / end logic runs.
    if (!isNative && !frameRef) return
    taskMonitor = createTaskMonitor({
      ...(isNative ? {} : { frame: frameRef! }),
      liveActivities: props.api.liveActivities,
      // Single activity per instance — only sessions the user has
      // explicitly opted in surface as Live Activities. The monitor
      // ignores everything else.
      instanceId: props.instance.id,
      instanceLabel: props.instance.label || host(),
      instanceHost: host(),
      enabled: state.liveActivitiesEnabled,
      optedInSessionIds: state.opted,
    })
    // Push initial state to the embedded UI as soon as the monitor is
    // wired so the toggle renders in the right state on first paint.
    broadcastLAState()
  }

  /**
   * Open the instance in our own top-level `WKWebView`/`WebView`.
   *
   * The presentation is deliberately **chromeless** — `toolbarType:
   * BLANK` hides the entire navigation bar so the modal is just the
   * instance UI from edge to edge, the same way the desktop's
   * `BrowserWindow` shows the workspace with no browser chrome on top.
   *
   * With the toolbar gone there is no native dismiss button. We paint
   * our own floating Back pill via `executeScript`, called once right
   * after the webview opens and again on every `urlChangeEvent`
   * (registered up in `onMount`). That keeps the button visible:
   *   - on the initial instance URL,
   *   - through every redirect in the SSO chain (Cloudflare Access →
   *     IdP → callback → instance UI), and
   *   - across any client-side SPA navigation inside the instance.
   *
   * Why not `preShowScript` (the plugin's "auto-inject on every
   * load" hook): the plugin guards that option with
   * `isPresentAfterPageLoad: true`, which would defer the modal until
   * the first navigation finishes. SSO chains issue 4+ redirects
   * before any page truly "loads", so the modal would never appear.
   * Driving the inject from `executeScript` lets us present the modal
   * immediately *and* keep the close button alive on every page.
   */
  /**
   * Try the offline-cache presenter first when:
   *   1. The native plugin is compiled in (`offlineCache.isSupported()`),
   *   2. The asset crawler has finished a full pass for this instance
   *      (`assetCache.get(...)` is `ready` with a `cachedVersion`),
   *   3. The crawled version matches what the picker last probed for
   *      `openedVersion` (so we don't serve a stale bundle that talks
   *      to a server that has since moved on — the proxy fall-through
   *      still works, but the SPA shell would diverge from the API
   *      schema).
   *
   * Returns `true` when the cached path was used (and the modal is on
   * screen). Returns `false` when the caller should fall back to the
   * live-origin `@capgo/inappbrowser` path.
   *
   * Failure modes (cache directory deleted underneath us, the Swift
   * plugin rejecting because index.html is missing, network-related
   * failures during proxy startup) are caught and downgraded to a
   * `false` return so the InAppBrowser fallback gets a try.
   */
  const tryOpenInOfflineCache = async (): Promise<boolean> => {
    if (!isNative) return false
    try {
      const supported = await props.api.offlineCache.isSupported()
      if (!supported) return false
      const record = await props.api.assetCache.get(props.instance.id)
      if (!record || record.status !== "ready" || !record.cachedVersion) return false
      // The asset cache only stores ONE version per instance. If the
      // server has bumped past the cached version since the last
      // crawl, we still have a usable bundle (the proxy paths handle
      // anything new the SPA fetches) — but if the version has gone
      // BACK we definitely don't want to serve newer code against an
      // older server, so refuse.
      const remote = await props.api.uiCache.get(props.instance.id)
      if (remote?.remoteVersion && record.cachedVersion !== remote.remoteVersion) {
        // Server has moved past — let the asset-cache's auto-crawl
        // pick the new version up; meanwhile the safe bet is the
        // live origin.
        return false
      }
      const headers = await props.api.instances.secrets.get(props.instance.id)
      const bg = getComputedStyle(document.documentElement)
        .getPropertyValue("--background-base")
        .trim()
      // eslint-disable-next-line no-console
      console.log("[webview-host] offline-cache open", {
        instance: props.instance.id,
        version: record.cachedVersion,
      })
      await props.api.offlineCache.openInstance({
        instanceId: props.instance.id,
        version: record.cachedVersion,
        originUrl: props.instance.url,
        authHeaders: headers,
        toolbarColor: bg || "#101010",
        title: props.instance.label || host(),
      })
      // The native side fires its own close listener; webview-host's
      // existing `closeEvent` listener (registered at mount) is for
      // the InAppBrowser plugin specifically, so we register a
      // separate close listener for the offline plugin in `onMount`.
      void props.api.uiCache.markOpened(props.instance.id, record.cachedVersion)
      return true
    } catch (err) {
      console.warn("[webview-host] offline-cache open failed, falling back", err)
      return false
    }
  }

  const openInWebView = async () => {
    clearInjectTimers()
    setStarted(true)
    setOpenError(null)
    // Prefer the on-device cache when ready; falls through to the
    // live-origin InAppBrowser flow otherwise.
    if (await tryOpenInOfflineCache()) {
      setBrowserOpen(false)
      return
    }
    setBrowserOpen(true)
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue("--background-base")
      .trim()
    try {
      // eslint-disable-next-line no-console -- intentional: visible in Safari Web Inspector
      console.log("[webview-host] opening", props.instance.url)
      await InAppBrowser.openWebView({
        url: props.instance.url,
        title: props.instance.label || host(),
        // BLANK = no toolbar, no URL bar, no chrome. Just the instance
        // UI fullscreen — matches how the desktop renders an instance
        // inside an Electron BrowserWindow.
        toolbarType: ToolBarType.BLANK,
        // Status-bar background colour. The plugin auto-derives the
        // foreground tone (light vs dark icons) from the luminance of
        // this hex.
        toolbarColor: bg || "#101010",
        // Keep `isInspectable: true` on iOS so Safari → Develop →
        // Simulator picks up the in-app WebView and the user can
        // watch network + JS in real time.
        isInspectable: true,
      })
      // First-paint inject staircase. `openWebView` resolves on iOS
      // *as soon as the WKWebView is created* — well before the page
      // has actually loaded — so a single inject right here can
      // race the document's parser, get appended to a DOM that is
      // about to be replaced, and silently disappear. We fire a
      // few staggered injects to cover the window between webview
      // creation and the first navigation finishing. The
      // `urlChangeEvent` listener takes over after that. Each call
      // is idempotent (the script no-ops if our button already
      // exists), so duplicates are harmless.
      void injectCloseButton()
      void injectLAState()
      void injectFontFallback()
      injectTimers.push(window.setTimeout(() => void injectCloseButton(), 250))
      injectTimers.push(window.setTimeout(() => void injectCloseButton(), 750))
      injectTimers.push(window.setTimeout(() => void injectCloseButton(), 1500))
      // Re-inject the LA state on the same staircase. SPA-style apps
      // sometimes replace `document` between the openWebView resolve
      // and the first true page paint; without these later passes the
      // embedded UI would render its first frame before the snapshot
      // landed and the toggle would flash hidden→visible.
      injectTimers.push(window.setTimeout(() => void injectLAState(), 250))
      injectTimers.push(window.setTimeout(() => void injectLAState(), 1500))
      // Same staircase for the font fallback so emoji glyphs are in
      // place before the first message paints. The injection itself
      // is idempotent (checks for `#__codeplane_mobile_fonts`).
      injectTimers.push(window.setTimeout(() => void injectFontFallback(), 250))
      injectTimers.push(window.setTimeout(() => void injectFontFallback(), 1500))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn("[webview-host] InAppBrowser.openWebView failed", err)
      setBrowserOpen(false)
      setOpenError(message)
    }
  }

  // Wraps the InAppBrowser executeScript with the close-button source.
  // `id` is omitted so the script lands in every open webview (we only
  // ever have one, but the broadcast semantics are the safer default).
  // The injected script itself also self-polls for ~3 s after each run
  // (see `closeButtonScript`), so even if all the JS-side timers fire
  // against a soon-to-be-replaced document the button will still
  // re-appear on its own once the real page has painted.
  const injectCloseButton = async () => {
    try {
      await InAppBrowser.executeScript({ code: closeButtonScript() })
    } catch (err) {
      // Non-fatal — the button's only purpose is the close affordance,
      // and the user can still kill the modal by force-quitting.
      console.warn("[webview-host] failed to inject close button", err)
    }
  }

  /**
   * Inject the platform-specific font-family fallback into the loaded
   * instance UI — covers two reported bugs:
   *
   *   1. Emojis render as `[?]` tofu inside the WKWebView when the
   *      user's instance is running an OLDER codeplane version (≤ v28.0.2)
   *      whose CSS font-family stacks didn't yet include the Apple
   *      Color Emoji / Segoe UI Emoji / Noto Color Emoji families.
   *      Mobile-shell users can't always upgrade their server, so the
   *      shell guarantees the fallback at load time regardless.
   *
   *   2. The thinking-indicator's braille glyph (`⠿` etc.) falls
   *      through to .notdef on iOS because no shipped iOS font has
   *      U+2800–U+28FF coverage. The SVG fallback in `LogoLoader`
   *      handles that path on its own (pixel-density probe → `svg`
   *      render mode), so this injection's job is purely the emoji
   *      side; no font binary is shipped.
   *
   * The injection overrides the two CSS variables the chat surface
   * actually uses (`--font-family-sans` / `--font-family-mono`) on
   * `:root`, so any rule reading `var(--font-family-sans)` picks up
   * the new tail. We deliberately do NOT brute-force `* { font-family
   * !important }` — that would fight every monospace / icon-font
   * declaration in the app.
   *
   * Idempotent — the injected `<style id="__codeplane_mobile_fonts">`
   * checks for itself and bails on re-runs, so the URL-change loop
   * doesn't pile up duplicate stylesheets across SPA navigations or
   * SSO redirect chains.
   */
  const injectFontFallback = async () => {
    if (!isNative) return
    const code = `(function(){try{
      if (document.getElementById('__codeplane_mobile_fonts')) return;
      var s = document.createElement('style');
      s.id = '__codeplane_mobile_fonts';
      s.textContent = [
        ':root, body {',
        '  --font-family-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji" !important;',
        '  --font-family-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji" !important;',
        '}'
      ].join('\\n');
      (document.head || document.documentElement).appendChild(s);
    }catch(_){/* swallow — font fallback failure should not break the UI */}})();`
    try {
      await InAppBrowser.executeScript({ code })
    } catch (err) {
      // Non-fatal — without the override the embedded UI keeps its
      // original (pre-v28.0.3) font stack, which renders text fine but
      // shows tofu for emoji. The close button + LA state injections
      // still go through.
      console.warn("[webview-host] failed to inject font fallback", err)
    }
  }

  /**
   * Inject the Live Activity snapshot into the WKWebView. The embedded
   * Codeplane web UI reads `window.__codeplaneLA` to decide whether to
   * render the bell toggle / overflow menu item, AND a postMessage on
   * `window` to keep its reactive context in sync. Both signals come
   * from this script — the embedded UI never reaches back into the
   * shell on its own.
   *
   * Called once right after `openWebView` resolves and again on every
   * `urlChangeEvent` so that SPA navigations + SSO redirects don't
   * lose the snapshot when the document is replaced. The script is
   * idempotent (overwrites the global + dispatches the message
   * unconditionally) so re-runs are safe.
   *
   * The `Codeplane/Mobile` UA tag the picker's Capacitor config
   * already appends is the second half of the gate the embedded UI
   * checks — without that tag, even an injected `supported: true` is
   * ignored on the embedded side. That keeps a malicious page from
   * forging a Live Activity surface for itself outside the shell.
   */
  const injectLAState = async () => {
    if (!isNative) return
    // Wait for the cached LA-state load to settle so `laSupported()`
    // reflects the real native `isSupported()` answer, not the
    // default `false` that's still in the signal during the cold-open
    // race. See `ensureLAStateLoaded` for the rationale.
    await ensureLAStateLoaded().catch(() => undefined)
    const payload = {
      type: "codeplane:la-state",
      supported: laSupported(),
      enabledSessionIds: optedInSessionIds(),
      maxAllowed: MAX_LIVE_ACTIVITY_SESSIONS,
    }
    // eslint-disable-next-line no-console
    console.log("[webview-host] la: injecting state", {
      supported: payload.supported,
      enabled: payload.enabledSessionIds.length,
    })
    // Two-channel update — `executeScript` writes the synchronous
    // `window.__codeplaneLA` snapshot the embedded UI reads on first
    // mount, AND `postMessage` fires the plugin's `messageFromNative`
    // event for every later refresh. We need both:
    //
    //   • executeScript alone can lose its dispatched MessageEvent
    //     to a "no listener installed yet" race when the page is
    //     still parsing — but its synchronous side-effect on `window`
    //     still gets picked up by `readInjectedSnapshot()` at
    //     provider mount.
    //   • postMessage alone has no first-paint snapshot — the page
    //     mounts before native can fire `messageFromNative`, so the
    //     toggle would flash hidden→visible on every navigation.
    //
    // Together: snapshot for instant first paint, postMessage for
    // every subsequent shell-driven update.
    const json = JSON.stringify(payload)
    const code = `(function(){try{
      var data = ${json};
      window.__codeplaneLA = {
        supported: data.supported,
        enabledSessionIds: data.enabledSessionIds,
        maxAllowed: data.maxAllowed,
      };
      window.dispatchEvent(new MessageEvent('message', { data: data, source: window }));
    }catch(_){/* injection failed — postMessage path still delivers below */}})();`
    try {
      await InAppBrowser.executeScript({ code })
    } catch (err) {
      console.warn("[webview-host] executeScript LA state failed", err)
    }
    try {
      // `postMessage` fires `messageFromNative` on the embedded
      // window — guaranteed to land in the page world regardless of
      // executeScript's content-world resolution.
      await InAppBrowser.postMessage({ detail: payload })
    } catch (err) {
      console.warn("[webview-host] postMessage LA state failed", err)
    }
  }

  onMount(async () => {
    // Critical-path: keep this function as non-blocking as possible.
    // Anything we await here delays InAppBrowser.openWebView (which
    // fires from the createEffect just below) by a microtask, which
    // is observable as a "tap → modal" gap on real devices. So:
    //   - the LA window-message listener registers synchronously,
    //   - watchNetwork + wireTaskMonitor run in parallel,
    //   - InAppBrowser listeners register concurrently with the
    //     createEffect's openInWebView call (the listeners catch
    //     events that fire later, so order doesn't matter for
    //     correctness as long as both are in flight before
    //     openWebView resolves).
    //
    // Kick off the LA-state load IMMEDIATELY so its cached promise is
    // in flight before openInWebView's inject staircase starts. The
    // first inject `await`s this same promise so the snapshot we send
    // to the page reflects the real native `isSupported` answer rather
    // than the default `false` — fixing the cold-open race that hid
    // the toggle on first launch.
    void ensureLAStateLoaded()
    const offNetPromise = watchNetwork()
    const wireTaskPromise = wireTaskMonitor()

    // Listen for Live Activity toggle requests coming back from the
    // embedded UI. Synchronous registration: no native bridge call,
    // so this never gates the open path.
    if (typeof window !== "undefined") {
      window.addEventListener("message", onWindowMessage, false)
    }

    const offHandles: Array<{ remove: () => Promise<void> } | undefined> = []
    const offNet = await offNetPromise
    await wireTaskPromise

    if (isNative) {
      // Defensive: clear any stray listeners from a previous host
      // mount that may not have torn down cleanly. The InAppBrowser
      // plugin's `removeAllListeners` is per-event-name so we hit
      // both. Without this, the device log showed `closeEvent`
      // firing twice on the second open of an instance — the prior
      // mount's listener was still attached because the dismiss path
      // unmounted the screen before the async `addListener.then`
      // had pushed its handle into `offHandles`, leaving the
      // cleanup closure with nothing to remove.
      try {
        await InAppBrowser.removeAllListeners()
      } catch {
        /* nothing to remove → ignore */
      }

      // Single-fire guard. The plugin sometimes emits `closeEvent`
      // twice for one Back tap (we've seen it during the modal's
      // dismiss-animation tear-down on iOS 26). Calling `props.onClose`
      // twice in a row navigates → setup → setup, which (a) wastes a
      // re-render and (b) races with the next mount's listener
      // registration.
      let dispatchedClose = false
      const onCloseOnce = () => {
        if (dispatchedClose) return
        dispatchedClose = true
        // eslint-disable-next-line no-console
        console.log("[webview-host] closeEvent")
        clearInjectTimers()
        setBrowserOpen(false)
        props.onClose()
      }

      // Awaited so the handle is in `offHandles` BEFORE any
      // user-driven dismiss can fire the cleanup. Earlier we did
      // `addListener(...).then(handle => offHandles.push(handle))`
      // which left a window where the cleanup ran with an empty
      // array, leaking the listener to the next mount.
      try {
        const handle = await InAppBrowser.addListener("closeEvent", onCloseOnce)
        offHandles.push(handle)
      } catch {
        /* listener registration failed — modal will still work,
           dismiss will just no-op until force-quit */
      }

      // Same listener registration for the offline-cache plugin's
      // closeEvent. Native-side ARC dismisses the modal whether the
      // user taps the floating close pill or swipes down (the host
      // controller fires `viewDidDisappear` either way), and we want
      // the picker to re-mount in BOTH cases. The shared `onCloseOnce`
      // dedupe means a dual-listener world (offline + InAppBrowser
      // both wired) doesn't double-fire if both happen to be active.
      try {
        const handle = await props.api.offlineCache.addCloseListener(onCloseOnce)
        offHandles.push(handle)
      } catch {
        /* offline plugin not present (web build, Android until the
           Kotlin port lands) — InAppBrowser handles dismiss alone. */
      }

      // urlChangeEvent powers (a) the redirect-chain logging shown in
      // Safari Web Inspector when SSO breaks, and (b) the floating
      // close-button re-inject after every navigation. Same
      // synchronous-await pattern as above so the handle lands in
      // `offHandles` before any tear-down.
      let lastLoggedUrl: string | undefined
      try {
        const handle = await InAppBrowser.addListener(
          "urlChangeEvent",
          (event: { url?: string } & object) => {
            const url = event?.url
            // Plugin fires both on navigation start AND commit for
            // the same URL — collapse them so we don't double-inject
            // and double-log.
            if (typeof url === "string") {
              if (url === lastLoggedUrl) return
              lastLoggedUrl = url
            }
            // eslint-disable-next-line no-console
            console.log("[webview-host] urlChange →", url ?? event)
            void injectCloseButton()
            // Re-inject LA state too so it survives every navigation
            // (SSO redirect chain, in-app SPA route changes, etc).
            void injectLAState()
            // Re-inject the font fallback — every redirect / SPA route
            // change replaces (or may replace) the document, so the
            // `#__codeplane_mobile_fonts` style element from the
            // previous page is gone. The script is idempotent so a
            // re-fired URL change against the SAME document is a no-op.
            void injectFontFallback()
          },
        )
        offHandles.push(handle)
      } catch {
        /* listener registration failed — proceed without auto-inject;
           the JS-side staircase in `openInWebView` still fires */
      }

      // messageFromWebview is the inverse of `InAppBrowser.postMessage`
      // — it fires on the host every time the embedded WKWebView calls
      // `window.mobileApp.postMessage(...)`. THIS is the channel the
      // embedded Codeplane web UI uses to send LA toggles and per-task
      // progress events to the shell on native iOS; without it the
      // toggle silently no-ops because there's no parent frame to
      // postMessage to. (The dev / web preview path still uses
      // `window.parent.postMessage` and is handled by the
      // `onWindowMessage` listener registered above.)
      //
      // Event shape, the real one (v28.1.4 had this WRONG and I assumed
      // `event.data` was the payload — see `addListener("messageFromWebview", …)`
      // typing in the @capgo/inappbrowser definitions and the iOS impl
      // at WKWebViewController.swift:1051 which calls
      // `emit("messageFromWebview", data: messageBody)`):
      //
      //   1. Bare payload: webview calls
      //      `mobileApp.postMessage({type:"codeplane:la-toggle", …})` →
      //      the host receives the dict AS the event object directly.
      //      i.e. `event = {type:"codeplane:la-toggle", …}`. There's no
      //      `.data` wrapper; the `data:` in the Swift call is just the
      //      parameter label.
      //
      //   2. Wrapped form: webview calls
      //      `mobileApp.postMessage({detail:{type:"codeplane:la-toggle", …}})` →
      //      the host receives `event = {detail:{type:"codeplane:la-toggle", …}}`.
      //      The plugin's typed signature documents this `{id?, detail?,
      //      rawMessage?}` shape; some pages prefer it because it lets
      //      them bundle a correlation `id` next to a separate detail
      //      payload.
      //
      //   3. Stringified body fallback: if the webview sends a value
      //      that isn't a dict (a raw string, number, etc.) the iOS
      //      impl emits `{rawMessage: String(describing: body)}`. We
      //      attempt JSON.parse on that as a last resort so a
      //      `mobileApp.postMessage(JSON.stringify(payload))` from a
      //      paranoid embedded UI still works.
      //
      // We try all three. The same listener handles toggle messages
      // AND task messages — the type guard does the discrimination.
      const extractPayload = (event: unknown): unknown => {
        if (!event || typeof event !== "object") return undefined
        const e = event as Record<string, unknown>
        // Form 2: { detail: payload }
        if (e["detail"] && typeof e["detail"] === "object") return e["detail"]
        // Form 3: { rawMessage: "<JSON>" }
        if (typeof e["rawMessage"] === "string") {
          try {
            return JSON.parse(e["rawMessage"])
          } catch {
            return undefined
          }
        }
        // Form 1: bare payload — the event object IS the message.
        // Filter out plugin-injected metadata fields like `id` so the
        // type guards see a clean shape if the embedded UI sent a
        // `{ id, …payload }` blob; we keep `type`-presence as the
        // signal that this looks like one of OUR messages and let the
        // guards reject anything else.
        return e
      }

      try {
        const handle = await InAppBrowser.addListener(
          "messageFromWebview",
          (event: unknown) => {
            const data = extractPayload(event)
            if (isToggleMessage(data)) {
              // eslint-disable-next-line no-console
              console.log("[webview-host] la: toggle received", {
                sessionId: data.sessionId,
                enabled: data.enabled,
              })
              void applyLAToggle(data.sessionId, data.enabled)
              return
            }
            if (isTaskMessage(data)) {
              // eslint-disable-next-line no-console
              console.log("[webview-host] la: task received", { taskId: data.taskId, phase: data.phase })
              void taskMonitor?.ingest({
                type: "codeplane:task",
                taskId: data.taskId,
                phase: data.phase,
                queueDepth: data.queueDepth,
                currentMessage: data.currentMessage,
                progress: data.progress,
                startedAt: data.startedAt,
                elapsedSeconds: data.elapsedSeconds,
                turns: data.turns,
              })
              return
            }
            // Anything else is from a third-party page or future
            // protocol extension — log enough to debug without spamming
            // (one entry per unrecognised shape, with the type field if
            // present). Earlier I made this silent; that's how the v28.1.4
            // event-shape bug went undetected — there was no breadcrumb
            // when the message was reaching the host but failing the
            // guard. Console output is fine here: it lands in
            // `safari://web-inspector` for debug builds and is dropped
            // by the production logger.
            const peek =
              data && typeof data === "object"
                ? { type: (data as Record<string, unknown>)["type"], keys: Object.keys(data as object).slice(0, 8) }
                : { value: typeof data }
            // eslint-disable-next-line no-console
            console.log("[webview-host] la: ignored messageFromWebview", peek)
          },
        )
        offHandles.push(handle)
      } catch {
        /* listener registration failed — toggles + task events from
           inside the WKWebView will not reach the shell on this
           session; the user will see the toggle flip back via the
           shell's broadcast staying out-of-sync. Better than crashing. */
      }

      // Auto-open is driven by the `createEffect` below (it tracks
      // `props.instance.id`, so it fires once on mount and again on
      // every instance switch). Calling `openInWebView()` here would
      // double-open on first mount — we hit that bug earlier.
    }

    const registerHostTeardown = () =>
      onCleanup(() => {
        offNet()
        taskMonitor?.dispose()
        clearInjectTimers()
        if (typeof window !== "undefined") {
          window.removeEventListener("message", onWindowMessage, false)
        }
        for (const off of offHandles) off?.remove().catch(() => {})
        // Belt-and-braces: even if our individual `remove()` calls drop
        // on the floor, this ensures the next mount starts with a clean
        // listener slate (mirrors the upfront `removeAllListeners` we
        // do on registration).
        if (isNative) InAppBrowser.removeAllListeners().catch(() => {})
        // Best-effort close of any still-open in-app browser when the
        // host unmounts (e.g. the user hit Android's hardware back).
        if (isNative) InAppBrowser.close().catch(() => {})
      })
    // We're past `onMount`'s awaits here, so the ambient owner is gone;
    // re-enter the captured render-time owner so this teardown actually
    // registers (and runs on unmount) instead of being dropped.
    if (owner) runWithOwner(owner, registerHostTeardown)
    else registerHostTeardown()
  })

  createEffect(() => {
    // Reset on instance switch (rare but possible if the picker
    // remounts us with a different instance without re-routing).
    void props.instance.id
    setStarted(isNative)
    setLoaded(false)
    setBrowserOpen(false)
    setOpenError(null)
    if (isNative) {
      // Kick off the native `isSupported()` round-trip BEFORE the
      // openWebView call starts the WKWebView creation. Solid runs
      // this createEffect before `onMount`, so this is the earliest
      // point at which we can launch the load — and `injectLAState`
      // (which fires after openWebView resolves) will await the same
      // cached promise. The result: the inject's `supported` field
      // reflects the real native answer instead of the default
      // `false`, and the toggle renders on first paint.
      void ensureLAStateLoaded()
      void openInWebView()
    }
  })

  const startWebSession = () => {
    setStarted(true)
    setLoaded(false)
  }

  return (
    <div style={{ flex: "1 1 auto", display: "flex", "flex-direction": "column", position: "relative" }}>
      <Show when={!online()}>
        <div role="status" class="mobile-alert mobile-alert--warning" style={{ margin: "8px 16px 0" }}>
          <span aria-hidden style={{ "font-weight": 700, "margin-top": "1px" }}>
            ⚠
          </span>
          <span>You're offline. The instance may not load until you reconnect.</span>
        </div>
      </Show>

      <Show when={openError()}>
        <div role="alert" class="mobile-alert mobile-alert--danger" style={{ margin: "8px 16px 0" }}>
          <span aria-hidden style={{ "font-weight": 700, "margin-top": "1px" }}>
            !
          </span>
          <span>{openError()}</span>
        </div>
      </Show>

      {/*
        Native: the in-app modal is presented over us. While it's up,
        we render a "Connecting" landing as the parked background.
        When the modal dismisses (`closeEvent`) we route back to the
        picker. The "Reopen" button covers the case where the user
        dismissed by mistake.

        Web: same SignInLanding gate as before — tap Sign in to load
        the iframe.
      */}
      <Show when={isNative || !started() || !loaded()}>
        <SignInLanding
          host={host()}
          label={props.instance.label}
          loading={isNative ? browserOpen() : started() && !loaded()}
          helper={
            // Three states drive the helper copy:
            //   1. Idle (waiting for the user to tap Open / Sign in)
            //   2. Connecting — the WKWebView / iframe is loading
            //   3. Error — the open call rejected
            // We deliberately keep the connecting copy SHORT — long
            // explanations during an active wait read like apologies.
            // The deep "why we use a top-level webview" reasoning
            // belongs in the idle state where the user is reading,
            // not while they're staring at a progress bar.
            isNative
              ? browserOpen()
                ? `Connecting to ${host()}`
                : openError()
                  ? "Couldn't open this server. Try again."
                  : `${host()} opens in a secure in-app browser. Cookies stay on this device.`
              : started()
                ? `Loading ${host()}`
                : "Sign in to load this server's web UI. Cookies are kept by the app, so you'll stay signed in next time."
          }
          buttonLabel={
            isNative
              ? openError()
                ? "Try again"
                : browserOpen()
                  ? "Reopen"
                  : "Open"
              : started()
                ? "Loading…"
                : "Sign in"
          }
          onClick={() => {
            if (isNative) {
              void openInWebView()
            } else {
              startWebSession()
            }
          }}
          // On native the button is always re-tappable — sessions are
          // dismissed by the user, not by us. On web we lock it
          // while loading.
          disabled={!isNative && started() && !loaded()}
        />
      </Show>
      <Show when={!isNative && started()}>
        <iframe
          ref={frameRef}
          title={props.instance.label || props.instance.url}
          class="instance-webview"
          src={props.instance.url}
          // Most permissive feature policy that still respects platform
          // gating — we want the instance to be able to use camera/mic
          // for, e.g., screen-share in a chat panel, and clipboard for
          // copy-link affordances.
          allow="camera; microphone; clipboard-read; clipboard-write; fullscreen; geolocation"
          referrerpolicy="no-referrer"
          onLoad={() => {
            setLoaded(true)
            // The embedded UI just hot-reloaded or finished its initial
            // load. Push the LA snapshot so its toggle reflects the
            // shell's persisted state before the user can tap it. The
            // LiveActivity context's `__codeplaneLA` snapshot also
            // primes first paint, but a postMessage round-trip is the
            // canonical sync point — re-emitting on every load makes
            // the bridge resilient to navigation inside the iframe.
            broadcastLAState()
          }}
          style={{ display: loaded() ? "block" : "none" }}
        />
      </Show>
    </div>
  )
}

/**
 * Connecting / sign-in landing — the parked surface the picker shows
 * while the in-app webview is being created (native) or before the
 * iframe loads (web fallback).
 *
 * Design intent (native iOS):
 *
 *   1. **Instance avatar up top** — same monogram tile the picker
 *      paints, so the user reads the connection as continuing the
 *      card they just tapped, not as a context switch.
 *   2. **Large title + monospaced host** — Apple's "Large Title"
 *      pattern. The label dominates, the host sits underneath in a
 *      monospaced muted tone like a status field in Settings.app.
 *   3. **Phased progress** — instead of an indefinite spinner, an
 *      inline progress strip with phase text moves through the
 *      stages the user actually cares about (Connecting → Loading
 *      workspace → Almost ready). Each phase uses the same opaque
 *      animation timing, so the strip never lies about being done
 *      until the modal is up.
 *   4. **Single primary action** when we're idle — Sign in / Open /
 *      Try again. No duplicate "Open" + "Reopen" — the helper text
 *      changes, not the button label.
 *
 * The tap-to-modal latency is dominated by WKWebView creation, which
 * is platform-level and unavoidable. This screen makes the wait feel
 * intentional rather than blank.
 */
const SignInLanding: Component<{
  host: string
  label?: string
  loading: boolean
  helper: string
  buttonLabel: string
  onClick: () => void
  disabled?: boolean
}> = (props) => {
  // The monogram avatar tile that used to sit above the title was
  // removed at the user's request — the picker card the user just
  // tapped already establishes which instance is loading, and the
  // empty state without the tile reads cleaner on a phone screen.
  return (
    <div class="instance-connect">
      <div class="instance-connect__name-row">
        <h2 class="instance-connect__title">{props.label || props.host}</h2>
        <Show when={props.label && props.label !== props.host}>
          <div class="instance-connect__host">{props.host}</div>
        </Show>
      </div>
      <Show
        when={props.loading}
        fallback={
          <>
            <p class="instance-connect__body">{props.helper}</p>
            <button
              type="button"
              class="mobile-button mobile-button--primary instance-connect__cta"
              onClick={() => props.onClick()}
              disabled={props.disabled}
            >
              {props.buttonLabel}
            </button>
          </>
        }
      >
        <ProgressStrip />
        <p class="instance-connect__phase" aria-live="polite">
          {props.helper}
        </p>
      </Show>
    </div>
  )
}

/**
 * Indeterminate progress strip — a thin monochrome bar with a moving
 * highlight that loops. Mirrors the iOS Settings.app
 * "loading-without-a-percentage" indicator more than a spinning
 * wheel, which feels more on-brand for a workspace surface than a
 * round spinner that visually "waits forever".
 */
const ProgressStrip: Component = () => (
  <div class="instance-connect__progress" aria-hidden>
    <div class="instance-connect__progress-bar" />
  </div>
)

/**
 * Floating close button injected into every page rendered inside the
 * in-app webview.
 *
 * Why a JS-injected button instead of native chrome: the modal uses
 * `toolbarType: BLANK` so the WKWebView sits edge-to-edge with no
 * navigation bar above it (matches the desktop's chromeless
 * `BrowserWindow`). Without a native dismiss control, the user has no
 * way to get back to the picker — so we paint our own "Back" pill.
 *
 * The script is re-run on every navigation by the `urlChangeEvent`
 * listener up in `onMount`, plus once right after `openWebView`
 * resolves, so the button survives:
 *   - the initial load of the instance URL,
 *   - every redirect in the SSO chain (Cloudflare Access → IdP →
 *     callback → instance), and
 *   - any client-side SPA navigation inside the instance UI.
 *
 * Visuals are deliberately iOS-native: a "Back" pill in monochrome
 * text over a translucent frosted-glass background, top-right, sized
 * like a UIBarButtonItem. The script sniffs `prefers-color-scheme` so
 * the pill reads against both light and dark workspace themes — the
 * earlier flat-black version stamped a heavy oil-slick on light
 * pages and competed with the workspace's own header chrome.
 *
 * It also installs a `MutationObserver` so the button auto-restores
 * itself if the page deletes elements off `<html>` (some single-page
 * frameworks remount aggressively). Idempotent: re-running the script
 * does not stack duplicates.
 *
 * Tapping the button calls `window.mobileApp.close()` — a JS bridge
 * the plugin auto-injects which, on the native side, fires the
 * `closeEvent` listener registered up in `onMount`, which in turn
 * routes back to the picker via `props.onClose()`.
 */
function closeButtonScript(): string {
  return `
    (function () {
      var ID = "__cp-mobile-close-button";
      // Codeplane monochrome design system (matches the picker's
      // \`--icon-strong-base\` / \`--button-primary-base\` tokens) — the
      // workspace surface uses the same palette, so painting the
      // close affordance in these tones lets it sit on the page like
      // a native Codeplane control rather than an iOS-blue intruder.
      function paint(btn) {
        var isDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        var style = btn.style;
        if (isDark) {
          // Dark theme: --text-strong (rgba(255,255,255,0.936)) on a
          // very subtle elevated surface.
          style.color = "rgba(255,255,255,0.94)";
          style.background = "rgba(28,28,30,0.66)";
          style.boxShadow = "0 0 0 0.5px rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.32)";
        } else {
          // Light theme: --text-strong (#171717) on a frosted white
          // plate. No system blue, no brand accent — just the same
          // neutral high-contrast tone the picker uses for primary
          // text and CTAs.
          style.color = "#171717";
          style.background = "rgba(255,255,255,0.78)";
          style.boxShadow = "0 0 0 0.5px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.06)";
        }
      }
      function ensure() {
        // Embedded-button handshake. The shared @codeplane-ai/ui
        // \`MobileBackButton\` raises \`window.__cpMobileBackEmbedded\` on
        // mount; when we see it, we defer to the in-chrome button —
        // and if we'd already painted the floating pill on first
        // load (before the embedded UI mounted), we tear it down so
        // the user never sees both at once. Older instance versions
        // that don't ship the shared component leave the flag unset,
        // so the fallback pill below still paints for them.
        //
        // Sweep with querySelectorAll rather than getElementById so a
        // brief overlap window (where both an old inject pill AND the
        // freshly-mounted embedded button live with the same id)
        // still gets cleaned up. The embedded button carries
        // \`data-component\` (the shared Button primitive sets it); the
        // inject pill does not — that's the only attribute we use to
        // tell them apart.
        if (window.__cpMobileBackEmbedded) {
          var pills = document.querySelectorAll("#" + ID);
          for (var i = 0; i < pills.length; i++) {
            if (!pills[i].hasAttribute("data-component")) pills[i].remove();
          }
          return;
        }
        if (document.getElementById(ID)) return;
        var btn = document.createElement("button");
        btn.id = ID;
        btn.type = "button";
        btn.setAttribute("aria-label", "Back");
        btn.textContent = "Back";
        var style = btn.style;
        style.position = "fixed";
        // Sit just below the status bar (iOS notch / Dynamic Island).
        style.top = "calc(env(safe-area-inset-top, 0px) + 8px)";
        style.right = "calc(env(safe-area-inset-right, 0px) + 12px)";
        style.zIndex = "2147483647"; // top of stacking context
        style.height = "30px";
        style.padding = "0 14px";
        style.border = "0";
        // 12px corner — matches the picker's \`--mobile-card-radius\`
        // family (mobile-button is 12px). 999px would be too pill-y
        // for Codeplane's grid-aligned, slightly square radius
        // language.
        style.borderRadius = "10px";
        style.fontFamily = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'system-ui', sans-serif";
        style.fontSize = "13px";
        style.fontWeight = "600";
        style.lineHeight = "30px";
        style.letterSpacing = "-0.01em";
        style.cursor = "pointer";
        style.webkitBackdropFilter = "saturate(160%) blur(18px)";
        style.backdropFilter = "saturate(160%) blur(18px)";
        style.transition = "opacity 120ms ease";
        style.webkitTapHighlightColor = "transparent";
        paint(btn);
        if (window.matchMedia) {
          var mq = window.matchMedia('(prefers-color-scheme: dark)');
          // Re-paint if the device theme flips while the modal is open.
          var onChange = function () { paint(btn); };
          if (mq.addEventListener) mq.addEventListener('change', onChange);
          else if (mq.addListener) mq.addListener(onChange);
        }
        btn.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          try {
            if (window.mobileApp && typeof window.mobileApp.close === "function") {
              window.mobileApp.close();
              return;
            }
          } catch (e) {}
          // Defensive fallback if the plugin bridge isn't there yet.
          try {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.close) {
              window.webkit.messageHandlers.close.postMessage(null);
            }
          } catch (e) {}
        }, { passive: false });
        btn.addEventListener("touchstart", function () { btn.style.opacity = "0.6"; }, { passive: true });
        btn.addEventListener("touchend",   function () { btn.style.opacity = "1"; },   { passive: true });
        btn.addEventListener("touchcancel",function () { btn.style.opacity = "1"; },   { passive: true });
        // Attach to <html>, not <body>, so wholesale body re-renders
        // (some SPAs do this on route change) don't blow the button
        // away.
        (document.documentElement || document.body).appendChild(btn);
      }
      // Try once immediately, and again right after the DOM is parsed
      // — \`executeScript\` can land before \`document.body\` exists, in
      // which case appending a button to documentElement works but
      // some workspaces re-write the entire <html> sub-tree on first
      // boot, taking our button with it.
      ensure();
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", ensure, { once: true });
      }
      window.addEventListener("load", ensure, { once: true });
      // Self-polling safety net: re-ensure for the next ~3 s. This
      // guarantees the button shows up on first launch even when the
      // page is mid-replace and the JS-side staircase happens to land
      // entirely inside a doomed DOM. Once the button is stable the
      // poll is essentially free (the ensure() check is a single
      // \`getElementById\`).
      var deadline = Date.now() + 3000;
      var poll = window.setInterval(function () {
        ensure();
        if (Date.now() > deadline) window.clearInterval(poll);
      }, 200);
      try {
        // Watch the entire subtree so SPA route changes that mutate
        // body's children (rather than replacing body itself)
        // also trigger a re-ensure. Cheap because ensure() short-
        // circuits when the button is already present.
        var observer = new MutationObserver(function () { ensure(); });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) {}
    })();
    true;
  `
}
