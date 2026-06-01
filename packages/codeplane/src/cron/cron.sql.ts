import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { Timestamps } from "../storage/schema.sql"
import type { ProjectID } from "../project/schema"
import type { SessionID } from "../session/schema"
import type { CronTaskID, CronRunID } from "./schema"

export const CronTaskTable = sqliteTable(
  "cron_task",
  {
    id: text().$type<CronTaskID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    name: text().notNull(),
    description: text(),
    prompt: text().notNull(),
    agent: text(),
    model: text(),
    schedule_kind: text().notNull(),
    schedule_value: text().notNull(),
    timezone: text(),
    status: text().notNull(),
    timeout_ms: integer(),
    max_retries: integer(),
    last_run_id: text().$type<CronRunID>(),
    last_run_at: integer(),
    last_run_status: text(),
    last_error: text(),
    next_run_at: integer(),
    mcp_servers: text({ mode: "json" }).$type<string[]>(),
    ...Timestamps,
  },
  (table) => [
    index("cron_task_project_idx").on(table.project_id),
    index("cron_task_status_next_idx").on(table.status, table.next_run_at),
  ],
)

export const CronRunTable = sqliteTable(
  "cron_run",
  {
    id: text().$type<CronRunID>().primaryKey(),
    task_id: text()
      .$type<CronTaskID>()
      .notNull()
      .references(() => CronTaskTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionID>(),
    status: text().notNull(),
    attempt: integer().notNull(),
    time_started: integer(),
    time_completed: integer(),
    error_message: text(),
    logs: text(),
    ...Timestamps,
  },
  (table) => [
    index("cron_run_task_idx").on(table.task_id),
    index("cron_run_session_idx").on(table.session_id),
    index("cron_run_status_idx").on(table.status),
  ],
)
