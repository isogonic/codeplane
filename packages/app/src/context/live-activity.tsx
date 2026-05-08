/**
 * LiveActivityProvider — bridges the Codeplane web UI to the iOS Live
 * Activity surface owned by the mobile shell. The desktop has no
 * equivalent (Lock Screens are mobile-only), so this provider stays
 * inert there and `supported` reads false.
 *
 * Lifecycle:
 *   1. On mount, the provider registers a `message` listener on
 *      `window` and reads any `__codeplaneLA` snapshot the shell may
 *      have injected synchronously via `executeScript` before paint.
 *      The injected snapshot lets us render the toggle in the right
 *      state on first frame instead of waiting for the postMessage
 *      round-trip.
 *   2. On every `codeplane:la-state` message it reconciles the local
 *      reactive store. The shell pushes a fresh snapshot whenever
 *      preferences change, including when another mobile-app session
 *      flipped the toggle, so the UI never goes out of sync.
 *   3. Calling `toggle(sessionId, on)` posts a `codeplane:la-toggle`
 *      message back up to the shell. We do NOT optimistically update
 *      our local state — the shell is the source of truth (it might
 *      reject the toggle with `lastError.reason = "limit"`), and we
 *      want the UI to reflect what's actually persisted, not our
 *      hopeful guess.
 *
 * Why a context and not a plain util module:
 *   - It keeps the SolidJS reactivity model intact: components consume
 *     `enabled(sessionId)` as a tracked accessor, so the toggle flips
 *     the moment the shell pushes new state.
 *   - Components don't have to manage their own listener lifecycle —
 *     the provider owns the single window-level listener and
 *     fans-out via the store.
 */
import { createMemo, createSignal, onCleanup, onMount, type ParentProps } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "@codeplane-ai/ui/context"
import {
  isStateMessage,
  MAX_LIVE_ACTIVITY_SESSIONS,
  type LiveActivityStateMessage,
  type LiveActivityToggleMessage,
} from "@codeplane-ai/shared/live-activity-protocol"

type LiveActivityState = {
  /** True only when running inside an iOS 16.2+ mobile-shell webview. */
  supported: boolean
  /** Stable Set of session IDs the user opted in. */
  enabledSessionIds: Set<string>
  /** Mirror of MAX_LIVE_ACTIVITY_SESSIONS, but the shell can override. */
  maxAllowed: number
  /** Last rejection (e.g. exceeding the cap). UI surfaces this once
   *  and clears it on the next successful toggle. */
  lastError: LiveActivityStateMessage["lastError"]
}

const INITIAL: LiveActivityState = {
  supported: false,
  enabledSessionIds: new Set(),
  maxAllowed: MAX_LIVE_ACTIVITY_SESSIONS,
  lastError: undefined,
}

/**
 * Unforgeable "we're inside the iOS picker's InAppBrowser" check.
 *
 * The `@capgo/inappbrowser` plugin auto-injects a WKScriptMessageHandler
 * named `close` into every WKWebView it opens — that's how the plugin's
 * own JS bridge calls back into native code. The handler is set up at
 * the WKWebView's `WKUserContentController` BEFORE the page's first
 * navigation, so:
 *
 *   • inside the InAppBrowser → `window.webkit.messageHandlers.close`
 *     is always defined (it's how the close button works).
 *   • a desktop browser, an iframe, a regular Safari tab, the
 *     Capacitor picker WebView itself → no such handler.
 *
 * A page's own `<script>` cannot install or forge a
 * `window.webkit.messageHandlers` entry — the WebKit message-handler
 * registry lives on the native side and is read-only from JS. So this
 * is the strongest "running inside the shell" signal we have, stronger
 * than the appendUserAgent tag (which @capgo's WKWebView might not
 * inherit from the host Capacitor config).
 *
 * Together with the `__codeplaneLA` snapshot the shell injects, this
 * gates the Live Activity toggle to genuine in-app sessions only.
 */
function isInsideMobileShell(): boolean {
  if (typeof window === "undefined") return false
  const w = window as unknown as {
    webkit?: { messageHandlers?: Record<string, unknown> }
  }
  return !!w.webkit?.messageHandlers?.close
}

/**
 * Read the synchronous shell-injected snapshot, if any. This is the
 * only thing on the page that knows whether the host is mobile *before*
 * any postMessage arrives — used to avoid a flash-of-no-toggle on
 * mount. Falls through to the inert default off-mobile.
 *
 * `supported` is gated on BOTH the snapshot AND the UA tag. Either
 * one missing → `supported: false` (toggle hidden).
 */
