/**
 * LiveActivityTaskEmitter — derives `codeplane:task` events from sync
 * state for every session the user has opted in to the iOS Live
 * Activity surface.
 *
 * Why this exists: the mobile shell's `task-monitor` only ever knew
 * how to ingest `codeplane:task` postMessages. Nothing in the Codeplane
 * web UI was producing them, so even after the shell-side bridge was
 * fixed (the `messageFromWebview` listener) the activity never started
 * — there was no signal to start FROM. This component observes:
 *
 *   1. The set of opted-in session ids (`useLiveActivity().enabledSessionIds`).
 *   2. Each session's `session_status` (idle / busy / retry) and message
 *      stream from `useSync()`.
 *
 * For each enabled session, a single reactive effect runs and emits one
 * `codeplane:task` payload per state change. The shell's task-monitor
 * coalesces these into ActivityKit start/update/end calls.
 *
 * Mounted inside `DirectoryDataProvider` so `useSync` resolves; lives
 * for the life of the active project. Re-mounts cleanly on project
 * switch (Solid disposes & recreates the directory layout subtree).
 */
import { For, type Component, createMemo, createEffect, on, onCleanup } from "solid-js"
import { useLiveActivity } from "@/context/live-activity"
import { useSync } from "@/context/sync"
import { postTaskEvent } from "@/context/live-activity"
import { hasPendingAssistantMessage } from "@/pages/session/session-working"
import type { Message, Part } from "@codeplane-ai/sdk/v2/client"

type Phase = "queued" | "running" | "completed" | "failed"

type StatusShape =
  | { type: "idle" }
  | { type: "busy"; queued?: number }
  | { type: "retry"; attempt: number; message: string; next: number }
  | undefined

/**
 * Map a session's runtime status to one of the Live Activity phases the
 * widget renders. We treat retry as "running" because the user
 * experience is the same — the assistant hasn't given up yet.
 *
 * Failure isn't a `session_status` value (errors land inside the
 * message stream as a part with `type: "error"`); we infer it
 * separately from the latest assistant message's parts.
 */
export function statusToPhase(input: {
  status: StatusShape
  hasError: boolean
  lastWasAssistant: boolean
  hasPendingAssistant: boolean
}): Phase {
  const { status, hasError, lastWasAssistant, hasPendingAssistant } = input
  if (status?.type === "busy" || status?.type === "retry") return "running"
  if (hasPendingAssistant) return "running"
  if (hasError) return "failed"
  // Idle + the latest message is from the assistant → the turn finished.
  // Idle + nothing yet (or last is user) → we haven't started; "queued"
  // is the closest phase. The activity is still useful to the user
  // because they explicitly opted into watching this session.
  if (lastWasAssistant) return "completed"
  return "queued"
}

export function shouldEmitCleanupTaskEvent(input: { stillEnabled: boolean; phase: Phase }) {
  if (!input.stillEnabled) return true
  return input.phase === "completed" || input.phase === "failed"
}

/** Pull a single-line preview from the most recent user message. */
function previewFromUserMessage(messages: Message[] | undefined): string {
  if (!messages || messages.length === 0) return ""
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== "user") continue
    // Try the message's `info.title` first, then fall back to
    // flattening any text parts.
    const title = (m as Message & { info?: { title?: string } }).info?.title
    if (typeof title === "string" && title.trim()) return title
    return ""
  }
  return ""
}

/** Find any `error`-shaped part in the latest assistant turn. */
function detectError(messages: Message[] | undefined, parts: Record<string, Part[] | undefined>): boolean {
  if (!messages || messages.length === 0) return false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== "assistant") continue
    const messageParts = parts[m.id] ?? []
    if (messageParts.some((p) => (p as { type?: string } | undefined)?.type === "error")) return true
    return false
  }
  return false
}

interface PerSessionEmitterProps {
  sessionId: string
}

