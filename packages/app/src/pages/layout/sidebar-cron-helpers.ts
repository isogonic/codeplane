import type { Session } from "@codeplane-ai/sdk/v2/client"
import type { CronRun, CronRunStatus } from "@/utils/cron-client"
import { directoryContains } from "@/context/global-sync/utils"

type CronSession = Session & {
  cronRunID?: string
}

export type CronSidebarRun = CronRun & {
  taskName: string
  taskDirectory: string
}

export type CronSidebarEntry = {
  id: string
  sessionID?: string
  taskName: string
  taskDirectory: string
  status: CronRunStatus
  startedAt: number
  sequence: number
}

export function cronTaskNameFromSessionTitle(title: string) {
  const match = title.match(/^\[Cron\]\s*(.+)$/)
  return match?.[1]?.trim()
}

export function isCronSessionInfo(session: (Pick<Session, "title"> & { cronRunID?: string }) | undefined) {
  if (!session) return false
  return !!session.cronRunID || !!cronTaskNameFromSessionTitle(session.title)
}

export function cronSidebarEntries(input: {
  runs: CronSidebarRun[]
  sessions: Session[]
  directory?: string
  directories?: string[]
  limit?: number
}): CronSidebarEntry[] {
  const directories = input.directories ?? (input.directory ? [input.directory] : [])
  const runSessionIDs = new Set(input.runs.map((run) => run.sessionID).filter((id): id is string => !!id))
  const runEntries = input.runs.map((run) => ({
    id: run.id,
    sessionID: run.sessionID,
    taskName: run.taskName,
    taskDirectory: run.taskDirectory,
    status: run.status,
    startedAt: run.timeStarted ?? run.time.created,
    createdAt: run.time.created,
  }))
  const legacyEntries = input.sessions
    .filter((session) => !session.parentID && !session.time?.archived)
    .filter(
      (session) =>
        directories.length === 0 ||
        directories.some((directory) => directoryContains(directory, session.directory)),
    )
    .filter((session) => !runSessionIDs.has(session.id))
    .map((session) => ({
      session,
      taskName: cronTaskNameFromSessionTitle(session.title),
    }))
    .filter((item) => isCronSessionInfo(item.session as CronSession))
    .map((item) => ({
      id: (item.session as CronSession).cronRunID ?? item.session.id,
      sessionID: item.session.id,
      taskName: item.taskName ?? item.session.title,
      taskDirectory: item.session.directory,
      status: "success" as const,
      startedAt: item.session.time.created,
      createdAt: item.session.time.created,
    }))
  const ascending = [...runEntries, ...legacyEntries].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const sequence = new Map(ascending.map((entry, index) => [entry.id, index + 1] as const))
  return ascending
    .map((entry) => ({
      ...entry,
      sequence: sequence.get(entry.id) ?? 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .slice(0, input.limit ?? 200)
}
