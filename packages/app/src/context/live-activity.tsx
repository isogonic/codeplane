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
 * Read the synchronous shell-injected snapshot, if any. This is the
 * only thing on the page that knows whether the host is mobile *before*
 * any postMessage arrives — used to avoid a flash-of-no-toggle on
 * mount. Falls through to the inert default off-mobile.
 *
 * Earlier revisions also required `window.webkit.messageHandlers.close`
 * to exist as a defence-in-depth check against a remote page setting
 * `__codeplaneLA = { supported: true }` from its own `<script>`. In
 * practice that combo never matched on the @capgo/inappbrowser
 * WKWebView (its `executeScript` runs in a content world that lacks
 * the page-side `webkit.messageHandlers` registry), so the gate
 * silently rejected every legitimate injection. The defence was also
 * pointless: a remote-page-set snapshot just renders a toggle whose
 * `postToggle` calls `window.parent.postMessage` (no-op when there's
 * no parent) and a `webkit.messageHandlers.codeplaneLA` that doesn't
 * exist — i.e. no behaviour, no risk.
 *
 * The picker shell remains the only thing that injects `__codeplaneLA`
 * via `executeScript` on a WKWebView, so the snapshot's presence is a
 * sufficient "we're inside the shell" signal in production.
 */
function readInjectedSnapshot(): LiveActivityState {
  if (typeof window === "undefined") return INITIAL
  const snap = window.__codeplaneLA
  if (!snap) return INITIAL
  return {
    supported: !!snap.supported,
    enabledSessionIds: new Set(snap.enabledSessionIds ?? []),
    maxAllowed: snap.maxAllowed ?? MAX_LIVE_ACTIVITY_SESSIONS,
    lastError: undefined,
  }
}

/**
 * Send a message back to the picker shell. We try every channel the
 * embedded UI might be hosted by because the same code runs in
 * three places:
 *
 *   1. **Native iOS via @capgo/inappbrowser** (the production mobile
 *      shell). The plugin auto-injects `window.mobileApp.postMessage`
 *      into every page; the host catches it via
 *      `InAppBrowser.addListener("messageFromWebview", …)`. THIS is
 *      the canonical native path — earlier revisions targeted a
 *      `webkit.messageHandlers.codeplaneLA` handler that the shell
 *      never registered, so toggles silently went nowhere.
 *
 *   2. **Web dev preview / iframe**. `window.parent.postMessage`
 *      reaches the picker's `window` listener.
 *
 *   3. **Top-level web** (the user opens the same UI in a desktop
 *      browser without the shell). Both channels resolve to no-ops,
 *      which matches the menu state — `supported()` is false, so the
 *      toggle isn't rendered.
 *
 * Calling all available channels is safe: the shell-side listeners
 * each ignore messages they don't recognise.
 */
function postToggle(message: LiveActivityToggleMessage): void {
  postToShell(message)
}

interface MobileAppBridge {
  postMessage: (data: Record<string, unknown>) => void
}

function getMobileAppBridge(): MobileAppBridge | undefined {
  if (typeof window === "undefined") return undefined
  const bridge = (window as unknown as { mobileApp?: MobileAppBridge }).mobileApp
  return bridge && typeof bridge.postMessage === "function" ? bridge : undefined
}

/**
 * Generic shell-bridge sender — used by both the LA toggle and the
 * task-state emitter ({@link postTaskEvent}). The native channel
 * accepts arbitrary `Record<string, unknown>`; the shell side
 * discriminates on `type`.
 */
function postToShell(message: Record<string, unknown> & { type: string }): void {
  // Native InAppBrowser channel — preferred when present. The plugin
  // auto-injects `window.mobileApp` so a runtime check is sufficient.
  const native = getMobileAppBridge()
  if (native) {
    try {
      native.postMessage(message)
    } catch {
      /* native bridge transient failure — fall through to postMessage */
    }
  }
  // Iframe / dev fallback — never throws on top-level windows because
  // `window.parent === window`, the message just lands on our own
  // listener which ignores its own `type`.
  try {
    window.parent?.postMessage(message, "*")
  } catch {
    /* postMessage to a cross-origin parent that has gone away — ignore */
  }
}

export function postTaskEvent(message: {
  type: "codeplane:task"
  taskId: string
  phase: "queued" | "running" | "completed" | "failed"
  queueDepth: number
  currentMessage: string
  progress: number | null
  startedAt: string
  elapsedSeconds?: number
  turns?: number
}): void {
  postToShell(message)
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
      // Trust the message — same reasoning as `readInjectedSnapshot`.
      // The picker shell is the only thing that reaches into the
      // page's window via `executeScript` to dispatch this; a remote
      // page that posts a fake `codeplane:la-state` to itself just
      // gets a toggle whose `postToggle` doesn't reach anything
      // useful, so there's no real attack surface to gate against.
      setStore(
        reconcile({
          supported: data.supported,
          enabledSessionIds: new Set(data.enabledSessionIds),
          maxAllowed: data.maxAllowed,
          lastError: data.lastError,
        }),
      )
      setSupported(data.supported)
    }

    /**
     * Native InAppBrowser delivery channel — the plugin fires a
     * CustomEvent named `messageFromNative` on `window`, with the
     * snapshot in `event.detail`. This is the reliable channel:
     * `executeScript`-dispatched `message` events can race the
     * provider's mount, but `messageFromNative` is delivered every
     * time the picker calls `InAppBrowser.postMessage(...)` and the
     * page always has time to attach this listener.
     */
    const onNativeMessage = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!isStateMessage(detail)) return
      setStore(
        reconcile({
          supported: detail.supported,
          enabledSessionIds: new Set(detail.enabledSessionIds),
          maxAllowed: detail.maxAllowed,
          lastError: detail.lastError,
        }),
      )
      setSupported(detail.supported)
    }

    onMount(() => {
      if (typeof window === "undefined") return
      window.addEventListener("message", onMessage, false)
      window.addEventListener("messageFromNative", onNativeMessage as EventListener, false)
      onCleanup(() => {
        window.removeEventListener("message", onMessage, false)
        window.removeEventListener(
          "messageFromNative",
          onNativeMessage as EventListener,
          false,
        )
      })
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
      /**
       * Snapshot of every session id currently opted in. Reactive — the
       * task-event emitter relies on this to know which sessions to
       * watch for state changes.
       */
      enabledSessionIds: () => Array.from(store.enabledSessionIds),
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