/**
 * Per-session emitter — one of these is created for each opted-in
 * session via the `<For>` below. We isolate the effect this way so
 * Solid can dispose the watcher cleanly when a session is opted out.
 */
const PerSessionEmitter: Component<PerSessionEmitterProps> = (props) => {
  const sync = useSync()
  const live = useLiveActivity()

  // Reactive snapshot of everything the emitter cares about for this
  // session. Splitting these into named memos keeps the dependency
  // graph crisp — Solid only re-runs the emit effect when the bits
  // actually change.
  const status = createMemo<StatusShape>(
    () => sync.data.session_status[props.sessionId] as StatusShape,
  )
  const messages = createMemo(() => sync.data.message[props.sessionId] ?? [])
  const previewTitle = createMemo(() => previewFromUserMessage(messages()))
  const turns = createMemo(() => messages().filter((m) => m.role === "user").length)
  const hasPendingAssistant = createMemo(() => hasPendingAssistantMessage(messages()))
  const lastWasAssistant = createMemo(() => {
    const list = messages()
    const last = list[list.length - 1]
    return last?.role === "assistant"
  })
  const hasError = createMemo(() => detectError(messages(), sync.data.part))

  // Pin the startedAt to the most recent user message so the shell's
  // elapsed timer matches what the user remembers triggering the work.
  const startedAt = createMemo(() => {
    const list = messages()
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (m?.role !== "user") continue
      const time = (m as Message & { time?: { created?: number } }).time?.created
      return typeof time === "number" ? new Date(time).toISOString() : new Date().toISOString()
    }
    return new Date().toISOString()
  })

  // Phase derives from the combined signals. We post on every change;
  // the shell rate-limits its ActivityKit updates internally.
  const phase = createMemo<Phase>(() =>
    statusToPhase({
      status: status(),
      hasError: hasError(),
      lastWasAssistant: lastWasAssistant(),
      hasPendingAssistant: hasPendingAssistant(),
    }),
  )

  // Single emit effect — collapses any combination of upstream changes
  // into one outbound message. `on` makes the deps explicit so we
  // don't accidentally drag in unrelated reactive reads from the body.
  createEffect(
    on(
      [phase, previewTitle, turns, startedAt],
      ([currentPhase, currentTitle, currentTurns, currentStartedAt]) => {
        postTaskEvent({
          type: "codeplane:task",
          taskId: props.sessionId,
          phase: currentPhase,
          // queueDepth: server-side detail we don't yet thread through
          // to the embedded UI. The shell renders 0 as "no queue", which
          // is the right default for a single-session-per-row activity.
          queueDepth: 0,
          currentMessage: currentTitle,
          progress: null,
          startedAt: currentStartedAt,
          turns: currentTurns,
        })
      },
    ),
  )

  onCleanup(() => {
    const currentPhase = phase()
    if (!shouldEmitCleanupTaskEvent({ stillEnabled: live.enabled(props.sessionId), phase: currentPhase })) return

    // Best-effort terminal frame so the Lock Screen doesn't leave a
    // stale badge on a session the user has just opted out of, without
    // falsely completing running work during route/project remounts.
    postTaskEvent({
      type: "codeplane:task",
      taskId: props.sessionId,
      phase: currentPhase === "failed" ? "failed" : "completed",
      queueDepth: 0,
      currentMessage: previewTitle(),
      progress: 1,
      startedAt: startedAt(),
      turns: turns(),
    })
  })

  return null
}

/**
 * Top-level wrapper — placed inside `DirectoryDataProvider` so both
 * `useLiveActivity` and `useSync` resolve. Renders nothing visible;
 * the work is entirely in the per-session effects.
 */
export const LiveActivityTaskEmitter: Component = () => {
  const live = useLiveActivity()
  // `enabledSessionIds()` is reactive — adding a session opens a new
  // emitter, removing one disposes its effect (and fires the cleanup
  // above to flush the terminal frame).
  return <For each={live.enabledSessionIds()}>{(id) => <PerSessionEmitter sessionId={id} />}</For>
}
