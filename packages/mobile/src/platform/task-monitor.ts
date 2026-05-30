/**
 * Bridge between the Codeplane instance running inside the in-app
 * webview and the iOS Live Activities API.
 *
 * Protocol — the instance UI sends `postMessage` events on the
 * iframe's `window` with this shape:
 *
 *   {
 *     type: "codeplane:task",
 *     taskId: string,
 *     phase: "queued" | "running" | "completed" | "failed",
 *     queueDepth: number,
 *     currentMessage: string,
 *     progress: number | null,         // 0..1, or null if unknown
 *     startedAt: string,               // ISO
 *     elapsedSeconds?: number,         // server-authoritative override
 *     turns?: number,                  // optional turn count for tie-break
 *   }
 *
 * The monitor aggregates *every* such event for the hosted instance
 * into ONE Live Activity ("duo" model). The widget then shows up to
 * two tasks at once on the Lock Screen / Dynamic Island; the
 * top-2 selection is by **longest-running first**, **most-turns** as
 * the tie-break. Anything past the top 2 is folded into a `+N more`
 * pill so the user knows how many other tasks are racing.
 *
 * Why a single activity per instance instead of one-per-task:
 *   1. Each user-visible Lock Screen entry consumes vertical space.
 *      Three concurrent tasks on the same Codeplane server stacking
 *      three identical-looking activities produces visual noise
 *      without telling the user anything new.
 *   2. ActivityKit limits the number of concurrent activities per
 *      app (currently five), and once you hit the cap iOS just
 *      refuses new `Activity.request` calls. Aggregating per-instance
 *      keeps us comfortably under that cap even when the user is
 *      babysitting several long-running tasks.
 *   3. The Dynamic Island's compact / minimal presentations only get
 *      one slot at a time anyway — having one activity per instance
 *      with an embedded "+N" indicator is the closest analogue to
 *      the "expanded shows everything" model.
 *
 * Auto-trigger heuristic — we don't bother iOS for trivial work:
 *   - Start the activity once a task either:
 *       a) has been "running" for ≥ START_DELAY_MS, OR
 *       b) reports queueDepth ≥ START_QUEUE_THRESHOLD;
 *   - Continue running until every task on the instance has
 *     terminated (`completed` / `failed`), then end with a 4 s grace
 *     so the user catches the final state on the Lock Screen.
 *   - Updates are throttled to one per ~3 s (ActivityKit politely
 *     throttles updates to "a few per minute"). Phase transitions
 *     bypass the throttle because state changes are more interesting
 *     than steady-progress ticks.
 */

import type {
  CodeplaneLiveActivitiesAPI,
  LiveActivityAttributes,
  LiveActivityContentState,
  LiveActivityPhase,
  LiveActivityTask,
} from "./live-activities"

export type TaskEvent = {
  type: "codeplane:task"
  taskId: string
  phase: LiveActivityPhase
  queueDepth: number
  currentMessage: string
  progress: number | null
  startedAt: string
  elapsedSeconds?: number
  turns?: number
}

export type TaskMonitorOptions = {
  /**
   * The iframe whose `contentWindow` we listen to via `window.message`
   * events. Only used in the dev / web preview where the embedded UI
   * runs as an iframe of the picker shell. **Omit on native iOS** —
   * the InAppBrowser WKWebView is a separate process whose messages
   * arrive via `InAppBrowser.addListener("messageFromWebview", …)`,
   * which the host wires directly into {@link Monitor.ingest}.
   */
  frame?: HTMLIFrameElement
  liveActivities: CodeplaneLiveActivitiesAPI
  /** Static instance metadata. Becomes the activity's `attributes`. */
  instanceId: string
  instanceLabel: string
  instanceHost: string
  /** Master switch — false (the default for unknown instances) means we never start anything. */
  enabled: boolean
  /**
   * Session IDs the user explicitly opted in to the Live Activity
   * surface. The monitor only ever surfaces tasks whose `taskId` is
   * in this set — no auto-selection by longest-running, no implicit
   * promotion of noisy tasks. Empty (the default) means: emit no
   * activities. Pass an updated array via `setOptedInSessionIds(...)`
   * when the user toggles a session in the embedded UI.
   */
  optedInSessionIds?: string[]
}

