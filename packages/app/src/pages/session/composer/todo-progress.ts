import type { Todo } from "@codeplane-ai/sdk/v2"

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"

// Mirror of the server's coercion (session/todo.ts). The server normalizes
// on write, so todos arriving over SSE are already canonical — this keeps
// the UI correct for any other path (optimistic/local writes, older data).
const STATUS_ALIASES: Record<string, TodoStatus> = {
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

export const todoStatus = (todo: Pick<Todo, "status">): TodoStatus =>
  STATUS_ALIASES[(todo.status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? "pending"

export const isCompleted = (todo: Pick<Todo, "status">) => todoStatus(todo) === "completed"
export const isCancelled = (todo: Pick<Todo, "status">) => todoStatus(todo) === "cancelled"
export const isInProgress = (todo: Pick<Todo, "status">) => todoStatus(todo) === "in_progress"
export const isResolved = (todo: Pick<Todo, "status">) => isCompleted(todo) || isCancelled(todo)

export const isHighPriority = (todo: Pick<Todo, "priority">) =>
  (todo.priority ?? "").trim().toLowerCase() === "high" ||
  (todo.priority ?? "").trim().toLowerCase() === "urgent" ||
  (todo.priority ?? "").trim().toLowerCase() === "critical"

/**
 * Progress over a todo list. Cancelled tasks are excluded from the
 * denominator — they are no longer work to be done — so a list that ends
 * with completed + cancelled items still reads as fully done (and the
 * dock's progress can actually reach 100%).
 */
export function todoProgress(todos: ReadonlyArray<Pick<Todo, "status">>) {
  let total = 0
  let done = 0
  for (const todo of todos) {
    if (isCancelled(todo)) continue
    total += 1
    if (isCompleted(todo)) done += 1
  }
  return {
    total,
    done,
    allResolved: todos.length > 0 && todos.every(isResolved),
  }
}
