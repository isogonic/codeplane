import { Effect, Layer, Context, Schema } from "effect"
import z from "zod"
import { Log } from "@/util"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Database, NotFoundError, and, asc, eq, lte, isNull, or, inArray, sql } from "../storage"
import { NamedError } from "@codeplane-ai/shared/util/error"
import { PromptJobTable } from "./prompt-queue.sql"
import { PromptJobID, PromptJobStatus } from "./prompt-queue-schema"
import { SessionID } from "./schema"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

/**
 * Persistent prompt-queue service. The {@link PromptQueueWorker} is the one
 * caller in the running server — everything else (HTTP handlers, the cron
 * scheduler if it ever asks for queued work) goes through this service.
 *
 * Design choices worth knowing about before extending:
 *
 * 1. **Per-session FIFO is enforced by SQL.** {@link Interface.claim} only
 *    returns a row if no other row with the same `session_id` is currently
 *    `running`. The in-process `Runner` would queue work for us anyway, but
 *    its queue is depth-1; relying on it would silently coalesce N>2 pending
 *    jobs into one. The DB filter keeps every job distinct.
 *
 * 2. **Retries do not count an attempt twice.** `claim` increments `attempt`
 *    when it transitions pending → running. `recordResult({ retry: true })`
 *    flips the row back to `pending` without touching `attempt`, so the next
 *    claim will count it.
 *
 * 3. **`directory` is captured at enqueue time** so a project rename or move
 *    after enqueue doesn't strand the worker. The HTTP handler is inside
 *    `Instance.provide(...)` and so already knows the directory; the worker
 *    isn't and needs it back.
 */

const log = Log.create({ service: "session.prompt-queue" })

export const ConflictError = NamedError.create(
  "PromptQueueConflict",
  z.object({ message: z.string(), jobID: z.string().optional() }),
)