export interface Monitor {
  setEnabled: (enabled: boolean) => void
  setOptedInSessionIds: (next: string[]) => void
  /**
   * Push a `codeplane:task` event into the monitor. The host calls
   * this from its `messageFromWebview` listener on native, where
   * `window.message` is not the right channel (the embedded UI is in
   * a separate WKWebView process). On the dev preview iframe path the
   * monitor's own listener calls this internally — exposing it
   * publicly just lets both surfaces share the same ingestion logic.
   */
  ingest: (event: TaskEvent) => Promise<void>
  dispose: () => Promise<void>
}

const START_DELAY_MS = 12_000
const START_QUEUE_THRESHOLD = 3
const UPDATE_THROTTLE_MS = 3_000
const END_GRACE_MS = 4_000

type TrackedTask = {
  id: string
  phase: LiveActivityPhase
  title: string
  queueDepth: number
  progress: number | null
  startedAt: string
  startedAtMs: number
  elapsedSeconds?: number
  turns: number
}

const isTaskEvent = (data: unknown): data is TaskEvent => {
  if (!data || typeof data !== "object") return false
  const d = data as Record<string, unknown>
  return (
    d.type === "codeplane:task" &&
    typeof d.taskId === "string" &&
    typeof d.phase === "string" &&
    typeof d.queueDepth === "number" &&
    typeof d.currentMessage === "string" &&
    typeof d.startedAt === "string"
  )
}

const isActive = (task: TrackedTask) => task.phase === "running" || task.phase === "queued"

/**
 * Pick up to two tasks for the duo view from the user's explicit
 * opt-in set. NOT auto-selection — the monitor previously sorted by
 * longest-running and surfaced the top two regardless of user
 * preference, which is wrong for a Lock Screen surface (the user is
 * opting into a notification, not asking us to guess what's noisiest).
 *
 * Selection logic:
 *   1. Filter active tasks to those in `optedInSessionIds`.
 *   2. Preserve the user's selection order — IDs earlier in the
 *      `optedInSessionIds` array land in the primary slot. That's the
 *      same array order the user toggled them in, so the visual order
 *      mirrors their intent.
 *   3. `totalActive` reflects the count of opted-in *active* tasks
 *      only. Anything past two becomes the `+N more` footer in the
 *      widget — not a count of every running task on the instance.
 */
const selectTopTwo = (
  tasks: Map<string, TrackedTask>,
  optedInSessionIds: string[],
): {
  primary: TrackedTask | null
  secondary: TrackedTask | null
  totalActive: number
} => {
  if (optedInSessionIds.length === 0) {
    return { primary: null, secondary: null, totalActive: 0 }
  }
  const opted = optedInSessionIds
    .map((id) => tasks.get(id))
    .filter((t): t is TrackedTask => !!t && isActive(t))
  return {
    primary: opted[0] ?? null,
    secondary: opted[1] ?? null,
    totalActive: opted.length,
  }
}

const toLiveTask = (task: TrackedTask): LiveActivityTask => ({
  id: task.id,
  phase: task.phase,
  title: task.title,
  queueDepth: task.queueDepth,
  progress: task.progress,
  startedAt: task.startedAt,
  elapsedSeconds: task.elapsedSeconds,
  turns: task.turns,
})

