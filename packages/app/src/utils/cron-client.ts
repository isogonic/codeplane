import type { ServerConnection } from "@/context/server"

export type CronSchedule =
  | { kind: "cron"; expression: string }
  | { kind: "interval"; intervalMs: number }

export type CronStatus = "active" | "paused" | "disabled"
export type CronRunStatus = "queued" | "running" | "success" | "failed" | "timeout" | "cancelled"

export type CronTask = {
  id: string
  projectID: string
  directory: string
  name: string
  description?: string
  prompt: string
  agent?: string
  model?: string
  schedule: CronSchedule
  timezone?: string
  status: CronStatus
  timeoutMs?: number
  maxRetries?: number
  mcpServers?: string[]
  lastRunID?: string
  lastRunAt?: number
  lastRunStatus?: CronRunStatus
  lastError?: string
  nextRunAt?: number
  time: { created: number; updated: number }
}

export type CronRun = {
  id: string
  taskID: string
  sessionID?: string
  status: CronRunStatus
  attempt: number
  timeStarted?: number
  timeCompleted?: number
  errorMessage?: string
  logs?: string
  time: { created: number; updated: number }
}

export type CronCreateInput = {
  projectID?: string
  directory?: string
  name: string
  description?: string
  prompt: string
  agent?: string
  model?: string
  schedule: CronSchedule
  timezone?: string
  status?: CronStatus
  timeoutMs?: number
  maxRetries?: number
  mcpServers?: string[]
}

export type CronUpdateInput = {
  name?: string
  description?: string | null
  prompt?: string
  agent?: string | null
  model?: string | null
  schedule?: CronSchedule
  timezone?: string | null
  status?: CronStatus
  timeoutMs?: number | null
  maxRetries?: number | null
  mcpServers?: string[] | null
}

function authHeaders(server: ServerConnection.HttpBase): Record<string, string> {
  const headers: Record<string, string> = {}
  if (server.password) {
    headers.Authorization = `Basic ${btoa(`${server.username ?? "codeplane"}:${server.password}`)}`
  }
  if (server.otpToken) headers["x-codeplane-otp"] = server.otpToken
  return headers
}

export type CronApiError = Error & {
  status: number
  fieldIssues?: { path: string; message: string }[]
}

function formatPath(path: unknown): string {
  if (!Array.isArray(path)) return ""
  return path
    .map((p) => (typeof p === "object" && p !== null && "key" in p ? (p as { key: unknown }).key : p))
    .filter((p) => p !== undefined && p !== null)
    .join(".")
}

function parseErrorBody(body: unknown, statusText: string): {
  detail: string
  fieldIssues?: { path: string; message: string }[]
} {
  if (!body || typeof body !== "object") return { detail: statusText }
  const obj = body as Record<string, unknown>

  if (Array.isArray(obj.error) && obj.error.length > 0) {
    const issues = (obj.error as Array<Record<string, unknown>>)
      .map((e) => ({
        path: formatPath(e.path),
        message: typeof e.message === "string" ? e.message : "Invalid value",
      }))
    const detail = issues
      .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
      .join("; ")
    return { detail: detail || statusText, fieldIssues: issues }
  }

  if (typeof obj.name === "string" && obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>
    const message = typeof data.message === "string" ? data.message.split("\n")[0] : obj.name
    if (typeof data.field === "string") {
      return {
        detail: message,
        fieldIssues: [{ path: data.field, message }],
      }
    }
    return { detail: message }
  }

  if (typeof obj.message === "string") return { detail: obj.message.split("\n")[0] }
  return { detail: statusText }
}

async function call<T>(
  server: ServerConnection.HttpBase,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${server.url.replace(/\/$/, "")}${path}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    ...authHeaders(server),
    ...((init.headers as Record<string, string>) ?? {}),
  }
  const res = await fetch(url, { cache: "no-store", ...init, headers })
  if (!res.ok) {
    let parsed: { detail: string; fieldIssues?: { path: string; message: string }[] }
    try {
      parsed = parseErrorBody(await res.json(), res.statusText)
    } catch {
      parsed = { detail: res.statusText }
    }
    const err = new Error(parsed.detail) as CronApiError
    err.status = res.status
    if (parsed.fieldIssues) err.fieldIssues = parsed.fieldIssues
    throw err
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const CronClient = {
  list(server: ServerConnection.HttpBase, query?: { projectID?: string; directory?: string }) {
    const params = new URLSearchParams()
    if (query?.projectID) params.set("projectID", query.projectID)
    if (query?.directory) params.set("directory", query.directory)
    const search = params.toString()
    return call<CronTask[]>(server, `/global/cron${search ? `?${search}` : ""}`)
  },

  get(server: ServerConnection.HttpBase, taskID: string) {
    return call<CronTask>(server, `/global/cron/${encodeURIComponent(taskID)}`)
  },

  create(server: ServerConnection.HttpBase, body: CronCreateInput) {
    return call<CronTask>(server, "/global/cron", {
      method: "POST",
      body: JSON.stringify(body),
    })
  },

  update(server: ServerConnection.HttpBase, taskID: string, body: CronUpdateInput) {
    return call<CronTask>(server, `/global/cron/${encodeURIComponent(taskID)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  },

  remove(server: ServerConnection.HttpBase, taskID: string) {
    return call<boolean>(server, `/global/cron/${encodeURIComponent(taskID)}`, {
      method: "DELETE",
    })
  },

  setStatus(server: ServerConnection.HttpBase, taskID: string, status: CronStatus) {
    return call<CronTask>(server, `/global/cron/${encodeURIComponent(taskID)}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    })
  },

  trigger(server: ServerConnection.HttpBase, taskID: string) {
    return call<CronRun>(server, `/global/cron/${encodeURIComponent(taskID)}/trigger`, {
      method: "POST",
    })
  },

  listRuns(server: ServerConnection.HttpBase, taskID: string, limit?: number) {
    const search = limit ? `?limit=${limit}` : ""
    return call<CronRun[]>(server, `/global/cron/${encodeURIComponent(taskID)}/runs${search}`)
  },

  getRun(server: ServerConnection.HttpBase, runID: string) {
    return call<CronRun>(server, `/global/cron/runs/${encodeURIComponent(runID)}`)
  },

  cancelRun(server: ServerConnection.HttpBase, runID: string) {
    return call<boolean>(server, `/global/cron/runs/${encodeURIComponent(runID)}/cancel`, {
      method: "POST",
    })
  },
}
