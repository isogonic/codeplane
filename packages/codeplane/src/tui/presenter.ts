// Pure mappers from SDK shapes to the view layer's prop shapes. Kept separate
// from app.tsx so they can be unit tested without React/Ink.
import type {
  CronTask,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@codeplane-ai/sdk/v2/client"
import type { ConversationPart, DiffLine, SessionItem, TodoItem } from "./view"

function formatTime(value?: number) {
  if (!value) return undefined
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function toSessionItems(sessions: Session[], statuses: Record<string, SessionStatus>): SessionItem[] {
  return sessions.map((session) => {
    const status = statuses[session.id]
    return {
      id: session.id,
      title: session.title,
      status:
        status?.type === "busy"
          ? "busy"
          : status?.type === "retry"
            ? "retry"
            : session.time.archived
              ? "archived"
              : "idle",
      busyAttempt: status?.type === "retry" ? status.attempt : undefined,
      shared: !!session.share?.url,
      reverted: !!session.revert,
    }
  })
}

export function toTodoItems(todos: Todo[]): TodoItem[] {
  return todos.map((todo, index) => ({
    id: `${index}:${todo.content.slice(0, 24)}`,
    status:
      todo.status === "completed"
        ? "completed"
        : todo.status === "in_progress"
          ? "in_progress"
          : "pending",
    priority: todo.priority === "high" || todo.priority === "medium" || todo.priority === "low" ? todo.priority : undefined,
    text: todo.content,
  }))
}

export function toDiffLines(diffs: SnapshotFileDiff[]): DiffLine[] {
  if (diffs.length === 0) return []
  const out: DiffLine[] = []
  for (const diff of diffs) {
    out.push({
      kind: "header",
      text: `${diff.file} (+${diff.additions} / -${diff.deletions})`,
    })
    const lines = diff.patch.split("\n")
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) out.push({ kind: "added", text: line.slice(1) })
      else if (line.startsWith("-") && !line.startsWith("---")) out.push({ kind: "removed", text: line.slice(1) })
      else out.push({ kind: "context", text: line })
    }
    out.push({ kind: "context", text: "" })
  }
  return out
}

export function toConversationParts(messages: Array<{ info: Message; parts: Part[] }>): ConversationPart[] {
  const out: ConversationPart[] = []
  for (const item of messages) {
    const role: "user" | "assistant" = item.info.role === "user" ? "user" : "assistant"
    const time = formatTime(item.info.time.created)
    const text = item.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
    if (text) {
      out.push({
        kind: "text",
        role,
        time,
        lines: text.split("\n"),
      })
    } else if (role === "user") {
      out.push({ kind: "text", role, time, lines: [""] })
    }
    for (const part of item.parts) {
      switch (part.type) {
        case "text":
          // Already absorbed above.
          break
        case "reasoning":
          out.push({ kind: "reasoning", lines: part.text.split("\n") })
          break
        case "tool": {
          const status =
            part.state.status === "completed"
              ? "completed"
              : part.state.status === "error"
                ? "error"
                : part.state.status === "running"
                  ? "running"
                  : "pending"
          const title = "title" in part.state ? part.state.title : undefined
          const output =
            part.state.status === "completed" && "output" in part.state && part.state.output
              ? String(part.state.output).split("\n")
              : part.state.status === "error" && "error" in part.state && part.state.error
                ? String(part.state.error).split("\n")
                : undefined
          out.push({ kind: "tool", name: part.tool, status, title, output })
          break
        }
        case "file":
          out.push({ kind: "file", name: part.filename ?? part.url ?? "file" })
          break
        case "subtask":
          out.push({ kind: "subtask", agent: part.agent, description: part.description })
          break
        case "agent":
          out.push({ kind: "agent", name: part.name })
          break
        case "retry":
          out.push({ kind: "retry", attempt: part.attempt, message: part.error.data.message })
          break
        case "compaction":
          out.push({ kind: "compaction", auto: part.auto, overflow: !!part.overflow })
          break
        case "patch":
          out.push({ kind: "patch", files: part.files })
          break
        case "snapshot":
          out.push({ kind: "snapshot", id: part.snapshot })
          break
        case "step-start":
          out.push({ kind: "step", phase: "start" })
          break
        case "step-finish":
          out.push({ kind: "step", phase: "finish", reason: part.reason })
          break
      }
    }
  }
  return out
}

export type NotificationListItem = {
  id: string
  title: string
  subtitle?: string
  tone: "permission" | "question"
}

export function toNotificationItems(
  permissions: PermissionRequest[],
  questions: QuestionRequest[],
): NotificationListItem[] {
  return [
    ...permissions.map((item) => ({
      id: item.id,
      title: item.permission,
      subtitle: item.patterns.length ? `patterns: ${item.patterns.join(", ")}` : undefined,
      tone: "permission" as const,
    })),
    ...questions.map((item) => ({
      id: item.id,
      title: item.questions[0]?.header ?? "Question",
      subtitle: item.questions[0]?.question,
      tone: "question" as const,
    })),
  ]
}

export type CronRow = { id: string; status: string; name: string; schedule: string }

export function toCronRows(tasks: CronTask[]): CronRow[] {
  return tasks.map((task) => ({
    id: task.id,
    status: task.status,
    name: task.name,
    schedule: task.schedule.kind === "cron" ? task.schedule.expression : `${task.schedule.intervalMs}ms`,
  }))
}

export const presenter = {
  formatTime,
  toSessionItems,
  toTodoItems,
  toDiffLines,
  toConversationParts,
  toNotificationItems,
  toCronRows,
}