export function createTaskMonitor(opts: TaskMonitorOptions): Monitor {
  const tasks = new Map<string, TrackedTask>()
  let enabled = opts.enabled
  let optedInSessionIds: string[] = opts.optedInSessionIds ?? []
  let activityId: string | null = null
  let lastUpdateAt = 0
  // Guards against two concurrent tripStart() calls (rapid first events) both
  // awaiting start() and creating duplicate Live Activities, orphaning one.
  let starting = false
  /** Pending start timer — runs the heuristic-gated start path. */
  let startTimer: ReturnType<typeof setTimeout> | undefined

  const attributes = (): LiveActivityAttributes => ({
    instanceId: opts.instanceId,
    instanceLabel: opts.instanceLabel,
    instanceHost: opts.instanceHost,
  })

  const buildContentState = (): LiveActivityContentState | null => {
    const { primary, secondary, totalActive } = selectTopTwo(tasks, optedInSessionIds)
    if (!primary) return null
    return {
      primary: toLiveTask(primary),
      secondary: secondary ? toLiveTask(secondary) : null,
      totalActive,
    }
  }

  // NOTE: legacy `shouldStart()` heuristic + `startTimer` cleanup
  // intentionally kept around — they were the gate for auto-promoting
  // long-running / deep-queue tasks before user opt-in landed. Now
  // that activities only fire for explicitly-opted-in sessions, the
  // gate isn't called from `ingestEvent`, but the same constants
  // still inform the mobile picker's "should this session be
  // suggested for opt-in?" heuristic in a follow-up. Removing them
  // means re-deriving them later, which is silly given they cost
  // nothing to keep. The unused-variable warning is suppressed
  // because the cleanup paths in setEnabled / dispose still defensively
  // clear `startTimer` in case a future change re-adds the scheduler.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _shouldStart = (): boolean => {
    const now = Date.now()
    for (const task of tasks.values()) {
      if (!isActive(task)) continue
      if (task.queueDepth >= START_QUEUE_THRESHOLD) return true
      if (now - task.startedAtMs >= START_DELAY_MS) return true
    }
    return false
  }

  const tripStart = async () => {
    if (activityId || starting) return
    const contentState = buildContentState()
    if (!contentState) return
    // Set the in-flight guard synchronously, BEFORE the await, so a second
    // concurrent call bails instead of starting a duplicate activity.
    starting = true
    try {
      const handle = await opts.liveActivities.start(attributes(), contentState, {
        // Live Activities go stale and dim after this window — mirror
        // the ActivityKit default (~8 hours) so a forgotten task tidies
        // up.
        staleAfterSeconds: 8 * 60 * 60,
      })
      if (handle) {
        activityId = handle.activityId
        lastUpdateAt = Date.now()
      }
    } finally {
      starting = false
    }
  }

  const flushUpdate = async (force = false) => {
    if (!activityId) return
    const contentState = buildContentState()
    if (!contentState) return
    const sinceLast = Date.now() - lastUpdateAt
    if (!force && sinceLast < UPDATE_THROTTLE_MS) return
    lastUpdateAt = Date.now()
    await opts.liveActivities.update(activityId, contentState)
  }

  /**
   * When every task has ended we still want to show *something* on
   * the Lock Screen for the brief grace window. Pick the most-recent
   * terminal task as primary; fall back to whichever task we know
   * about so the activity doesn't blink to "queue empty" mid-render.
   */
  const lastResortFinalState = (): LiveActivityContentState | null => {
    const list = Array.from(tasks.values())
    if (list.length === 0) return null
    list.sort((a, b) => b.startedAtMs - a.startedAtMs)
    return {
      primary: toLiveTask(list[0]!),
      secondary: list[1] ? toLiveTask(list[1]) : null,
      totalActive: 0,
    }
  }

  const checkForEnd = async () => {
    if (!activityId) return
    const someoneActive = Array.from(tasks.values()).some(isActive)
    if (someoneActive) return
    // Everyone terminated. Push one last frame with the final state
    // so the user sees the resolved phase, then end after the grace
    // window.
    const finalState = lastResortFinalState()
    const heldId = activityId
    activityId = null
    if (finalState) {
      await opts.liveActivities.update(heldId, finalState)
    }
    setTimeout(() => {
      void opts.liveActivities.end(heldId, finalState ?? undefined, "default")
    }, END_GRACE_MS)
  }

  const ingestEvent = async (event: TaskEvent) => {
    if (!enabled) return

    const startedAtMs = Date.parse(event.startedAt) || Date.now()
    const previous = tasks.get(event.taskId)
    const phaseChanged = previous?.phase !== event.phase
    const next: TrackedTask = {
      id: event.taskId,
      phase: event.phase,
      title: event.currentMessage,
      queueDepth: event.queueDepth,
      progress: event.progress,
      startedAt: event.startedAt,
      startedAtMs,
      elapsedSeconds: event.elapsedSeconds,
      turns: event.turns ?? previous?.turns ?? 0,
    }
    // Bump turns on every queued→running transition — the iframe
    // sometimes sends an updated message with the same `taskId` for
    // a new turn without an explicit `turns` field.
    if (event.turns == null && previous && phaseChanged && event.phase === "running") {
      next.turns = (previous.turns ?? 0) + 1
    }
    tasks.set(event.taskId, next)

    // With explicit opt-in we don't gate on the
    // running-for-N-seconds / queue-depth heuristic anymore — the
    // user already signalled intent by tapping the toggle, so the
    // activity should appear the moment the first event for an
    // opted-in session lands. The legacy `shouldStart()` heuristic
    // is kept around for when a future hands-off mode wants to
    // auto-promote noisy long-runners again, but the default path
    // is now: opt-in match → start immediately.
    if (!activityId && optedInSessionIds.includes(event.taskId)) {
      await tripStart()
    }

    // Push the new state to the activity. Phase changes always flush
    // so the user sees terminal states promptly; steady ticks are
    // throttled.
    await flushUpdate(phaseChanged)

    // After every event check whether the activity should retire.
    await checkForEnd()
  }

  // Dev / web preview path — the embedded UI is an iframe inside the
  // picker, and it posts task events on its own `window`. We filter
  // by `event.source === frame.contentWindow` so messages from
  // unrelated iframes (auth popups, etc.) don't bleed into the
  // monitor. On native iOS this listener never fires because the
  // InAppBrowser WKWebView runs in a separate process; the host
  // calls `ingest()` directly from its `messageFromWebview` listener.
  const onMessage = (event: MessageEvent) => {
    if (!opts.frame || event.source !== opts.frame.contentWindow) return
    if (!isTaskEvent(event.data)) return
    void ingestEvent(event.data)
  }

  if (opts.frame && typeof window !== "undefined") {
    window.addEventListener("message", onMessage, false)
  }

  return {
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled
      if (!nextEnabled) {
        // User flipped the toggle off mid-flight — close the activity
        // immediately and forget about pending work.
        if (activityId) {
          const heldId = activityId
          activityId = null
          void opts.liveActivities.end(heldId, undefined, "immediate")
        }
        if (startTimer) clearTimeout(startTimer)
        startTimer = undefined
        tasks.clear()
      }
    },
    /**
     * Replace the opt-in set. Called by the webview-host after the
     * user toggles a session in the embedded UI. If a previously
     * opted-in session was just toggled off and it was the only
     * primary, this triggers the no-active-tasks tear-down on the next
     * reconcile (the existing flow already handles `primary == null`).
     */
    setOptedInSessionIds(next: string[]) {
      optedInSessionIds = next
      // Force a reconcile pass so the activity reflects the new set
      // immediately rather than waiting for the next task event.
      // Three cases:
      //   a) we have an active activity → push a fresh content state
      //      (which may now have null primary if the user toggled the
      //      only opted-in session off, in which case checkForEnd
      //      drains it through the grace window).
      //   b) we don't have one yet but at least one opted-in session
      //      is currently running → start the activity immediately.
      //   c) otherwise → no-op until the next event.
      if (activityId) {
        const nextState = buildContentState()
        if (nextState) {
          void flushUpdate(true)
        } else {
          // No opted-in session remains to display. The underlying task may
          // still be running, so checkForEnd() (which only ends once nothing
          // is active) would leave a stale activity pinned to the Lock Screen.
          // The user explicitly opted out — end it now.
          const heldId = activityId
          activityId = null
          void opts.liveActivities.end(heldId, undefined, "default")
        }
      } else {
        const hasOptedIn = optedInSessionIds.some((id) => {
          const t = tasks.get(id)
          return t && isActive(t)
        })
        if (hasOptedIn) void tripStart()
      }
    },
    /**
     * Public ingest — the host calls this from its
     * `messageFromWebview` listener on native. The shape matches the
     * dev / web preview's `window.message` payload, so the same
     * downstream logic handles both transports.
     */
    async ingest(event: TaskEvent) {
      await ingestEvent(event)
    },
    async dispose() {
      if (opts.frame && typeof window !== "undefined") {
        window.removeEventListener("message", onMessage, false)
      }
      if (startTimer) clearTimeout(startTimer)
      startTimer = undefined
      if (activityId) {
        const heldId = activityId
        activityId = null
        await opts.liveActivities.end(heldId, undefined, "default")
      }
      tasks.clear()
    },
  }
}
