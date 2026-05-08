/**
 * iOS Live Activities bridge — surfaces a long-running Codeplane task
 * (or two!) on the Lock Screen and Dynamic Island via ActivityKit.
 *
 * The TypeScript side here is platform-neutral; the actual ActivityKit
 * calls live in `build/ios-live-activity/LiveActivitiesPlugin.swift`,
 * which is registered as a custom Capacitor plugin named
 * `CodeplaneLiveActivities`. Android (and the in-browser dev fallback)
 * resolve to a quiet no-op so screens don't have to special-case the
 * platform — the boolean returned from `start()` is enough to know
 * whether an activity actually came up.
 *
 * Data shape — the model the JS bridge encodes for the widget to
 * decode:
 *
 *   • `LiveActivityAttributes` — STATIC for the activity's lifetime.
 *     Bound to a single Codeplane *instance* (not a single task), so
 *     when several tasks run on the same instance they share one
 *     activity. iOS limits us to one activity attribute identity
 *     family anyway, and the user expectation is "one row per server
 *     on my Lock Screen", not "one row per task".
 *
 *   • `LiveActivityContentState` — the part the widget paints and
 *     the Capacitor bridge updates. Always carries a `primary` task
 *     and may also carry a `secondary` task (the "duo" view from
 *     `task-monitor`'s top-2 selection). `totalActive` is the count
 *     across all running/queued tasks for the instance — drives the
 *     "+N more" indicator when 3+ tasks are racing.
 *
 *   • `LiveActivityTask` — the per-task slice. Carries everything the
 *     widget needs to render one row: phase, title (already trimmed
 *     for the bridge), queueDepth, progress, startedAt, elapsed
 *     override, turn count.
 *
 * Only one activity is alive per instanceId at a time — the
 * task-monitor reconciles all per-task events into a single update.
 * Multi-instance support comes naturally because the plugin keys
 * activities by `attributes.instanceId`.
 */

import { Capacitor, registerPlugin } from "@capacitor/core"

export type LiveActivityPhase = "queued" | "running" | "completed" | "failed"

export type LiveActivityAttributes = {
  /**
   * Stable per-instance identifier. The plugin uses this to look up
   * an existing activity for `update`/`end` instead of holding the
   * ActivityKit-internal `Activity.id` on the JS side.
   */
  instanceId: string
  /** User-facing label of the Codeplane instance, e.g. "Production". */
  instanceLabel: string
  /** Hostname displayed under the label on the Lock Screen. */
  instanceHost: string
}

export type LiveActivityTask = {
  /** Stable identifier for this task within its instance. */
  id: string
  phase: LiveActivityPhase
  /** Truncated, single-line preview of the message being processed. */
  title: string
  /** Number of messages still queued behind this one. */
  queueDepth: number
  /** 0..1 if the server reports progress; null hides the bar. */
  progress: number | null
  /** ISO timestamp of when the task started — drives the elapsed timer. */
  startedAt: string
  /** Optional server-authoritative elapsed-seconds override. */
  elapsedSeconds?: number
  /** Number of turns / messages exchanged in the session. */
  turns: number
}

export type LiveActivityContentState = {
  /** The task being shown most prominently — always present while the activity exists. */
  primary: LiveActivityTask
  /** Optional second task for the duo layout. `null` collapses to single-row layout. */
  secondary: LiveActivityTask | null
  /**
   * Total tasks currently active (running + queued) for this
   * instance. Drives the "+N more" indicator when this exceeds 2.
   */
  totalActive: number
}

export type LiveActivityHandle = {
  activityId: string
  instanceId: string
  /** ISO timestamp; useful for the renderer to recover state after cold restart. */
  startedAt: string
}

export type LiveActivityDismissalPolicy =
  | "default" // ~4 hours stale-on-Lock-Screen window managed by ActivityKit
  | "immediate"
  | { afterSeconds: number }

interface NativeLiveActivitiesPlugin {
  isSupported(): Promise<{ supported: boolean; enabled: boolean }>
  start(input: {
    attributes: LiveActivityAttributes
    contentState: LiveActivityContentState
    staleAfterSeconds?: number
  }): Promise<{ activityId: string }>
  update(input: {
    activityId: string
    contentState: LiveActivityContentState
  }): Promise<{ ok: boolean }>
  end(input: {
    activityId: string
    finalContentState?: LiveActivityContentState
    dismissalPolicy?: LiveActivityDismissalPolicy
  }): Promise<{ ok: boolean }>
  list(): Promise<{
    activities: Array<{ activityId: string; instanceId: string; startedAt: string }>
  }>
  registerForUpdates(): Promise<{ token: string | null }>
}

