import { Cause, Effect, Exit, Layer, Context } from "effect"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionPrompt } from "./prompt"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { AppRuntime } from "@/effect/app-runtime"
import { Log } from "@/util"
import { NamedError } from "@codeplane-ai/shared/util/error"
import { PromptQueue } from "./prompt-queue"
import type { Job } from "./prompt-queue"
import type { PromptJobID } from "./prompt-queue-schema"
import type { SessionID } from "./schema"

/**
 * Background worker that drains {@link PromptQueue}.
 *
 * Pattern matches {@link CronScheduler}: a periodic tick claims a batch of
 * pending jobs from the DB (per-session FIFO is enforced by `PromptQueue.claim`),
 * forks each into its own fiber on `AppRuntime`, and on exit records the
 * terminal status. Stuck `running` rows from a previous process crash are
 * recovered on `start()`.
 *
 * What this worker buys you over the previous fire-and-forget `prompt_async`:
 *   - The job survives a server restart.
 *   - Failures retry with bounded attempts and a backoff window.
 *   - Concurrent `prompt_async` calls for the same session form a real FIFO
 *     queue rather than racing into a depth-1 in-process slot.
 */

const log = Log.create({ service: "session.prompt-queue.worker" })

const TICK_MS = 1_000
const MAX_BATCH_PER_TICK = 32
/** Backoff applied when a job fails and is requeued. */
const RETRY_BACKOFF_MS = 5_000

export interface Interface {
  readonly start: () => Effect.Effect<void>
  readonly stop: () => Effect.Effect<void>
  readonly tick: () => Effect.Effect<void>
  readonly cancelJob: (jobID: PromptJobID) => Effect.Effect<void>
  readonly cancelSession: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/PromptQueueWorker") {}

type Active = {
  jobID: PromptJobID
  sessionID: SessionID
  abort: AbortController
}

const active = new Map<PromptJobID, Active>()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const queue = yield* PromptQueue.Service

    let timer: ReturnType<typeof setInterval> | undefined
    let started = false

    const recordTerminal = (jobID: PromptJobID, status: "completed" | "failed" | "cancelled", error?: string) =>
      queue
        .recordResult({ jobID, status, errorMessage: error })
        .pipe(Effect.catch(() => Effect.void))

    /**
     * Run a single job. Errors are caught and translated into `recordResult`
     * calls so the worker tick never throws — a failure here just transitions
     * the row to its next state and returns.
     */
    const executeJob = Effect.fn("PromptQueueWorker.executeJob")(function* (job: Job) {
      const abort = new AbortController()
      active.set(job.id, { jobID: job.id, sessionID: job.sessionID, abort })
      const cleanup = () => active.delete(job.id)

      // Parse payload. A malformed payload is non-recoverable: the row was
      // written by us, so a parse failure means a code change has stranded it.
      // Fail fast, don't retry.
      const parsed = yield* Effect.try({
        try: () => JSON.parse(job.payload) as Record<string, unknown>,
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      }).pipe(Effect.exit)
      if (Exit.isFailure(parsed)) {
        const message = `Failed to parse prompt-job payload: ${Cause.pretty(parsed.cause)}`
        log.error(message, { jobID: job.id, sessionID: job.sessionID })
        yield* recordTerminal(job.id, "failed", message)
        cleanup()
        return
      }

      // `directory` was captured at enqueue time in the request handler — it
      // should never be empty, but if a future caller forgets to set it we
      // log and fail rather than silently default to cwd.
      if (!job.directory) {
        const message = "Prompt job missing directory; cannot route to project instance"
        log.error(message, { jobID: job.id, sessionID: job.sessionID })
        yield* recordTerminal(job.id, "failed", message)
        cleanup()
        return
      }
      const directory = job.directory
      log.info("running job", {
        jobID: job.id,
        sessionID: job.sessionID,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
      })

      const exit = yield* Effect.tryPromise({
        try: () =>
          Instance.provide({
            directory,
            init: () => AppRuntime.runPromise(InstanceBootstrap),
            fn: () =>
              AppRuntime.runPromise(
                Effect.gen(function* () {
                  const sessions = yield* SessionPrompt.Service
                  const sessionService = yield* Session.Service
                  // Touch the session so it surfaces in recent lists, matches
                  // the synchronous `prompt` route's behavior.
                  yield* sessionService
                    .touch(job.sessionID)
                    .pipe(Effect.catch(() => Effect.void))

                  const promptInput = {
                    ...(parsed.value as object),
                    sessionID: job.sessionID,
                  } as SessionPrompt.PromptInput

                  // Wire abort: when worker calls abort.abort(), cancel the
                  // session's in-flight loop. The abort signal is not passed
                  // to `prompt()` directly because that interface takes only
                  // a `PromptInput`; we go through the public cancel path.
                  const onAbort = () => {
                    AppRuntime.runPromise(sessions.cancel(job.sessionID)).catch(() => undefined)
                  }
                  if (abort.signal.aborted) onAbort()
                  else abort.signal.addEventListener("abort", onAbort, { once: true })

                  return yield* Effect.gen(function* () {
                    abort.signal.throwIfAborted()
                    return yield* sessions.prompt(promptInput)
                  }).pipe(Effect.ensuring(Effect.sync(() => abort.signal.removeEventListener("abort", onAbort))))
                }),
              ),
          }),
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      }).pipe(Effect.exit)

      cleanup()

      if (Exit.isSuccess(exit)) {
        yield* queue.recordResult({ jobID: job.id, status: "completed" })
        return
      }

      const wasCancelled = abort.signal.aborted
      const squashed = Cause.squash(exit.cause)
      const message = squashed instanceof Error ? squashed.message : String(squashed)

      if (wasCancelled) {
        log.info("job cancelled", { jobID: job.id, sessionID: job.sessionID })
        yield* recordTerminal(job.id, "cancelled", message || "Cancelled")
        return
      }

      // Retry policy: bump status back to pending if we have attempts left.
      // The DB row's `attempt` was already incremented when we claimed it,
      // so `attempt < maxAttempts` means we still have at least one left.
      const canRetry = job.attempt < job.maxAttempts
      if (canRetry) {
        log.warn("job failed — requeuing", {
          jobID: job.id,
          sessionID: job.sessionID,
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
          error: message,
        })
        yield* queue
          .recordResult({
            jobID: job.id,
            status: "pending",
            errorMessage: message,
            nextRunAt: Date.now() + RETRY_BACKOFF_MS,
          })
          .pipe(Effect.catch(() => Effect.void))
        return
      }

      log.error("job failed permanently", {
        jobID: job.id,
        sessionID: job.sessionID,
        attempt: job.attempt,
        error: message,
      })
      yield* recordTerminal(job.id, "failed", message)
      // `Bus.publish` (the top-level wrapper) returns `Promise<void>` — it's
      // not pipeable as an Effect. Wrap it once so we can catch and ignore.
      yield* Effect.promise(() =>
        Bus.publish(Session.Event.Error, {
          sessionID: job.sessionID,
          error: new NamedError.Unknown({ message }).toObject(),
        }),
      ).pipe(Effect.catchCause(() => Effect.void))
    })

