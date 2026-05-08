import { Component, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { InAppBrowser, ToolBarType } from "@capgo/inappbrowser"
import type { CodeplaneMobileAPI } from "../platform/api"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import {
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

  const wireTaskMonitor = async () => {
    // The iframe-driven monitor only exists in the web dev preview —
    // on native there is no iframe to listen to. (Native Live
    // Activities arrive via the server-side push path that
    // `live-activities.registerForUpdates()` already wires.)
    if (isNative || !frameRef) return
    // Parallelise the three async reads — sequential awaits here
    // showed up as a measurable gap before InAppBrowser.openWebView
    // could fire; firing them concurrently shaves a couple of frames
    // off the perceived "tap → modal" delay.
    const [liveActivitiesEnabled, opted, supportedStatus] = await Promise.all([
      props.api.instances.prefs.getLiveActivitiesEnabled(props.instance.id),
      props.api.instances.prefs.getLiveActivitySessionIds(props.instance.id),
      props.api.liveActivities.isSupported().catch(() => ({ supported: false, enabled: false })),
    ])
    setOptedInSessionIds(opted)
    setLASupported(supportedStatus.supported)
    taskMonitor = createTaskMonitor({
      frame: frameRef,
      liveActivities: props.api.liveActivities,
      // Single activity per instance — only sessions the user has
      // explicitly opted in surface as Live Activities. The monitor
      // ignores everything else.
      instanceId: props.instance.id,
      instanceLabel: props.instance.label || host(),
      instanceHost: host(),
      enabled: liveActivitiesEnabled,
      optedInSessionIds: opted,
    })
    // Push initial state to the embedded UI as soon as the iframe is
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
   * With the toolbar gone there is no Done button. We paint our own
   * floating close pill via `executeScript`, called once right after
   * the webview opens and again on every `urlChangeEvent` (registered
   * up in `onMount`). That keeps the button visible:
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
  const openInWebView = async () => {
    setStarted(true)
    setOpenError(null)
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
      window.setTimeout(() => void injectCloseButton(), 250)
      window.setTimeout(() => void injectCloseButton(), 750)
      window.setTimeout(() => void injectCloseButton(), 1500)
      // Re-inject the LA state on the same staircase. SPA-style apps
      // sometimes replace `document` between the openWebView resolve
      // and the first true page paint; without these later passes the
      // embedded UI would render its first frame before the snapshot
      // landed and the toggle would flash hidden→visible.
      window.setTimeout(() => void injectLAState(), 250)
      window.setTimeout(() => void injectLAState(), 1500)
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
    const payload = {
      type: "codeplane:la-state",
      supported: laSupported(),
      enabledSessionIds: optedInSessionIds(),
      maxAllowed: MAX_LIVE_ACTIVITY_SESSIONS,
    }
    const json = JSON.stringify(payload)
    const code = `(function(){try{
      var data = ${json};
      window.__codeplaneLA = {
        supported: data.supported,
        enabledSessionIds: data.enabledSessionIds,
        maxAllowed: data.maxAllowed,
      };
      window.dispatchEvent(new MessageEvent('message', { data: data, source: window }));
    }catch(_){/* injection failed — embedded UI falls through to its inert default */}})();`
    try {
      await InAppBrowser.executeScript({ code })
    } catch (err) {
      // Non-fatal — without the snapshot the embedded UI just keeps
      // the toggle hidden, which is the safe default.
      console.warn("[webview-host] failed to inject LA state", err)
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
      // twice for one Done tap (we've seen it during the modal's
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
          },
        )
        offHandles.push(handle)
      } catch {
        /* listener registration failed — proceed without auto-inject;
           the JS-side staircase in `openInWebView` still fires */
      }

      // Auto-open is driven by the `createEffect` below (it tracks
      // `props.instance.id`, so it fires once on mount and again on
      // every instance switch). Calling `openInWebView()` here would
      // double-open on first mount — we hit that bug earlier.
    }

    onCleanup(() => {
      offNet()
      taskMonitor?.dispose()
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
  })

  createEffect(() => {
    // Reset on instance switch (rare but possible if the picker
    // remounts us with a different instance without re-routing).
    void props.instance.id
    setStarted(isNative)
    setLoaded(false)
    setBrowserOpen(false)
    setOpenError(null)
    if (isNative) void openInWebView()
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
  // Synthesise an instance monogram avatar SVG matching the picker
  // card style (same OC-2 dark fill, two-letter initials). The picker
  // generates this server-side as a data: URI but recreating it here
  // saves a prop drill and keeps the loading screen self-contained.
  const initials = () => {
    const text = props.label || props.host
    const parts = text.split(/[\s-_./]+/).filter(Boolean)
    const a = parts[0]?.[0] ?? text[0] ?? "?"
    const b = parts[1]?.[0] ?? parts[0]?.[1] ?? ""
    return (a + b).toUpperCase().slice(0, 2)
  }
  return (
    <div class="instance-connect">
      <div class="instance-connect__avatar" aria-hidden>
        <span class="instance-connect__avatar-text">{initials()}</span>
      </div>
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
 * `BrowserWindow`). Without a Done button, the user has no way to get
 * back to the picker — so we paint our own.
 *
 * The script is re-run on every navigation by the `urlChangeEvent`
 * listener up in `onMount`, plus once right after `openWebView`
 * resolves, so the button survives:
 *   - the initial load of the instance URL,
 *   - every redirect in the SSO chain (Cloudflare Access → IdP →
 *     callback → instance), and
 *   - any client-side SPA navigation inside the instance UI.
 *
 * Visuals are deliberately iOS-native: a "Done" pill in iOS-blue text
 * over a translucent frosted-glass background, top-right, sized like
 * a UIBarButtonItem. The script sniffs `prefers-color-scheme` so the
 * pill reads against both light and dark workspace themes — the
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
        if (document.getElementById(ID)) return;
        var btn = document.createElement("button");
        btn.id = ID;
        btn.type = "button";
        btn.setAttribute("aria-label", "Done");
        btn.textContent = "Done";
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
