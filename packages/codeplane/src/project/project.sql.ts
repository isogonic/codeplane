import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import type { ProjectID } from "./schema"

type ProjectCommandStorage =
  | string
  | {
      command: string
      label?: string
      description?: string
      cwd?: string
      env?: string[]
      labels?: string[]
      kind?: string
      context?: boolean
      timeout?: number
      interactive?: boolean
    }

export const ProjectTable = sqliteTable("project", {
  id: text().$type<ProjectID>().primaryKey(),
  worktree: text().notNull(),
  vcs: text(),
  name: text(),
  icon_url: text(),
  icon_url_override: text(),
  icon_color: text(),
  ...Timestamps,
  time_initialized: integer(),
  sandboxes: text({ mode: "json" }).notNull().$type<string[]>(),
  commands: text({ mode: "json" }).$type<Record<string, ProjectCommandStorage>>(),
})
