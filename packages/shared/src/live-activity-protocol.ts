/**
 * Cross-process protocol between the Codeplane web UI (running inside the
 * mobile app's webview) and the native mobile shell that owns the iOS
 * Live Activity for that instance.
 *
 *   ┌─────────────────────────┐  postMessage   ┌──────────────────────────┐
 *   │  Codeplane web UI       │──────────────► │  Mobile shell (RN/iOS)   │
 *   │  (iframe / WKWebView)   │ ◄──────────────│  webview-host.tsx        │
 *   └─────────────────────────┘  postMessage   └──────────────────────────┘
 *
 * Why a postMessage protocol and not a direct API:
 *   1. The web UI is loaded from each user's own Codeplane server, not
 *      bundled with the mobile app — we can't import a TypeScript symbol
 *      across that boundary.
 *   2. The same web UI ships on desktop where there is no mobile shell at
 *      all; the protocol must degrade silently when the host doesn't
 *      respond, and the UI checks `supported` before exposing the toggle.
 *   3. iOS Live Activities are an OS-level surface — the user already has
 *      their phone settings, focus modes, and per-app permission gates in
 *      the way; the right model is "user explicitly opts a session in",
 *      not "we auto-pick the noisiest sessions for them".
 *
 * The shell remembers which sessions a user opted into per instance, so
 * killing the app and re-opening doesn't wipe the choice. Up to
 * `MAX_LIVE_ACTIVITY_SESSIONS` sessions can be opted in at once — beyond
 * that the shell rejects the toggle with `reason: "limit"` and the UI
 * surfaces the limit message.
 */

/**
 * Hard cap on how many sessions one instance can show as Live Activities
 * at the same time. ActivityKit lets us request more, but two on the
 * Lock Screen is already busy and any more starts to look like spam.
 * The duo widget layout we ship is built around exactly this number —
 * one primary slot, one secondary slot, optional `+N more` footer.
 */
export const MAX_LIVE_ACTIVITY_SESSIONS = 2

/** Direction: web UI → mobile shell. The user toggled the switch. */
export type LiveActivityToggleMessage = {
  type: "codeplane:la-toggle"
  /** Stable session identifier the shell treats as the activity key. */
  sessionId: string
  /** Optional human label so the shell can render meaningful copy in
   *  toasts / settings without reaching back into the UI. */
  sessionLabel?: string
  /** New desired state — true to opt in, false to opt out. */
  enabled: boolean
}

/**
 * Direction: mobile shell → web UI. Sent on every state change AND once
 * shortly after page load (the shell pushes the snapshot whenever it
 * sees a fresh navigation in the WKWebView). The UI never asks for it
 * via a request/response — push-only keeps the protocol one-way and
 * lets us replay the same broadcast whenever the shell wants the UI to
 * re-sync (e.g. another mobile-app session disabled the activity).
 */
export type LiveActivityStateMessage = {
  type: "codeplane:la-state"
  /**
   * Whether the host platform actually supports Live Activities at all.
   * False on Android (no native Live Activity equivalent yet), false on
   * iOS < 16.2, false on the desktop fallback. The toggle hides itself
   * when this is false so we don't show a control that does nothing.
   */
  supported: boolean
  /** Session IDs currently opted in. Order is the user's selection
   *  order (oldest first); the UI shouldn't depend on it. */
  enabledSessionIds: string[]
  /** Mirror of `MAX_LIVE_ACTIVITY_SESSIONS` so the UI can display the
   *  cap without importing this constant — handy for older versions of
   *  the shared UI talking to a newer shell that wanted to relax it. */
  maxAllowed: number
  /**
   * Optional last-action diagnostic. Set when the shell rejected a
   * toggle so the UI can surface why (e.g. "you've already opted 2
   * sessions in"). Cleared on every successful toggle.
   */
  lastError?: { reason: "limit" | "not-supported"; sessionId: string }
}

