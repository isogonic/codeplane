import { Effect, Layer, Context, Schema, Types } from "effect"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { SessionID } from "@/session/schema"
import { ProjectID } from "@/project/schema"
import { Log } from "@/util"
import { NamedError } from "@codeplane-ai/shared/util/error"
import { Database, NotFoundError, and, eq, desc, lte } from "../storage"
import { CronTaskTable, CronRunTable } from "./cron.sql"
import { ProjectTable } from "../project/project.sql"
import { CronTaskID, CronRunID } from "./schema"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { CronExpression } from "./expression"

export const CronValidationError = NamedError.create(
  "CronValidationError",
  z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
)

const log = Log.create({ service: "cron" })

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const Schedule = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("cron"),
    expression: Schema.String.annotate({ description: "Standard 5-field cron expression" }),
  }),
  Schema.Struct({
    kind: Schema.Literal("interval"),
    intervalMs: Schema.Number.annotate({ description: "Run repeatedly every N milliseconds (>= 60000)" }),
  }),
])
  .annotate({ identifier: "CronSchedule" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Schedule = Types.DeepMutable<Schema.Schema.Type<typeof Schedule>>

export const Status = Schema.Literals(["active", "paused", "disabled"])
  .annotate({ identifier: "CronStatus" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Status = Schema.Schema.Type<typeof Status>

export const RunStatus = Schema.Literals(["queued", "running", "success", "failed", "timeout", "cancelled"])
  .annotate({ identifier: "CronRunStatus" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type RunStatus = Schema.Schema.Type<typeof RunStatus>

const Time = Schema.Struct({
  created: Schema.Number,
  updated: Schema.Number,
})

export const Task = Schema.Struct({
  id: CronTaskID,
  projectID: ProjectID,
  directory: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  prompt: Schema.String,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  schedule: Schedule,
  timezone: Schema.optional(Schema.String),
  status: Status,
  timeoutMs: Schema.optional(Schema.Number),
  maxRetries: Schema.optional(Schema.Number),
  lastRunID: Schema.optional(CronRunID),
  lastRunAt: Schema.optional(Schema.Number),
  lastRunStatus: Schema.optional(RunStatus),
  lastError: Schema.optional(Schema.String),
  nextRunAt: Schema.optional(Schema.Number),
  time: Time,
})
  .annotate({ identifier: "CronTask" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Task = Types.DeepMutable<Schema.Schema.Type<typeof Task>>

export const Run = Schema.Struct({
  id: CronRunID,
  taskID: CronTaskID,
  sessionID: Schema.optional(SessionID),
  status: RunStatus,
  attempt: Schema.Number,
  timeStarted: Schema.optional(Schema.Number),
  timeCompleted: Schema.optional(Schema.Number),
  errorMessage: Schema.optional(Schema.String),
  logs: Schema.optional(Schema.String),
  time: Time,
})
  .annotate({ identifier: "CronRun" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Run = Types.DeepMutable<Schema.Schema.Type<typeof Run>>

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const CreateInput = Schema.Struct({
  projectID: Schema.optional(ProjectID),
  directory: Schema.optional(Schema.String),
  name: Schema.String,
  description: Schema.optional(Schema.String),
  prompt: Schema.String,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  schedule: Schedule,
  timezone: Schema.optional(Schema.String),
  status: Schema.optional(Status),
  timeoutMs: Schema.optional(Schema.Number),
  maxRetries: Schema.optional(Schema.Number),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type CreateInput = Types.DeepMutable<Schema.Schema.Type<typeof CreateInput>>

export const UpdateInput = Schema.Struct({
  taskID: CronTaskID,
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  prompt: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  schedule: Schema.optional(Schedule),
  timezone: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Status),
  timeoutMs: Schema.optional(Schema.NullOr(Schema.Number)),
  maxRetries: Schema.optional(Schema.NullOr(Schema.Number)),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type UpdateInput = Types.DeepMutable<Schema.Schema.Type<typeof UpdateInput>>

// ---------------------------------------------------------------------------
// Bus events
// ---------------------------------------------------------------------------

export const Event = {
  TaskCreated: BusEvent.define("cron.task.created", Task),
  TaskUpdated: BusEvent.define("cron.task.updated", Task),
  TaskDeleted: BusEvent.define(
    "cron.task.deleted",
    Schema.Struct({ taskID: CronTaskID, projectID: ProjectID }),
  ),
  RunCreated: BusEvent.define("cron.run.created", Run),
  RunUpdated: BusEvent.define("cron.run.updated", Run),
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

type TaskRow = typeof CronTaskTable.$inferSelect
type RunRow = typeof CronRunTable.$inferSelect

function decodeSchedule(kind: string, value: string): Schedule {
  if (kind === "interval") {
    const intervalMs = Number(value)
    if (!Number.isFinite(intervalMs)) throw new Error(`Invalid interval value: ${value}`)
    return { kind: "interval", intervalMs }
  }
  if (kind === "cron") return { kind: "cron", expression: value }
  throw new Error(`Unknown schedule kind: ${kind}`)
}

function encodeSchedule(schedule: Schedule): { kind: string; value: string } {
  if (schedule.kind === "interval") return { kind: "interval", value: String(schedule.intervalMs) }
  return { kind: "cron", value: schedule.expression }
}

export function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    projectID: row.project_id,
    directory: row.directory,
    name: row.name,
    description: row.description ?? undefined,
    prompt: row.prompt,
    agent: row.agent ?? undefined,
    model: row.model ?? undefined,
    schedule: decodeSchedule(row.schedule_kind, row.schedule_value),
    timezone: row.timezone ?? undefined,
    status: row.status as Status,
    timeoutMs: row.timeout_ms ?? undefined,
    maxRetries: row.max_retries ?? undefined,
    lastRunID: row.last_run_id ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    lastRunStatus: (row.last_run_status as RunStatus | null) ?? undefined,
    lastError: row.last_error ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

export function runFromRow(row: RunRow): Run {
  return {
    id: row.id,
    taskID: row.task_id,
    sessionID: row.session_id ?? undefined,
    status: row.status as RunStatus,
    attempt: row.attempt,
    timeStarted: row.time_started ?? undefined,
    timeCompleted: row.time_completed ?? undefined,
    errorMessage: row.error_message ?? undefined,
    logs: row.logs ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------

const MIN_INTERVAL_MS = 60_000

export function computeNextRunAt(schedule: Schedule, from: number = Date.now()): number {
  if (schedule.kind === "interval") {
    const interval = Math.max(schedule.intervalMs, MIN_INTERVAL_MS)
    return from + interval
  }
  return CronExpression.next(schedule.expression, from)
}

export function validateSchedule(schedule: Schedule): void {
  if (schedule.kind === "interval") {
    if (!Number.isFinite(schedule.intervalMs) || schedule.intervalMs < MIN_INTERVAL_MS) {
      throw new CronValidationError({
        message: `Interval must be at least ${MIN_INTERVAL_MS / 60_000} minute(s)`,
        field: "schedule.intervalMs",
      })
    }
    return
  }
  if (!CronExpression.isValid(schedule.expression)) {
    throw new CronValidationError({
      message: `Invalid cron expression: ${schedule.expression}`,
      field: "schedule.expression",
    })
  }
}

export function validateInput(input: { name?: string; prompt?: string }): void {
  if (input.name !== undefined && !input.name.trim()) {
    throw new CronValidationError({ message: "Name is required", field: "name" })
  }
  if (input.prompt !== undefined && !input.prompt.trim()) {
    throw new CronValidationError({ message: "Prompt is required", field: "prompt" })
  }
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Task>
  readonly update: (input: UpdateInput) => Effect.Effect<Task>
  readonly remove: (taskID: CronTaskID) => Effect.Effect<void>
  readonly get: (taskID: CronTaskID) => Effect.Effect<Task>
  readonly list: (input?: { projectID?: ProjectID; directory?: string }) => Effect.Effect<Task[]>
  readonly setStatus: (input: { taskID: CronTaskID; status: Status }) => Effect.Effect<Task>
  readonly trigger: (taskID: CronTaskID) => Effect.Effect<Run>
  readonly requeue: (input: { taskID: CronTaskID; attempt: number }) => Effect.Effect<Run>
  readonly cancelRun: (runID: CronRunID) => Effect.Effect<void>
  readonly listRuns: (taskID: CronTaskID, limit?: number) => Effect.Effect<Run[]>
  readonly getRun: (runID: CronRunID) => Effect.Effect<Run>
  readonly recordRun: (input: {
    runID: CronRunID
    patch: Partial<{
      status: RunStatus
      sessionID: SessionID
      timeStarted: number
      timeCompleted: number
      errorMessage: string
      logs: string
      attempt: number
    }>
  }) => Effect.Effect<Run>
  readonly markTaskAfterRun: (input: {
    taskID: CronTaskID
    runID: CronRunID
    runStatus: RunStatus
    completedAt: number
    error?: string
  }) => Effect.Effect<Task>
  readonly claimDueTasks: (now: number, limit?: number) => Effect.Effect<{ task: Task; run: Run }[]>
  readonly findRunningRuns: () => Effect.Effect<Run[]>
  readonly findOrphanQueuedRuns: () => Effect.Effect<Run[]>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/Cron") {}

const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
  Effect.sync(() => Database.use(fn))


function emit<D extends { type: string }>(def: D, properties: unknown, projectID?: ProjectID) {
  GlobalBus.emit("event", {
    directory: "global",
    project: projectID,
    payload: { type: def.type, properties },
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const get = Effect.fn("Cron.get")(function* (taskID: CronTaskID) {
      const row = yield* db((d) => d.select().from(CronTaskTable).where(eq(CronTaskTable.id, taskID)).get())
      if (!row) throw new NotFoundError({ message: `Cron task not found: ${taskID}` })
      return taskFromRow(row)
    })

    const getRun = Effect.fn("Cron.getRun")(function* (runID: CronRunID) {
      const row = yield* db((d) => d.select().from(CronRunTable).where(eq(CronRunTable.id, runID)).get())
      if (!row) throw new NotFoundError({ message: `Cron run not found: ${runID}` })
      return runFromRow(row)
    })

    const list = Effect.fn("Cron.list")(function* (input?: { projectID?: ProjectID; directory?: string }) {
      const rows = yield* db((d) => {
        const filters = [
          input?.projectID ? eq(CronTaskTable.project_id, input.projectID) : undefined,
          input?.directory ? eq(CronTaskTable.directory, input.directory) : undefined,
        ].filter(Boolean) as ReturnType<typeof eq>[]
        const where = filters.length > 0 ? and(...filters) : undefined
        const builder = where
          ? d.select().from(CronTaskTable).where(where)
          : d.select().from(CronTaskTable)
        return builder.orderBy(desc(CronTaskTable.time_updated)).all()
      })
      return rows.map(taskFromRow)
    })

    const create = Effect.fn("Cron.create")(function* (input: CreateInput) {
      yield* Effect.sync(() => {
        validateInput({ name: input.name, prompt: input.prompt })
        validateSchedule(input.schedule)
      })
      const project = yield* db((d) => {
        if (input.projectID) {
          return d
            .select({ id: ProjectTable.id, worktree: ProjectTable.worktree })
            .from(ProjectTable)
            .where(eq(ProjectTable.id, input.projectID))
            .get()
        }
        if (input.directory) {
          return d
            .select({ id: ProjectTable.id, worktree: ProjectTable.worktree })
            .from(ProjectTable)
            .where(eq(ProjectTable.worktree, input.directory))
            .get()
        }
        return undefined
      })
      if (!project) {
        throw new NotFoundError({
          message: `Project not found${input.directory ? ` for ${input.directory}` : ""}`,
        })
      }
      const id = CronTaskID.descending()
      const now = Date.now()
      const status = input.status ?? "active"
      const nextRun = status === "active" ? computeNextRunAt(input.schedule, now) : null
      const sched = encodeSchedule(input.schedule)
      const directory = input.directory || project.worktree
      yield* db((d) =>
        d
          .insert(CronTaskTable)
          .values({
            id,
            project_id: project.id,
            directory,
            name: input.name,
            description: input.description ?? null,
            prompt: input.prompt,
            agent: input.agent ?? null,
            model: input.model ?? null,
            schedule_kind: sched.kind,
            schedule_value: sched.value,
            timezone: input.timezone ?? null,
            status,
            timeout_ms: input.timeoutMs ?? null,
            max_retries: input.maxRetries ?? null,
            last_run_id: null,
            last_run_at: null,
            last_run_status: null,
            last_error: null,
            next_run_at: nextRun,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
      const task = yield* get(id)
      emit(Event.TaskCreated, task, task.projectID)
      log.info("task created", { id, project: project.id, schedule: sched })
      return task
    })

    const update = Effect.fn("Cron.update")(function* (input: UpdateInput) {
      yield* Effect.sync(() => validateInput({ name: input.name, prompt: input.prompt }))
      const existing = yield* get(input.taskID)
      const next: Partial<typeof CronTaskTable.$inferInsert> = {}
      if (input.name !== undefined) next.name = input.name
      if (input.description !== undefined) next.description = input.description ?? null
      if (input.prompt !== undefined) next.prompt = input.prompt
      if (input.agent !== undefined) next.agent = input.agent ?? null
      if (input.model !== undefined) next.model = input.model ?? null
      if (input.timezone !== undefined) next.timezone = input.timezone ?? null
      if (input.timeoutMs !== undefined) next.timeout_ms = input.timeoutMs ?? null
      if (input.maxRetries !== undefined) next.max_retries = input.maxRetries ?? null

      const newSchedule = input.schedule ?? existing.schedule
      if (input.schedule) {
        yield* Effect.sync(() => validateSchedule(input.schedule!))
        const sched = encodeSchedule(input.schedule)
        next.schedule_kind = sched.kind
        next.schedule_value = sched.value
      }

      const newStatus = input.status ?? existing.status
      if (input.status !== undefined) next.status = input.status

      if (input.schedule || input.status !== undefined) {
        next.next_run_at = newStatus === "active" ? computeNextRunAt(newSchedule, Date.now()) : null
      }

      next.time_updated = Date.now()

      yield* db((d) => d.update(CronTaskTable).set(next).where(eq(CronTaskTable.id, input.taskID)).run())
      const task = yield* get(input.taskID)
      emit(Event.TaskUpdated, task, task.projectID)
      return task
    })

    const remove = Effect.fn("Cron.remove")(function* (taskID: CronTaskID) {
      const existing = yield* get(taskID)
      yield* db((d) => d.delete(CronTaskTable).where(eq(CronTaskTable.id, taskID)).run())
      emit(Event.TaskDeleted, { taskID, projectID: existing.projectID }, existing.projectID)
    })

    const setStatus = Effect.fn("Cron.setStatus")(function* (input: { taskID: CronTaskID; status: Status }) {
      return yield* update({ taskID: input.taskID, status: input.status })
    })

    const insertRun = (taskID: CronTaskID, attempt: number, status: RunStatus) =>
      Effect.gen(function* () {
        const id = CronRunID.ascending()
        const now = Date.now()
        yield* db((d) =>
          d
            .insert(CronRunTable)
            .values({
              id,
              task_id: taskID,
              session_id: null,
              status,
              attempt,
              time_started: status === "running" ? now : null,
              time_completed: null,
              error_message: null,
              logs: null,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const run = yield* getRun(id)
        emit(Event.RunCreated, run)
        return run
      })

    const recordRun = Effect.fn("Cron.recordRun")(function* (input: {
      runID: CronRunID
      patch: Partial<{
        status: RunStatus
        sessionID: SessionID
        timeStarted: number
        timeCompleted: number
        errorMessage: string
        logs: string
        attempt: number
      }>
    }) {
      const next: Partial<typeof CronRunTable.$inferInsert> = { time_updated: Date.now() }
      if (input.patch.status !== undefined) next.status = input.patch.status
      if (input.patch.sessionID !== undefined) next.session_id = input.patch.sessionID
      if (input.patch.timeStarted !== undefined) next.time_started = input.patch.timeStarted
      if (input.patch.timeCompleted !== undefined) next.time_completed = input.patch.timeCompleted
      if (input.patch.errorMessage !== undefined) next.error_message = input.patch.errorMessage
      if (input.patch.logs !== undefined) next.logs = input.patch.logs
      if (input.patch.attempt !== undefined) next.attempt = input.patch.attempt
      yield* db((d) => d.update(CronRunTable).set(next).where(eq(CronRunTable.id, input.runID)).run())
      const run = yield* getRun(input.runID)
      emit(Event.RunUpdated, run)
      return run
    })

    const markTaskAfterRun = Effect.fn("Cron.markTaskAfterRun")(function* (input: {
      taskID: CronTaskID
      runID: CronRunID
      runStatus: RunStatus
      completedAt: number
      error?: string
    }) {
      const task = yield* get(input.taskID)
      const nextRun = task.status === "active" ? computeNextRunAt(task.schedule, input.completedAt) : null
      yield* db((d) =>
        d
          .update(CronTaskTable)
          .set({
            last_run_id: input.runID,
            last_run_at: input.completedAt,
            last_run_status: input.runStatus,
            last_error: input.error ?? null,
            next_run_at: nextRun,
            time_updated: Date.now(),
          })
          .where(eq(CronTaskTable.id, input.taskID))
          .run(),
      )
      const updated = yield* get(input.taskID)
      emit(Event.TaskUpdated, updated, updated.projectID)
      return updated
    })

    const trigger = Effect.fn("Cron.trigger")(function* (taskID: CronTaskID) {
      const task = yield* get(taskID)
      const run = yield* insertRun(taskID, 1, "queued")
      log.info("trigger queued", { taskID, runID: run.id, project: task.projectID })
      return run
    })

    const requeue = Effect.fn("Cron.requeue")(function* (input: { taskID: CronTaskID; attempt: number }) {
      const task = yield* get(input.taskID)
      const run = yield* insertRun(input.taskID, Math.max(1, input.attempt), "queued")
      log.info("requeue queued", {
        taskID: input.taskID,
        runID: run.id,
        attempt: run.attempt,
        project: task.projectID,
      })
      return run
    })

    const findOrphanQueuedRuns = Effect.fn("Cron.findOrphanQueuedRuns")(function* () {
      const rows = yield* db((d) =>
        d
          .select()
          .from(CronRunTable)
          .where(eq(CronRunTable.status, "queued"))
          .orderBy(CronRunTable.time_created)
          .all(),
      )
      return rows.map(runFromRow)
    })

    const cancelRun = Effect.fn("Cron.cancelRun")(function* (runID: CronRunID) {
      const run = yield* getRun(runID)
      if (run.status === "success" || run.status === "failed" || run.status === "cancelled" || run.status === "timeout") {
        return
      }
      yield* recordRun({
        runID,
        patch: {
          status: "cancelled",
          timeCompleted: Date.now(),
          errorMessage: "Cancelled by user",
        },
      })
      yield* markTaskAfterRun({
        taskID: run.taskID,
        runID,
        runStatus: "cancelled",
        completedAt: Date.now(),
        error: "Cancelled by user",
      })
    })

    const listRuns = Effect.fn("Cron.listRuns")(function* (taskID: CronTaskID, limit = 50) {
      const rows = yield* db((d) =>
        d
          .select()
          .from(CronRunTable)
          .where(eq(CronRunTable.task_id, taskID))
          .orderBy(desc(CronRunTable.time_created))
          .limit(limit)
          .all(),
      )
      return rows.map(runFromRow)
    })

    /**
     * Atomic claim: select due `active` tasks and create a queued run for each
     * in a single transaction. Updates `next_run_at` so a tick collision can't
     * pick the same task twice.
     */
    const claimDueTasks = Effect.fn("Cron.claimDueTasks")(function* (now: number, limit = 200) {
      const claimed = yield* Effect.sync(() =>
        Database.transaction((d) => {
          const rows = d
            .select()
            .from(CronTaskTable)
            .where(and(eq(CronTaskTable.status, "active"), lte(CronTaskTable.next_run_at, now)))
            .orderBy(CronTaskTable.next_run_at)
            .limit(limit)
            .all()
          const claimedRows: { task: Task; runID: CronRunID }[] = []
          for (const row of rows) {
            const task = taskFromRow(row)
            // bump next_run_at so we don't double-claim
            const projected = computeNextRunAt(task.schedule, now)
            d.update(CronTaskTable)
              .set({ next_run_at: projected, time_updated: now })
              .where(eq(CronTaskTable.id, task.id))
              .run()
            const runID = CronRunID.ascending()
            d.insert(CronRunTable)
              .values({
                id: runID,
                task_id: task.id,
                session_id: null,
                status: "queued",
                attempt: 1,
                time_started: null,
                time_completed: null,
                error_message: null,
                logs: null,
                time_created: now,
                time_updated: now,
              })
              .run()
            claimedRows.push({ task, runID })
          }
          return claimedRows
        }),
      )

      const result: { task: Task; run: Run }[] = []
      for (const item of claimed) {
        const run = yield* getRun(item.runID)
        emit(Event.RunCreated, run, item.task.projectID)
        result.push({ task: item.task, run })
      }
      return result
    })

    const findRunningRuns = Effect.fn("Cron.findRunningRuns")(function* () {
      const rows = yield* db((d) =>
        d.select().from(CronRunTable).where(eq(CronRunTable.status, "running")).all(),
      )
      return rows.map(runFromRow)
    })

    return Service.of({
      create,
      update,
      remove,
      get,
      list,
      setStatus,
      trigger,
      requeue,
      cancelRun,
      listRuns,
      getRun,
      recordRun,
      markTaskAfterRun,
      claimDueTasks,
      findRunningRuns,
      findOrphanQueuedRuns,
    })
  }),
)

export const defaultLayer = layer

export * as Cron from "./cron"
