import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import type { SessionID } from "./schema"
import type { PromptJobID } from "./prompt-queue-schema"

/**
 * Persisted backlog for `POST /session/:id/prompt_async` and other fire-and-forget
 * prompt invocations. The HTTP handler enqueues a row, returns 204, and the
 * `PromptQueueWorker` claims rows in FIFO order per-session and runs the
 * prompt via `SessionPrompt.Service.prompt(...)`.
 *
 * Status state machine:
 *   pending  → claimed by a worker tick
 *   running  → prompt loop in flight
 *   completed → success
 *   failed   → exhausted retries (last error in error_message)
 *   cancelled → user explicitly cancelled before/while running
 *
 * On boot the worker scans `running` rows (process died mid-run) and either
 * re-queues them (if attempt < max_attempts) or marks them `failed`.
 */
export const PromptJobTable = sqliteTable(
  "prompt_job",
  {
    id: text().$type<PromptJobID>().primaryKey(),
    session_id: text().$type<SessionID>().notNull(),
    /**
     * Project working directory the worker should `Instance.provide` into when
     * running this job. We snapshot it at enqueue time so a later project
     * rename or move doesn't strand the job.
     */
    directory: text().notNull(),
    /** JSON-encoded `SessionPrompt.PromptInput` minus `sessionID`. */
    payload: text().notNull(),
    status: text().notNull(),
    attempt: integer().notNull(),
    max_attempts: integer().notNull(),
    /** Earliest wall-clock ms when the worker may pick this row up next. */
    next_run_at: integer(),
    time_started: integer(),
    time_completed: integer(),
    error_message: text(),
    /**
     * Explicit run-order override. NULL means "use natural id order" (i.e.
     * insertion / FIFO). Reorder operations assign small ascending integers
     * (0, 1, 2, ...) so reordered rows sort before never-reordered ones; new
     * enqueues land with NULL, so they naturally go after any reordered set.
     * `claim` orders by `sort_order ASC NULLS LAST, id ASC`.
     */
    sort_order: integer(),
    ...Timestamps,
  },
  (table) => [
    index("prompt_job_session_idx").on(table.session_id),
    index("prompt_job_status_next_idx").on(table.status, table.next_run_at),
    index("prompt_job_status_sort_idx").on(table.status, table.sort_order),
  ],
)