/**
 * Direction: web UI → mobile shell. Per-task progress event that the
 * shell's task-monitor folds into a single Live Activity per instance.
 *
 * The web UI emits one of these every time an opted-in session changes
 * state: a user message lands → `running`, the assistant replies →
 * `completed`, an error fires → `failed`, etc. The shell aggregates
 * the latest state per `taskId`, picks the duo (top 2 of the user's
 * opt-in selection), and pushes a content-state update to ActivityKit.
 *
 * `taskId` is the opaque session id the toggle was issued for — the
 * shell looks it up against its persisted `optedInSessionIds` to
 * decide whether to render. Tasks for non-opted-in sessions are
 * dropped on the floor without acknowledgement.
 */
export type LiveActivityTaskMessage = {
  type: "codeplane:task"
  /** Same id the user opted in via the toggle; usually the session id. */
  taskId: string
  phase: "queued" | "running" | "completed" | "failed"
  /** Number of messages still queued behind this one. */
  queueDepth: number
  /** Single-line preview the widget renders as the task title. */
  currentMessage: string
  /** 0..1 if we know it; null hides the bar in the widget. */
  progress: number | null
  /** ISO timestamp when this task started (drives the elapsed timer). */
  startedAt: string
  /** Optional server-authoritative elapsed-seconds override. */
  elapsedSeconds?: number
  /** Number of turns / messages exchanged so far. */
  turns?: number
}

/** Discriminated-union helper used by both sides to type-narrow the
 *  payload of an inbound `MessageEvent.data`. */
export type LiveActivityMessage =
  | LiveActivityToggleMessage
  | LiveActivityStateMessage
  | LiveActivityTaskMessage

/**
 * Window-level type augmentation: when a UI runs inside the mobile
 * shell, the shell injects a tiny global so the UI can fast-path the
 * toggle without having to wait for a postMessage round-trip. This is
 * a courtesy — the postMessage path is the source of truth and the
 * shell is responsible for replaying state on every navigation.
 */
declare global {
  interface Window {
    /**
     * Set by the mobile shell on every page load via `executeScript`
     * so the UI can synchronously check whether to render the toggle
     * (avoids a flicker on the first paint while we wait for the
     * `codeplane:la-state` broadcast). Always treat this as best-effort
     * — the postMessage state still wins if the two disagree.
     */
    __codeplaneLA?: {
      supported: boolean
      enabledSessionIds: string[]
      maxAllowed: number
    }
  }
}

/**
 * Type guard — narrows an arbitrary `MessageEvent.data` to a
 * recognised LA message. Both sides should run every postMessage
 * through this before doing anything with the payload, since the
 * webview is shared with arbitrary third-party iframes that may
 * postMessage their own shapes.
 */
export function isLiveActivityMessage(value: unknown): value is LiveActivityMessage {
  if (!value || typeof value !== "object") return false
  const t = (value as { type?: unknown }).type
  return t === "codeplane:la-toggle" || t === "codeplane:la-state" || t === "codeplane:task"
}

export function isToggleMessage(value: unknown): value is LiveActivityToggleMessage {
  return (
    isLiveActivityMessage(value) &&
    value.type === "codeplane:la-toggle" &&
    typeof (value as LiveActivityToggleMessage).sessionId === "string" &&
    typeof (value as LiveActivityToggleMessage).enabled === "boolean"
  )
}

export function isStateMessage(value: unknown): value is LiveActivityStateMessage {
  return (
    isLiveActivityMessage(value) &&
    value.type === "codeplane:la-state" &&
    typeof (value as LiveActivityStateMessage).supported === "boolean" &&
    Array.isArray((value as LiveActivityStateMessage).enabledSessionIds)
  )
}

export function isTaskMessage(value: unknown): value is LiveActivityTaskMessage {
  if (!isLiveActivityMessage(value) || value.type !== "codeplane:task") return false
  const v = value as LiveActivityTaskMessage
  return (
    typeof v.taskId === "string" &&
    typeof v.phase === "string" &&
    (v.phase === "queued" || v.phase === "running" || v.phase === "completed" || v.phase === "failed") &&
    typeof v.queueDepth === "number" &&
    typeof v.currentMessage === "string" &&
    (v.progress === null || typeof v.progress === "number") &&
    typeof v.startedAt === "string"
  )
}
