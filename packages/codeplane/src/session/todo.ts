import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { Effect, Layer, Context, Schema } from "effect"
import z from "zod"
import { Database, eq, asc } from "../storage"
import { TodoTable } from "./session.sql"

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
})
  .annotate({ identifier: "Todo" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

// The tool exposes `status`/`priority` as free-form strings so the model
// sees a simple JSON schema, but the clients (web dock, TUI) match exact
// canonical values. Coerce common variants — case, whitespace, hyphens,
// and obvious synonyms — to the canonical set so an "In Progress" or
// "done" from the model still renders correctly everywhere.
export type Status = "pending" | "in_progress" | "completed" | "cancelled"
export type Priority = "high" | "medium" | "low"

const STATUS_ALIASES: Record<string, Status> = {
  pending: "pending",
  todo: "pending",
  not_started: "pending",
  open: "pending",
  queued: "pending",
  in_progress: "in_progress",
  inprogress: "in_progress",
  active: "in_progress",
  working: "in_progress",
  started: "in_progress",
  doing: "in_progress",
  completed: "completed",
  complete: "completed",
  done: "completed",
  finished: "completed",
  cancelled: "cancelled",
  canceled: "cancelled",
  skipped: "cancelled",
  skip: "cancelled",
  abandoned: "cancelled",
}

const PRIORITY_ALIASES: Record<string, Priority> = {
  high: "high",
  urgent: "high",
  critical: "high",
  medium: "medium",
  med: "medium",
  normal: "medium",
  moderate: "medium",
  low: "low",
  minor: "low",
  trivial: "low",
}

const canonicalKey = (raw: string | null | undefined) =>
  (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")

export const normalizeStatus = (raw: string | null | undefined): Status => STATUS_ALIASES[canonicalKey(raw)] ?? "pending"

export const normalizePriority = (raw: string | null | undefined): Priority =>
  PRIORITY_ALIASES[canonicalKey(raw)] ?? "medium"

export const normalize = (todo: Info): Info => ({
  content: todo.content,
  status: normalizeStatus(todo.status),
  priority: normalizePriority(todo.priority),
})

export const Event = {
  Updated: BusEvent.define(
    "todo.updated",
    Schema.Struct({
      sessionID: SessionID,
      todos: Schema.Array(Info),
    }),
  ),
}

export interface Interface {
  readonly update: (input: { sessionID: SessionID; todos: Info[] }) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/SessionTodo") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const update = Effect.fn("Todo.update")(function* (input: { sessionID: SessionID; todos: Info[] }) {
      const todos = input.todos.map(normalize)
      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
          if (todos.length === 0) return
          db.insert(TodoTable)
            .values(
              todos.map((todo, position) => ({
                session_id: input.sessionID,
                content: todo.content,
                status: todo.status,
                priority: todo.priority,
                position,
              })),
            )
            .run()
        }),
      )
      yield* bus.publish(Event.Updated, { sessionID: input.sessionID, todos })
    })

    const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)).all(),
        ),
      )
      return rows.map((row) => ({
        content: row.content,
        status: row.status,
        priority: row.priority,
      }))
    })

    return Service.of({ update, get })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as Todo from "./todo"
