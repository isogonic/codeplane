import { Cause, Effect, Exit, Layer, Context } from "effect"
import { Bus } from "@/bus"
import { Cron } from "./cron"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Question } from "@/question"
import { Permission } from "@/permission"
import { Project } from "@/project"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { AppRuntime } from "@/effect/app-runtime"
import { Log } from "@/util"
import type { Task, Run } from "./cron"
import type { CronRunID, CronTaskID } from "./schema"
import type { ProjectID } from "@/project/schema"

const log = Log.create({ service: "cron.scheduler" })

const TICK_MS = 2_000
const DEFAULT_TIMEOUT_MS = 30 * 60_000
const MAX_CONCURRENT_PER_PROJECT = 10
const DEFAULT_MAX_RETRIES = 2
const RETRY_BACKOFF_MS = 30_000

// Open ruleset: cron sessions cannot prompt for permissions interactively, so
// allow everything. The auto-reject hook below also rejects clarification
// questions raised by the agent.
const ALLOW_ALL_PERMISSIONS: Permission.Ruleset = [
  { permission: "*", pattern: "*", action: "allow" } as Permission.Rule,
]

export interface Interface {
  readonly start: () => Effect.Effect<void>
  readonly stop: () => Effect.Effect<void>
  readonly tick: () => Effect.Effect<void>
  readonly cancelRun: (runID: CronRunID) => Effect.Effect<void>
  readonly cancelTask: (taskID: CronTaskID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/CronScheduler") {}

type Active = {
  abort: AbortController
  timeoutHandle: ReturnType<typeof setTimeout> | undefined
  detachQuestion: () => void
  sessionID?: string
  taskID: CronTaskID
  projectID: ProjectID
}

const active = new Map<CronRunID, Active>()
const terminalStatuses = new Set<Run["status"]>(["success", "failed", "timeout", "cancelled"])

const countActiveForProject = (projectID: ProjectID): number => {
  let n = 0
  for (const slot of active.values()) {
    if (slot.projectID === projectID) n++
  }
  return n
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cron = yield* Cron.Service

    let timer: ReturnType<typeof setInterval> | undefined
    let startupTimer: ReturnType<typeof setTimeout> | undefined
    let started = false
    const retryTimers = new Set<ReturnType<typeof setTimeout>>()

    /**
     * On restart, any run that was "running" or "queued" should be re-queued
     * so the scheduler picks it up where it left off. We cannot resume the
     * exact same agent session (the prompt streaming state was lost), so we
     * mark the previous attempt as interrupted and create a fresh queued run
     * for the same task with attempt + 1.
     */
    const recoverIncompleteRuns = Effect.fn("CronScheduler.recover")(function* () {
      const runs = yield* cron.findRunningRuns().pipe(
        Effect.catch(() => Effect.succeed([] as Run[])),
      )
      for (const run of runs) {
        log.warn("recovering interrupted run", { runID: run.id, taskID: run.taskID, attempt: run.attempt })
        yield* cron
          .recordRun({
            runID: run.id,
            patch: {
              status: "failed",
              timeCompleted: Date.now(),
              errorMessage: "Server restart while running — re-queued",
            },
          })
          .pipe(Effect.catch(() => Effect.void))
        // Re-queue at next attempt so it picks back up after restart.
        yield* cron
          .requeue({ taskID: run.taskID, attempt: run.attempt + 1 })
          .pipe(
            Effect.catchCause((cause) => {
              log.error("failed to requeue interrupted run", {
                taskID: run.taskID,
                cause: Cause.pretty(cause),
              })
              return Effect.void
            }),
          )
      }
    })

    const appendLog = (run: Run, line: string) => {
      const stamp = new Date().toISOString()
      const next = (run.logs ? run.logs + "\n" : "") + `[${stamp}] ${line}`
      return cron.recordRun({ runID: run.id, patch: { logs: next } })
    }

    const scheduleRetry = (task: Task, run: Run, nextAttempt: number) => {
      if (!started) return
      const retryTimer = setTimeout(() => {
        retryTimers.delete(retryTimer)
        if (!started) return
        AppRuntime.runPromise(
          cron.requeue({ taskID: task.id, attempt: nextAttempt }),
        ).catch((err) => {
          log.error("retry requeue failed", {
            taskID: task.id,
            runID: run.id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }, RETRY_BACKOFF_MS)
      retryTimers.add(retryTimer)
    }

    /**
     * Runs the prompt inside Instance.provide for the task's directory. Returns
     * the session ID when the prompt completes (or throws on failure/timeout).
     */
    const runInsideInstance = async (task: Task, run: Run, abort: AbortController): Promise<string> => {
      const directory = task.directory || Project.get(task.projectID)?.worktree || task.projectID
      return await Instance.provide({
        directory,
        init: () => AppRuntime.runPromise(InstanceBootstrap),
        fn: () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const session = yield* Session.Service
              const sessions = yield* SessionPrompt.Service
              const question = yield* Question.Service
              const bus = yield* Bus.Service

              const created = yield* session.create({
                title: `[Cron] ${task.name}`,
                permission: ALLOW_ALL_PERMISSIONS,
                cronRunID: run.id,
              })
              yield* cron.recordRun({
                runID: run.id,
                patch: {
                  sessionID: created.id,
                  status: "running",
                  timeStarted: Date.now(),
                },
              })

              const slot = active.get(run.id)
              if (slot) slot.sessionID = created.id

              const detach = yield* bus.subscribeCallback(Question.Event.Asked, async (payload) => {
                if (payload.properties.sessionID !== created.id) return
                log.info("auto-rejecting cron question", {
                  sessionID: created.id,
                  requestID: payload.properties.id,
                })
                await AppRuntime.runPromise(question.reject(payload.properties.id)).catch(() => undefined)
              })
              if (slot) slot.detachQuestion = detach

              const onAbort = () => {
                AppRuntime.runPromise(sessions.cancel(created.id)).catch(() => undefined)
              }
              if (abort.signal.aborted) onAbort()
              else abort.signal.addEventListener("abort", onAbort, { once: true })

              const parts: SessionPrompt.PromptInput["parts"] = [{ type: "text", text: task.prompt }]
              const ref = task.model ? parseModelRef(task.model) : undefined
              const promptInput = {
                sessionID: created.id,
                parts,
                ...(task.agent ? { agent: task.agent } : {}),
                ...(ref ? { model: ref } : {}),
              } as SessionPrompt.PromptInput
              yield* Effect.gen(function* () {
                abort.signal.throwIfAborted()
                yield* sessions.prompt(promptInput)
              }).pipe(
                Effect.ensuring(Effect.sync(() => abort.signal.removeEventListener("abort", onAbort))),
              )
              return created.id
            }),
          ),
      })
    }

    const executeRun = Effect.fn("CronScheduler.executeRun")(function* (input: { task: Task; run: Run }) {
      const { task, run } = input
      log.info("executing cron run", { taskID: task.id, runID: run.id, directory: task.directory })

      const slot = active.get(run.id)
      const abort = slot?.abort ?? new AbortController()
      const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const timeoutHandle = setTimeout(() => {
        log.warn("cron run timeout", { runID: run.id })
        abort.abort()
      }, timeoutMs)

      active.set(run.id, {
        abort,
        timeoutHandle,
        detachQuestion: slot?.detachQuestion ?? (() => undefined),
        sessionID: slot?.sessionID,
        taskID: task.id,
        projectID: task.projectID,
      })

      const cleanup = () => {
        const slot = active.get(run.id)
        if (slot) {
          if (slot.timeoutHandle) clearTimeout(slot.timeoutHandle)
          slot.detachQuestion()
          active.delete(run.id)
        }
      }

      yield* Effect.gen(function* () {
        const exit = yield* Effect.tryPromise({
          try: () => runInsideInstance(task, run, abort),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(Effect.exit)

        if (Exit.isSuccess(exit)) {
          const sessionID = exit.value
          const completedAt = Date.now()
          const current = yield* cron.getRun(run.id).pipe(
            Effect.catch(() => Effect.succeed(undefined as Run | undefined)),
          )
          if (!current) {
            log.warn("cron run disappeared before completion", { runID: run.id, taskID: task.id })
            return
          }
          if (terminalStatuses.has(current.status) && current.status !== "success") {
            yield* appendLog(current, `Session ${sessionID} completed after run was ${current.status}`).pipe(
              Effect.ignore,
            )
            return
          }
          yield* cron.recordRun({
            runID: run.id,
            patch: { status: "success", timeCompleted: completedAt },
          })
          const fresh = yield* cron.getRun(run.id)
          yield* appendLog(fresh, `Completed (session ${sessionID})`).pipe(Effect.ignore)
          yield* cron.markTaskAfterRun({
            taskID: task.id,
            runID: run.id,
            runStatus: "success",
            completedAt,
          })
          return
        }

        const squashed = Cause.squash(exit.cause)
        const message = squashed instanceof Error ? squashed.message : String(squashed)
        log.error("cron run failed", {
          runID: run.id,
          taskID: task.id,
          attempt: run.attempt,
          error: message,
          cause: Cause.pretty(exit.cause),
        })
        const completedAt = Date.now()
        const current = yield* cron.getRun(run.id).pipe(
          Effect.catch(() => Effect.succeed(undefined as Run | undefined)),
        )
        const wasCancelled = current?.status === "cancelled"
        if (wasCancelled) {
          yield* appendLog(current, "Cancelled").pipe(Effect.ignore)
          return
        }

        const isTimeout = abort.signal.aborted
        const finalStatus: "timeout" | "failed" = isTimeout ? "timeout" : "failed"
        yield* cron
          .recordRun({
            runID: run.id,
            patch: {
              status: finalStatus,
              timeCompleted: completedAt,
              errorMessage: message,
            },
          })
          .pipe(Effect.catch(() => Effect.void))
        yield* cron
          .markTaskAfterRun({
            taskID: task.id,
            runID: run.id,
            runStatus: finalStatus,
            completedAt,
            error: message,
          })
          .pipe(Effect.catch(() => Effect.void))

        // Retry policy: only retry on real failures (not user cancellation, not timeout).
        const maxRetries = task.maxRetries ?? DEFAULT_MAX_RETRIES
        const canRetry = !wasCancelled && !isTimeout && run.attempt <= maxRetries
        if (!canRetry) return
        const nextAttempt = run.attempt + 1
        log.info("scheduling retry", {
          taskID: task.id,
          previousRunID: run.id,
          nextAttempt,
          maxRetries,
          backoffMs: RETRY_BACKOFF_MS,
        })
        scheduleRetry(task, run, nextAttempt)
      }).pipe(Effect.ensuring(Effect.sync(cleanup)))
    })

    const reserveSlot = (run: Run, projectID: ProjectID) => {
      if (active.has(run.id)) return false
      if (countActiveForProject(projectID) >= MAX_CONCURRENT_PER_PROJECT) return false
      active.set(run.id, {
        abort: new AbortController(),
        timeoutHandle: undefined,
        detachQuestion: () => undefined,
        taskID: run.taskID,
        projectID,
      })
      return true
    }

    const tick = Effect.fn("CronScheduler.tick")(function* () {
      const now = Date.now()
      const due = yield* cron.claimDueTasks(now).pipe(
        Effect.catch((error) => {
          log.error("claimDueTasks failed", { error: String(error) })
          return Effect.succeed([] as { task: Task; run: Run }[])
        }),
      )
      if (due.length > 0) {
        log.info("tick: claimed scheduled tasks", { count: due.length })
        for (const item of due) {
          if (!reserveSlot(item.run, item.task.projectID)) continue
          AppRuntime.runFork(executeRun(item))
        }
      }
      const orphans = yield* cron.findOrphanQueuedRuns().pipe(
        Effect.catch((error) => {
          log.error("findOrphanQueuedRuns failed", { error: String(error) })
          return Effect.succeed([] as Run[])
        }),
      )
      for (const run of orphans) {
        if (active.has(run.id)) continue
        const task = yield* cron.get(run.taskID).pipe(
          Effect.catch(() => Effect.succeed(undefined as Task | undefined)),
        )
        if (!task) {
          log.warn("orphan run has no task — marking failed", { runID: run.id, taskID: run.taskID })
          yield* cron
            .recordRun({
              runID: run.id,
              patch: {
                status: "failed",
                timeCompleted: Date.now(),
                errorMessage: "Task no longer exists",
              },
            })
            .pipe(Effect.catch(() => Effect.void))
          continue
        }
        if (!reserveSlot(run, task.projectID)) continue
        log.info("tick: executing orphan queued run", {
          runID: run.id,
          taskID: run.taskID,
          attempt: run.attempt,
          projectActive: countActiveForProject(task.projectID),
        })
        AppRuntime.runFork(executeRun({ task, run }))
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

    const start = Effect.fn("CronScheduler.start")(function* () {
      if (started) return
      started = true
      yield* recoverIncompleteRuns()
      if (!started) return
      timer = setInterval(safeTick, TICK_MS)
      // Kick an immediate tick so any orphan/queued runs don't wait for the first interval.
      startupTimer = setTimeout(() => {
        startupTimer = undefined
        safeTick()
      }, 100)
      log.info("scheduler started", { tickMs: TICK_MS })
    })

    const cancelRun = Effect.fn("CronScheduler.cancelRun")(function* (runID: CronRunID) {
      yield* cron.cancelRun(runID)
      const slot = active.get(runID)
      if (slot) {
        if (slot.timeoutHandle) {
          clearTimeout(slot.timeoutHandle)
          slot.timeoutHandle = undefined
        }
        slot.abort.abort()
      }
    })

    const cancelTask = Effect.fn("CronScheduler.cancelTask")(function* (taskID: CronTaskID) {
      for (const slot of active.values()) {
        if (slot.taskID !== taskID) continue
        if (slot.timeoutHandle) {
          clearTimeout(slot.timeoutHandle)
          slot.timeoutHandle = undefined
        }
        slot.abort.abort()
      }
    })

    const stop = Effect.fn("CronScheduler.stop")(function* () {
      const wasStarted = started
      if (!started && !timer && !startupTimer && retryTimers.size === 0 && active.size === 0) return
      started = false
      if (timer) clearInterval(timer)
      if (startupTimer) clearTimeout(startupTimer)
      timer = undefined
      startupTimer = undefined
      for (const retryTimer of retryTimers) {
        clearTimeout(retryTimer)
      }
      retryTimers.clear()
      for (const [, slot] of active) {
        if (slot.timeoutHandle) clearTimeout(slot.timeoutHandle)
        slot.detachQuestion()
        slot.abort.abort()
      }
      active.clear()
      if (wasStarted) log.info("scheduler stopped")
    })

    return Service.of({ start, stop, tick, cancelRun, cancelTask })
  }),
)

function parseModelRef(ref: string): { providerID: string; modelID: string } | undefined {
  const idx = ref.indexOf("/")
  if (idx <= 0 || idx >= ref.length - 1) return undefined
  return {
    providerID: ref.slice(0, idx),
    modelID: ref.slice(idx + 1),
  }
}

export const defaultLayer = layer.pipe(Layer.provide(Cron.defaultLayer))

export * as CronScheduler from "./scheduler"