export const Job = Schema.Struct({
  id: PromptJobID,
  sessionID: SessionID,
  directory: Schema.String,
  payload: Schema.String,
  status: PromptJobStatus,
  attempt: Schema.Number,
  maxAttempts: Schema.Number,
  nextRunAt: Schema.optional(Schema.Number),
  timeStarted: Schema.optional(Schema.Number),
  timeCompleted: Schema.optional(Schema.Number),
  errorMessage: Schema.optional(Schema.String),
  sortOrder: Schema.optional(Schema.Number),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Job = Schema.Schema.Type<typeof Job>

export const DEFAULT_MAX_ATTEMPTS = 3

/**
 * In-process wake hook for the {@link PromptQueueWorker}. The worker
 * normally ticks on an interval, which adds up to a full tick of latency
 * between a fresh `enqueue` and the worker actually claiming the row. For
 * an idle session where the user expects instant response (the "send"
 * path), that delay is user-visible.
 *
 * Solution: the worker registers `safeTick` here on start, and `enqueue`
 * invokes it once the new row is committed. A no-op when the worker is
 * not running (tests, stop window) or not started yet. Errors are
 * swallowed — a missed wake just means we wait for the next interval
 * tick, which is the original behavior.
 */
let wakeNotifier: (() => void) | undefined

export function setWakeNotifier(notify: (() => void) | undefined) {
  wakeNotifier = notify
}

/**
 * Live updates pushed to subscribed clients (via the SSE event stream) so
 * every surface — TUI, web app, etc. — can render the queue without holding
 * its own copy. The contract is intentionally simple:
 *
 *   - `Created`  → a new row landed (status === "pending"). Add to view.
 *   - `Updated`  → a row's status / attempt / error / timestamps changed.
 *                  When the new status is terminal (completed/failed/cancelled)
 *                  clients typically drop it from the *active* queue view, but
 *                  the payload is still delivered so transient UI (e.g. brief
 *                  failure toast) can react before the row disappears.
 *   - `Removed`  → row is gone from the table entirely. Drop from view.
 *
 * Payloads embed `sessionID` at the top level so existing per-session filter
 * paths (the same ones `session.status` rides on) need no extra work.
 */
const PromptQueueJobEventSchema = Schema.Struct({
  sessionID: SessionID,
  job: Job,
})
const PromptQueueJobRemovedEventSchema = Schema.Struct({
  sessionID: SessionID,
  jobID: PromptJobID,
})

export const Event = {
  Created: BusEvent.define("session.queue.created", PromptQueueJobEventSchema),
  Updated: BusEvent.define("session.queue.updated", PromptQueueJobEventSchema),
  Removed: BusEvent.define("session.queue.removed", PromptQueueJobRemovedEventSchema),
}

export interface EnqueueInput {
  readonly sessionID: SessionID
  readonly directory: string
  /** JSON-serialized `SessionPrompt.PromptInput` (minus sessionID — the row
   *  has its own column). Stored verbatim. */
  readonly payload: string
  readonly maxAttempts?: number
}

export interface RecordResultInput {
  readonly jobID: PromptJobID
  /** terminal status, or `"pending"` to release the row back to the queue
   *  (used by the worker when re-queuing after a transient failure). */
  readonly status: PromptJobStatus
  readonly errorMessage?: string
  /** When `status === "pending"`, delay the next claim until this ms timestamp. */
  readonly nextRunAt?: number
}

export interface Interface {
  readonly enqueue: (input: EnqueueInput) => Effect.Effect<Job>
  readonly claim: (now: number, limit?: number) => Effect.Effect<Job[]>
  readonly recordResult: (input: RecordResultInput) => Effect.Effect<Job>
  readonly cancel: (jobID: PromptJobID) => Effect.Effect<void>
  readonly cancelSession: (sessionID: SessionID) => Effect.Effect<number>
  readonly get: (jobID: PromptJobID) => Effect.Effect<Job>
  readonly list: (input?: { sessionID?: SessionID; statuses?: PromptJobStatus[] }) => Effect.Effect<Job[]>
  /**
   * Boot-time recovery: anything left in `running` is the result of a process
   * that died mid-flight. Re-queue rows that still have attempts left, mark
   * the rest `failed`. Returns the recovered jobs for telemetry.
   */
  readonly recover: () => Effect.Effect<Job[]>
  /**
   * Rewrite the run order for the given session's *pending* rows. Callers
   * pass the complete intended order (each id must reference a pending row in
   * the session). The service assigns sort_order = 0, 1, 2, ... in input
   * order; running / completed / failed / cancelled rows are untouched.
   * Returns the affected jobs in their new order so callers can render the
   * result without a re-fetch.
   */
  readonly reorder: (input: { sessionID: SessionID; jobIDs: PromptJobID[] }) => Effect.Effect<Job[]>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/PromptQueue") {}

const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
  Effect.sync(() => Database.use(fn))

type Row = typeof PromptJobTable.$inferSelect

function fromRow(row: Row): Job {
  return {
    id: row.id,
    sessionID: row.session_id,
    directory: row.directory,
    payload: row.payload,
    status: row.status as PromptJobStatus,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    nextRunAt: row.next_run_at ?? undefined,
    timeStarted: row.time_started ?? undefined,
    timeCompleted: row.time_completed ?? undefined,
    errorMessage: row.error_message ?? undefined,
    sortOrder: row.sort_order ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    /**
     * Best-effort publish: a failure here must not roll back the DB mutation
     * we just committed, and clients can always re-fetch the snapshot over
     * HTTP if they miss an event. So we swallow and log; the row is
     * authoritative.
     */
    const publishCreated = (job: Job) =>
      bus.publish(Event.Created, { sessionID: job.sessionID, job }).pipe(
        Effect.catchCause((cause) => {
          log.warn("publish failed", { event: "created", jobID: job.id, cause: String(cause) })
          return Effect.void
        }),
      )
    const publishUpdated = (job: Job) =>
      bus.publish(Event.Updated, { sessionID: job.sessionID, job }).pipe(
        Effect.catchCause((cause) => {
          log.warn("publish failed", { event: "updated", jobID: job.id, cause: String(cause) })
          return Effect.void
        }),
      )
    const publishRemoved = (sessionID: SessionID, jobID: PromptJobID) =>
      bus.publish(Event.Removed, { sessionID, jobID }).pipe(
        Effect.catchCause((cause) => {
          log.warn("publish failed", { event: "removed", jobID, cause: String(cause) })
          return Effect.void
        }),
      )

    const get = Effect.fn("PromptQueue.get")(function* (jobID: PromptJobID) {
      const row = yield* db((d) => d.select().from(PromptJobTable).where(eq(PromptJobTable.id, jobID)).get())
      if (!row) throw new NotFoundError({ message: `Prompt job not found: ${jobID}` })
      return fromRow(row)
    })

    const list = Effect.fn("PromptQueue.list")(function* (input?: {
      sessionID?: SessionID
      statuses?: PromptJobStatus[]
    }) {
      const rows = yield* db((d) => {
        const filters = [
          input?.sessionID ? eq(PromptJobTable.session_id, input.sessionID) : undefined,
          input?.statuses && input.statuses.length > 0 ? inArray(PromptJobTable.status, input.statuses) : undefined,
        ].filter(Boolean) as ReturnType<typeof eq>[]
        const where = filters.length > 0 ? and(...filters) : undefined
        const builder = where
          ? d.select().from(PromptJobTable).where(where)
          : d.select().from(PromptJobTable)
        // Match `claim`'s ordering so clients render rows in the order the
        // worker will run them: explicit reorders first (sort_order ASC),
        // then insertion order (id ASC). `sort_order IS NULL` evaluates to
        // 1 for NULL and 0 otherwise — sorting ASC puts non-null first
        // (NULLS LAST), so a reordered subset always sorts before
        // never-reordered rows.
        return builder
          .orderBy(
            sql`${PromptJobTable.sort_order} IS NULL`,
            asc(PromptJobTable.sort_order),
            asc(PromptJobTable.id),
          )
          .all()
      })
      return rows.map(fromRow)
    })

    const enqueue = Effect.fn("PromptQueue.enqueue")(function* (input: EnqueueInput) {
      const now = Date.now()
      const id = PromptJobID.ascending()
      const row = yield* db((d) => {
        d.insert(PromptJobTable)
          .values({
            id,
            session_id: input.sessionID,
            directory: input.directory,
            payload: input.payload,
            status: "pending",
            attempt: 0,
            max_attempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
            next_run_at: null,
            time_started: null,
            time_completed: null,
            error_message: null,
            time_created: now,
            time_updated: now,
          })
          .run()
        return d.select().from(PromptJobTable).where(eq(PromptJobTable.id, id)).get()
      })
      if (!row) throw new Error(`failed to read back enqueued job ${id}`)
      const job = fromRow(row)
      log.info("enqueued", { jobID: id, sessionID: input.sessionID })
      yield* publishCreated(job)
      // Poke the worker so it claims this row immediately rather than
      // waiting up to TICK_MS for the next interval-driven tick. Best
      // effort — see comment on `wakeNotifier` above.
      try {
        wakeNotifier?.()
      } catch (err) {
        log.warn("wake notifier threw", { error: err instanceof Error ? err.message : String(err) })
      }
      return job
    })

    /**
     * Atomic claim: pick up to `limit` pending jobs that are due AND don't
     * have a sibling currently running for the same session. Mark them
     * `running` and bump `attempt` in one transaction so a tick collision
     * can't double-claim.
     */
    const claim = Effect.fn("PromptQueue.claim")(function* (now: number, limit = 32) {
      const rows = yield* Effect.sync(() =>
        Database.transaction(
          (d) => {
            // Sub-select: sessions that already have a running job. These are
            // ineligible for new claims to preserve per-session FIFO order.
            const busyRows = d
              .select({ session_id: PromptJobTable.session_id })
              .from(PromptJobTable)
              .where(eq(PromptJobTable.status, "running"))
              .all()
            const busy = new Set(busyRows.map((r) => r.session_id))

            const candidates = d
              .select()
              .from(PromptJobTable)
              .where(
                and(
                  eq(PromptJobTable.status, "pending"),
                  or(isNull(PromptJobTable.next_run_at), lte(PromptJobTable.next_run_at, now)),
                ),
              )
              // Run explicitly-reordered rows first (lowest sort_order wins),
              // then never-reordered rows in id (FIFO) order. `IS NULL` is 1
              // for NULL and 0 otherwise in SQLite, so ordering by it ASC
              // gives "non-null first, null last" — i.e. NULLS LAST semantics.
              .orderBy(
                sql`${PromptJobTable.sort_order} IS NULL`,
                asc(PromptJobTable.sort_order),
                asc(PromptJobTable.id),
              )
              // Over-fetch — we filter by `busy` in JS and need extra rows
              // to fill `limit` if many candidates share a busy session.
              .limit(limit * 4)
              .all()

            const claimed: Row[] = []
            for (const row of candidates) {
              if (claimed.length >= limit) break
              if (busy.has(row.session_id)) continue
              // Once we claim a job for a session, no further job for the
              // same session can be claimed in this tick.
              const updated = d
                .update(PromptJobTable)
                .set({
                  status: "running",
                  attempt: row.attempt + 1,
                  time_started: now,
                  time_updated: now,
                })
                .where(and(eq(PromptJobTable.id, row.id), eq(PromptJobTable.status, "pending")))
                .returning()
                .all()
              if (updated.length === 0) continue // lost a race with another claimer
              busy.add(row.session_id)
              claimed.push(updated[0]!)
            }
            return claimed
          },
          { behavior: "immediate" },
        ),
      )
      const jobs = rows.map(fromRow)
      // Notify subscribers that these rows have flipped pending → running.
      // We publish after the transaction commits so a subscriber doing a
      // follow-up DB read sees the new status. Best-effort — see publish*.
      for (const job of jobs) {
        yield* publishUpdated(job)
      }
      return jobs
    })

    const recordResult = Effect.fn("PromptQueue.recordResult")(function* (input: RecordResultInput) {
      const now = Date.now()
      const isTerminal = input.status === "completed" || input.status === "failed" || input.status === "cancelled"
      const row = yield* db((d) => {
        d.update(PromptJobTable)
          .set({
            status: input.status,
            error_message: input.errorMessage ?? null,
            next_run_at: input.status === "pending" ? (input.nextRunAt ?? null) : null,
            time_completed: isTerminal ? now : null,
            time_updated: now,
          })
          .where(eq(PromptJobTable.id, input.jobID))
          .run()
        return d.select().from(PromptJobTable).where(eq(PromptJobTable.id, input.jobID)).get()
      })
      if (!row) throw new NotFoundError({ message: `Prompt job not found: ${input.jobID}` })
      const job = fromRow(row)
      yield* publishUpdated(job)
      return job
    })

    const cancel = Effect.fn("PromptQueue.cancel")(function* (jobID: PromptJobID) {
      const job = yield* get(jobID)
      // Already terminal — cancellation is a no-op (idempotent).
      if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") return
      yield* recordResult({ jobID, status: "cancelled", errorMessage: "Cancelled by user" })
    })

    const cancelSession = Effect.fn("PromptQueue.cancelSession")(function* (sessionID: SessionID) {
      // Mark both pending and running rows cancelled. The worker checks the
      // durable row state before finalizing a successful-looking result, so a
      // late `MessageAbortedError` from the runner cannot overwrite the user's
      // explicit cancel back to `completed`.
      const now = Date.now()
      const affected = yield* db((d) => {
        // Read first so we know which rows to publish updates for after the
        // bulk update. This is a single SQL round-trip in better-sqlite3 and
        // bun-sqlite (both are synchronous), so the cost is negligible vs.
        // the value of accurate per-row notifications for the UI.
        const before = d
          .select()
          .from(PromptJobTable)
          .where(
            and(
              eq(PromptJobTable.session_id, sessionID),
              inArray(PromptJobTable.status, ["pending", "running"]),
            ),
          )
          .all()
        if (before.length === 0) return [] as Row[]
        d.update(PromptJobTable)
          .set({
            status: "cancelled",
            error_message: "Session-wide cancellation",
            time_completed: now,
            time_updated: now,
          })
          .where(
            and(
              eq(PromptJobTable.session_id, sessionID),
              inArray(PromptJobTable.status, ["pending", "running"]),
            ),
          )
          .run()
        return d
          .select()
          .from(PromptJobTable)
          .where(
            and(
              eq(PromptJobTable.session_id, sessionID),
              inArray(
                PromptJobTable.id,
                before.map((r) => r.id),
              ),
            ),
          )
          .all()
      })
      for (const row of affected) {
        yield* publishUpdated(fromRow(row))
      }
      return affected.length
    })

    const recover = Effect.fn("PromptQueue.recover")(function* () {
      const stuck = yield* db((d) =>
        d.select().from(PromptJobTable).where(eq(PromptJobTable.status, "running")).all(),
      )
      if (stuck.length === 0) return [] as Job[]
      log.warn("recovering stuck prompt jobs", { count: stuck.length })
      const recovered: Job[] = []
      for (const row of stuck) {
        const job = fromRow(row)
        const next: PromptJobStatus = job.attempt >= job.maxAttempts ? "failed" : "pending"
        const updatedAt = Date.now()
        // Use direct SQL update so we don't trip recordResult's terminal-time
        // logic for the requeue case.
        yield* db((d) =>
          d
            .update(PromptJobTable)
            .set({
              status: next,
              error_message:
                next === "failed"
                  ? "Server restarted while running and retries are exhausted"
                  : "Server restarted while running — re-queued",
              time_completed: next === "failed" ? updatedAt : null,
              // Light backoff so a crash-loop doesn't immediately rerun this row.
              next_run_at: next === "pending" ? updatedAt + 5_000 : null,
              time_updated: updatedAt,
            })
            .where(eq(PromptJobTable.id, job.id))
            .run(),
        )
        const recoveredJob: Job = {
          ...job,
          status: next,
          errorMessage:
            next === "failed"
              ? "Server restarted while running and retries are exhausted"
              : "Server restarted while running — re-queued",
          timeCompleted: next === "failed" ? updatedAt : undefined,
          nextRunAt: next === "pending" ? updatedAt + 5_000 : undefined,
          timeUpdated: updatedAt,
        }
        recovered.push(recoveredJob)
        // Notify subscribed clients so a freshly reconnected UI immediately
        // sees a recovered row's new status (still-queued vs. terminally
        // failed). Without this, the client has to poll the snapshot.
        yield* publishUpdated(recoveredJob)
      }
      return recovered
    })

    const reorder = Effect.fn("PromptQueue.reorder")(function* (input: {
      sessionID: SessionID
      jobIDs: PromptJobID[]
    }) {
      const { sessionID, jobIDs } = input
      if (jobIDs.length === 0) return [] as Job[]

      // Validate up-front: every id must reference a *pending* row in this
      // session. Anything else (running / completed / failed / cancelled, or
      // a row from a different session) is a caller bug — fail loud so the
      // UI sees the error instead of a silent partial reorder.
      const rows = yield* db((d) =>
        d
          .select()
          .from(PromptJobTable)
          .where(
            and(eq(PromptJobTable.session_id, sessionID), inArray(PromptJobTable.id, jobIDs)),
          )
          .all(),
      )
      const byID = new Map(rows.map((row) => [row.id, row] as const))
      for (const id of jobIDs) {
        const row = byID.get(id)
        if (!row) {
          throw new NotFoundError({ message: `Prompt job not found in session: ${id}` })
        }
        if (row.status !== "pending") {
          throw new ConflictError({
            message: `Cannot reorder job ${id}: status is ${row.status}, not pending`,
            jobID: id,
          })
        }
      }
      if (new Set(jobIDs).size !== jobIDs.length) {
        throw new ConflictError({ message: "Duplicate ids in reorder input" })
      }

      const now = Date.now()
      const updated = yield* Effect.sync(() =>
        Database.transaction(
          (d) => {
            const out: Row[] = []
            for (const [index, id] of jobIDs.entries()) {
              const result = d
                .update(PromptJobTable)
                .set({ sort_order: index, time_updated: now })
                .where(
                  and(
                    eq(PromptJobTable.id, id),
                    eq(PromptJobTable.session_id, sessionID),
                    eq(PromptJobTable.status, "pending"),
                  ),
                )
                .returning()
                .all()
              if (result.length === 0) {
                // Row flipped out of pending between the pre-check and this
                // update (e.g. worker just claimed it). Abort the whole
                // reorder rather than ship a half-applied one.
                throw new ConflictError({
                  message: `Cannot reorder job ${id}: row state changed`,
                  jobID: id,
                })
              }
              out.push(result[0]!)
            }
            return out
          },
          { behavior: "immediate" },
        ),
      )
      const jobs = updated.map(fromRow)
      for (const job of jobs) {
        yield* publishUpdated(job)
      }
      return jobs
    })

    return Service.of({ enqueue, claim, recordResult, cancel, cancelSession, get, list, recover, reorder })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as PromptQueue from "./prompt-queue"

// Re-export commonly used schema types from this module for convenience.
export { PromptJobID, PromptJobStatus } from "./prompt-queue-schema"
