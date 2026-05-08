import { InstanceState } from "@/effect"
import { Runner } from "@/effect"
import { Effect, Layer, Scope, Context } from "effect"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"

export interface Interface {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  /**
   * Submit work; runs immediately when idle, or queues behind active work
   * (up to {@link MAX_QUEUED_PROMPTS}). Returns `Session.BusyError` as a
   * typed failure when the queue is full so callers (HTTP error middleware,
   * UI) can render a stable shape rather than parse a defect.
   */
  readonly ensureRunning: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
  ) => Effect.Effect<MessageV2.WithParts, Session.BusyError>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
  ) => Effect.Effect<MessageV2.WithParts>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/SessionRunState") {}

/**
 * Maximum number of user messages a single session can have queued behind
 * the active turn. Hitting this returns BusyError to the caller.
 *
 * Bumped from 1 (the previous implicit limit) to give users headroom to
 * fire follow-up messages without rejection. Override via env if needed.
 */
const DEFAULT_QUEUE_CAPACITY = (() => {
  const raw = process.env["CODEPLANE_RUNNER_QUEUE_CAPACITY"]
  if (!raw) return 10
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 10
})()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const runners = new Map<SessionID, Runner.Runner<MessageV2.WithParts>>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            // Drain every runner. We await each cancel so that the queue is
            // failed and the active fiber is interrupted before the runtime
            // is torn down — matters for orphan-recovery on next start, and
            // for not leaving zombie tool calls hanging.
            yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            runners.clear()
          }),
        )
        return { runners, scope }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing) return existing
      const next = Runner.make<MessageV2.WithParts>(data.scope, {
        queueCapacity: DEFAULT_QUEUE_CAPACITY,
        onIdle: Effect.gen(function* () {
          data.runners.delete(sessionID)
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy", queued: 0 }),
        onQueueChange: (depth) => status.set(sessionID, { type: "busy", queued: depth }),
        onInterrupt,
        busy: () => {
          throw new Session.BusyError(sessionID)
        },
      })
      data.runners.set(sessionID, next)
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      // Busy now also means "has anything queued" — destructive ops (delete
      // message, revert) must not race a queued user message.
      if (existing && (existing.busy || existing.queueDepth > 0)) throw new Session.BusyError(sessionID)
    })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      // Always ask the runner to cancel — even if `busy` is false, the queue
      // may hold pending items that need draining. The runner's own cancel is
      // the source of truth.
      if (!existing) {
        yield* status.set(sessionID, { type: "idle" })
        return
      }
      yield* existing.cancel
    })

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
    ) {
      // Translate Runner.QueueFull into a typed BusyError so callers and the
      // HTTP error middleware see a stable shape rather than a defect.
      // Effect 4 beta uses `catchDefect` (not `catchAllDefect`), and
      // `Schema.TaggedErrorClass` instances are detected with `instanceof`.
      return yield* (yield* runner(sessionID, onInterrupt)).ensureRunning(work, { queue: true }).pipe(
        Effect.catchDefect((d) => {
          if (d instanceof Runner.QueueFull) return Effect.fail(new Session.BusyError(sessionID))
          return Effect.die(d)
        }),
      )
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
    ) {
      return yield* (yield* runner(sessionID, onInterrupt)).startShell(work)
    })

    return Service.of({ assertNotBusy, cancel, ensureRunning, startShell })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionStatus.defaultLayer))

export * as SessionRunState from "./run-state"