/**
 * One-shot debug helper — fires a real Live Activity that runs for
 * `durationSeconds`, ticks progress every second, then ends with a
 * "Completed" terminal frame. Used by the picker's hidden test
 * trigger so the iOS plumbing can be verified end-to-end without
 * a running Codeplane server emitting `codeplane:task` events.
 *
 * Returns the activityId so callers can `end()` early if needed.
 * No-op + returns null on platforms without ActivityKit (Android,
 * web, iOS < 16.2).
 */
export async function demoLiveActivity(
  api: CodeplaneLiveActivitiesAPI,
  options: {
    instanceId?: string
    instanceLabel?: string
    instanceHost?: string
    durationSeconds?: number
    /** Subtitle of the simulated task; defaults to a Codeplane-flavoured demo. */
    title?: string
  } = {},
): Promise<string | null> {
  const status = await api.isSupported().catch(() => ({ supported: false, enabled: false }))
  if (!status.supported) return null
  const instanceId = options.instanceId ?? "demo-instance"
  const instanceLabel = options.instanceLabel ?? "Demo workspace"
  const instanceHost = options.instanceHost ?? "demo.codeplane.example.com"
  const duration = Math.max(8, options.durationSeconds ?? 30)
  const taskId = `demo-${Date.now()}`
  const startedAt = new Date().toISOString()
  const baseTask: LiveActivityTask = {
    id: taskId,
    phase: "running",
    title: options.title ?? "Refactoring authentication middleware…",
    queueDepth: 0,
    progress: 0,
    startedAt,
    turns: 1,
  }
  const handle = await api.start(
    { instanceId, instanceLabel, instanceHost },
    { primary: baseTask, secondary: null, totalActive: 1 },
    { staleAfterSeconds: duration + 60 },
  )
  if (!handle) return null
  const activityId = handle.activityId
  // Tick progress every second; let phase transitions in the last
  // tick land on the terminal "completed" frame so the user sees
  // the green check on the Lock Screen before it dismisses.
  let tick = 0
  const interval = setInterval(async () => {
    tick += 1
    const progress = Math.min(1, tick / duration)
    const phase: LiveActivityPhase = progress >= 1 ? "completed" : "running"
    await api
      .update(activityId, {
        primary: { ...baseTask, progress, phase, turns: 1 + Math.floor(tick / 5) },
        secondary: null,
        totalActive: phase === "completed" ? 0 : 1,
      })
      .catch(() => {})
    if (progress >= 1) {
      clearInterval(interval)
      // 4-second grace so the terminal frame is readable on the
      // Lock Screen before iOS pulls the activity.
      setTimeout(() => {
        void api.end(activityId, undefined, "default").catch(() => {})
      }, 4_000)
    }
  }, 1_000)
  return activityId
}

const Native = registerPlugin<NativeLiveActivitiesPlugin>("CodeplaneLiveActivities", {
  // Web fallback so dev/preview doesn't crash; everything is a no-op.
  web: {
    async isSupported() {
      return { supported: false, enabled: false }
    },
    async start() {
      throw new Error("Live Activities are not supported in the web fallback")
    },
    async update() {
      return { ok: false }
    },
    async end() {
      return { ok: false }
    },
    async list() {
      return { activities: [] }
    },
    async registerForUpdates() {
      return { token: null }
    },
  },
})

export type CodeplaneLiveActivitiesAPI = {
  isSupported: () => Promise<{ supported: boolean; enabled: boolean }>
  /** Start an activity for an instance. The duo content state may carry one or two tasks. */
  start: (
    attributes: LiveActivityAttributes,
    contentState: LiveActivityContentState,
    options?: { staleAfterSeconds?: number },
  ) => Promise<LiveActivityHandle | null>
  update: (activityId: string, contentState: LiveActivityContentState) => Promise<boolean>
  end: (
    activityId: string,
    finalState?: LiveActivityContentState,
    dismissalPolicy?: LiveActivityDismissalPolicy,
  ) => Promise<boolean>
  list: () => Promise<LiveActivityHandle[]>
  registerForUpdates: () => Promise<string | null>
}

/* ------------------------------------------------------------------ *
 * Sanitization                                                       *
 * ------------------------------------------------------------------ */

const PREVIEW_MAX = 90
const trimPreview = (s: string) => {
  const flat = (s ?? "").toString().replace(/\s+/g, " ").trim()
  if (flat.length <= PREVIEW_MAX) return flat
  return flat.slice(0, PREVIEW_MAX - 1).trimEnd() + "…"
}

