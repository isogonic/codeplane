export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"

export const STATUS_ALIASES: Record<string, TodoStatus> = {
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

export const todoStatus = (todo: Pick<{ status: string }, "status">): TodoStatus =>
  STATUS_ALIASES[(todo.status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? "pending"

export const isCompleted = (todo: Pick<{ status: string }, "status">) => todoStatus(todo) === "completed"
export const isCancelled = (todo: Pick<{ status: string }, "status">) => todoStatus(todo) === "cancelled"
export const isInProgress = (todo: Pick<{ status: string }, "status">) => todoStatus(todo) === "in_progress"
export const isResolved = (todo: Pick<{ status: string }, "status">) => isCompleted(todo) || isCancelled(todo)

export const isHighPriority = (todo: Pick<{ priority: string }, "priority">) =>
  (todo.priority ?? "").trim().toLowerCase() === "high" ||
  (todo.priority ?? "").trim().toLowerCase() === "urgent" ||
  (todo.priority ?? "").trim().toLowerCase() === "critical"

export function todoProgress(todos: ReadonlyArray<Pick<{ status: string }, "status">>) {
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