    const tick = Effect.fn("PromptQueueWorker.tick")(function* () {
      const now = Date.now()
      // `claim` declares E=never, so any DB blowup arrives as a defect.
      // `catchCause` covers both channels and lets the tick keep ticking
      // even if the transaction fails — losing one tick worth of pickups is
      // far better than letting the worker die and stalling every queued job.
      const claimed = yield* queue.claim(now, MAX_BATCH_PER_TICK).pipe(
        Effect.catchCause((cause) => {
          log.error("claim failed", { cause: Cause.pretty(cause) })
          return Effect.succeed([] as Job[])
        }),
      )
      if (claimed.length === 0) return
      log.info("claimed jobs", { count: claimed.length })
      for (const job of claimed) {
        // executeJob's inferred R can leak through Effect.fn's tracing
        // wrapper as `unknown` even when the body of the function only uses
        // services already in AppRuntime. Casting through `Effect<void>` is
        // safe here: every yield inside executeJob is either a captured
        // value (`queue`) or already provided by AppRuntime.
        AppRuntime.runFork(executeJob(job) as Effect.Effect<void>)
      }
    })

    let ticking = false
    const safeTick = () => {
      if (!started || ticking) return
      ticking = true
      AppRuntime.runPromise(tick())
        .catch((err) => {
          log.error("tick error", { error: err instanceof Error ? err.message : String(err) })
        })
        .finally(() => {
          ticking = false
        })
    }

    const start = Effect.fn("PromptQueueWorker.start")(function* () {
      if (started) return
      started = true
      // Same E=never / defect dance as `tick`; we never want a recover
      // failure to prevent the worker from coming up at all.
      const recovered = yield* queue.recover().pipe(
        Effect.catchCause((cause) => {
          log.error("recover failed", { cause: Cause.pretty(cause) })
          return Effect.succeed([] as Job[])
        }),
      )
      if (recovered.length > 0) log.info("recovered jobs from previous run", { count: recovered.length })
      timer = setInterval(safeTick, TICK_MS)
      // Don't wait a whole tick on cold start — push immediately so a queued
      // job from the recovery pass runs within milliseconds, not seconds.
      setTimeout(safeTick, 50)
      log.info("worker started", { tickMs: TICK_MS })
    })

    const stop = Effect.fn("PromptQueueWorker.stop")(function* () {
      if (!started && !timer && active.size === 0) return
      started = false
      if (timer) clearInterval(timer)
      timer = undefined
      // Abort in-flight jobs so the process can exit cleanly. Their final
      // recordResult will mark them `cancelled`, and on next start `recover`
      // would still re-queue them if anything slipped through.
      for (const slot of active.values()) {
        try {
          slot.abort.abort()
        } catch {}
      }
      active.clear()
      log.info("worker stopped")
    })

    const cancelJob = Effect.fn("PromptQueueWorker.cancelJob")(function* (jobID: PromptJobID) {
      yield* queue.cancel(jobID).pipe(Effect.catch(() => Effect.void))
      const slot = active.get(jobID)
      if (slot) {
        try {
          slot.abort.abort()
        } catch {}
      }
    })

    const cancelSession = Effect.fn("PromptQueueWorker.cancelSession")(function* (sessionID: SessionID) {
      const cancelled = yield* queue.cancelSession(sessionID).pipe(Effect.catch(() => Effect.succeed(0)))
      log.info("cancelled pending jobs for session", { sessionID, count: cancelled })
      // Also signal any in-flight job for this session.
      for (const slot of active.values()) {
        if (slot.sessionID !== sessionID) continue
        try {
          slot.abort.abort()
        } catch {}
      }
    })

    return Service.of({ start, stop, tick, cancelJob, cancelSession })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(PromptQueue.defaultLayer))

export * as PromptQueueWorker from "./prompt-queue-worker"