const sanitizeTask = (task: LiveActivityTask): LiveActivityTask => ({
  id: task.id,
  phase: task.phase,
  title: trimPreview(task.title ?? ""),
  queueDepth: Math.max(0, Math.floor(task.queueDepth ?? 0)),
  progress:
    task.progress == null
      ? null
      : Math.min(1, Math.max(0, Number.isFinite(task.progress) ? (task.progress as number) : 0)),
  startedAt: task.startedAt,
  elapsedSeconds:
    task.elapsedSeconds != null && Number.isFinite(task.elapsedSeconds)
      ? Math.max(0, Math.floor(task.elapsedSeconds))
      : undefined,
  turns: Math.max(0, Math.floor(task.turns ?? 0)),
})

const sanitizeContentState = (state: LiveActivityContentState): LiveActivityContentState => ({
  primary: sanitizeTask(state.primary),
  secondary: state.secondary ? sanitizeTask(state.secondary) : null,
  totalActive: Math.max(1, Math.floor(state.totalActive ?? 1)),
})

/* ------------------------------------------------------------------ *
 * API                                                                *
 * ------------------------------------------------------------------ */

export function createLiveActivities(): CodeplaneLiveActivitiesAPI {
  const platform = Capacitor.getPlatform()
  const isiOS = platform === "ios"

  const noop: CodeplaneLiveActivitiesAPI = {
    async isSupported() {
      return { supported: false, enabled: false }
    },
    async start() {
      return null
    },
    async update() {
      return false
    },
    async end() {
      return false
    },
    async list() {
      return []
    },
    async registerForUpdates() {
      return null
    },
  }

  if (!isiOS) return noop

  // One-time startup probe so the picker's bring-up tells us whether
  // the native CodeplaneLiveActivities plugin is reachable AT ALL.
  // Three months of "the toggle doesn't show up" reports turned out
  // to be Capacitor's `registerPlugin` falling through to the web
  // stub because the native plugin wasn't linked into the binary —
  // and the silent `.catch(() => ({supported: false}))` we used to
  // have on every isSupported call masked it. Now if the plugin isn't
  // there, the very first message in the device console is the real
  // reason ("plugin not implemented", "PluginCallError", etc.).
  // eslint-disable-next-line no-console
  console.log("[live-activity] probing native plugin…")
  Native.isSupported().then(
    (r) => {
      // eslint-disable-next-line no-console
      console.log("[live-activity] native plugin reachable", r)
    },
    (err) => {
      const reason = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.error(
        "[live-activity] NATIVE PLUGIN UNREACHABLE — falling through to web stub. " +
          "This is why the Lock Screen toggle is hidden. Reason:",
        reason,
      )
    },
  )

  return {
    async isSupported() {
      return Native.isSupported().catch((err) => {
        const reason = err instanceof Error ? err.message : String(err)
        // eslint-disable-next-line no-console
        console.error("[live-activity] isSupported failed:", reason)
        return { supported: false, enabled: false }
      })
    },
    async start(attributes, contentState, options) {
      try {
        const sanitized = sanitizeContentState(contentState)
        const result = await Native.start({
          attributes,
          contentState: sanitized,
          staleAfterSeconds: options?.staleAfterSeconds,
        })
        return {
          activityId: result.activityId,
          instanceId: attributes.instanceId,
          startedAt: sanitized.primary.startedAt,
        }
      } catch (err) {
        console.warn("[live-activity] start failed", err)
        return null
      }
    },
    async update(activityId, contentState) {
      try {
        const result = await Native.update({
          activityId,
          contentState: sanitizeContentState(contentState),
        })
        return !!result.ok
      } catch (err) {
        console.warn("[live-activity] update failed", err)
        return false
      }
    },
    async end(activityId, finalState, dismissalPolicy = "default") {
      try {
        const result = await Native.end({
          activityId,
          finalContentState: finalState ? sanitizeContentState(finalState) : undefined,
          dismissalPolicy,
        })
        return !!result.ok
      } catch (err) {
        console.warn("[live-activity] end failed", err)
        return false
      }
    },
    async list() {
      try {
        const { activities } = await Native.list()
        return activities.map((a) => ({
          activityId: a.activityId,
          instanceId: a.instanceId,
          startedAt: a.startedAt,
        }))
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[live-activity] list failed:", err instanceof Error ? err.message : err)
        return []
      }
    },
    async registerForUpdates() {
      try {
        const { token } = await Native.registerForUpdates()
        return token ?? null
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[live-activity] registerForUpdates failed:", err instanceof Error ? err.message : err)
        return null
      }
    },
  }
}