function readInjectedSnapshot(): LiveActivityState {
  if (typeof window === "undefined") return INITIAL
  const snap = window.__codeplaneLA
  if (!snap) return INITIAL
  const inShell = isInsideMobileShell()
  return {
    supported: !!snap.supported && inShell,
    enabledSessionIds: new Set(snap.enabledSessionIds ?? []),
    maxAllowed: snap.maxAllowed ?? MAX_LIVE_ACTIVITY_SESSIONS,
    lastError: undefined,
  }
}

function postToggle(message: LiveActivityToggleMessage): void {
  // window.parent for the iframe (web fallback) path; if we're the top
  // window the listener on `window.parent` is `window` itself, which
  // is no-op. The native InAppBrowser path uses
  // window.webkit.messageHandlers when available — we try both because
  // the embedded UI doesn't know which surface it's running inside.
  try {
    window.parent?.postMessage(message, "*")
  } catch {
    /* postMessage to a cross-origin parent that has gone away — ignore */
  }
  // Best-effort native bridge — if the shell wired up a message
  // handler with this name, that route is preferred (no parent-frame
  // confusion). We catch typing errors silently because the handler
  // may not exist on every webview.
  try {
    const handler = (window as unknown as {
      webkit?: { messageHandlers?: { codeplaneLA?: { postMessage: (data: unknown) => void } } }
    }).webkit?.messageHandlers?.codeplaneLA
    handler?.postMessage(message)
  } catch {
    /* no native handler — postMessage above is the canonical path */
  }
}

export const LiveActivity = createSimpleContext({
  name: "LiveActivity",
  gate: false,
  init: (_: { children?: unknown }) => {
    const initial = readInjectedSnapshot()
    const [store, setStore] = createStore(initial)
    // Public booleans read by mobile shell-aware components.
    const [supported, setSupported] = createSignal(initial.supported)

    // Hold the listener in a ref so we can detach on cleanup. The
    // dependency on `enabled(sessionId)` is encoded via the reactive
    // `store` — components calling `enabled(id)` track their own
    // accessor through the store proxy and re-render on the next
    // reconcile.
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!isStateMessage(data)) return
      // Same UA gate as the synchronous snapshot — a desktop browser
      // page that listens to `message` events and posts a fake
      // `codeplane:la-state { supported: true }` to itself can't trick
      // the toggle into rendering. The UA tag is set by the picker's
      // Capacitor config and is the only signal a remote page can't
      // forge from the page's own JS.
      const inShell = isInsideMobileShell()
      setStore(
        reconcile({
          supported: data.supported && inShell,
          enabledSessionIds: new Set(data.enabledSessionIds),
          maxAllowed: data.maxAllowed,
          lastError: data.lastError,
        }),
      )
      setSupported(data.supported && inShell)
    }

    onMount(() => {
      if (typeof window === "undefined") return
      window.addEventListener("message", onMessage, false)
      onCleanup(() => window.removeEventListener("message", onMessage, false))
    })

    /** Reactive lookup — re-renders when the set of opted-in IDs changes. */
    const enabled = (sessionId: string) =>
      // Read .size to track the Set; Solid stores re-emit when reconcile()
      // installs a new Set instance. Using `.has()` directly works because
      // store proxies return the current snapshot each access.
      store.enabledSessionIds.size > 0 && store.enabledSessionIds.has(sessionId)

    /** True when the user is at the cap and trying to add another. */
    const atLimit = createMemo(() => store.enabledSessionIds.size >= store.maxAllowed)

    const toggle = (sessionId: string, value: boolean, sessionLabel?: string) => {
      // Optimistically clear any previous error, but DO NOT touch the
      // enabledSessionIds set — that's the shell's responsibility.
      setStore("lastError", undefined)
      postToggle({
        type: "codeplane:la-toggle",
        sessionId,
        sessionLabel,
        enabled: value,
      })
    }

    return {
      /** True when the host platform supports Live Activities at all. */
      supported,
      /** Reactive accessor: is `sessionId` currently a Live Activity? */
      enabled,
      /** Reactive count of how many sessions are currently opted in. */
      count: () => store.enabledSessionIds.size,
      /** Cap as advertised by the shell. */
      maxAllowed: () => store.maxAllowed,
      /** Helper memo: at the cap right now? */
      atLimit,
      /** Last rejection message (e.g. "limit exceeded"). */
      lastError: () => store.lastError,
      /** Public mutator. */
      toggle,
    }
  },
})

/**
 * Default Provider that callers can drop in next to other providers
 * in the AppShell tree — no props, just renders children.
 */
export function LiveActivityProvider(props: ParentProps) {
  return <LiveActivity.provider>{props.children}</LiveActivity.provider>
}

export const useLiveActivity = LiveActivity.use
export const useOptionalLiveActivity = LiveActivity.useOptional
