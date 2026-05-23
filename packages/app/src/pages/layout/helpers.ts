import { getFilename } from "@codeplane-ai/shared/util/path"
import { type Session } from "@codeplane-ai/sdk/v2/client"
import { directoryContains, directoryKey } from "@/context/global-sync/utils"
import { isCronSessionInfo } from "./sidebar-cron-helpers"

type SessionStore = {
  project?: string
  session?: Session[]
  path: { directory: string }
}

export const workspaceKey = directoryKey

function sortSessions(now: number) {
  const oneMinuteAgo = now - 60 * 1000
  return (a: Session, b: Session) => {
    const aUpdated = a.time.updated ?? a.time.created
    const bUpdated = b.time.updated ?? b.time.created
    const aRecent = aUpdated > oneMinuteAgo
    const bRecent = bUpdated > oneMinuteAgo
    if (aRecent && bRecent) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return 1
    return bUpdated - aUpdated
  }
}

const sessionInDirectory = (session: Session, directory: string) => directoryContains(directory, session.directory)

const sessionInProject = (session: Session, project?: string) =>
  !project || !session.projectID || session.projectID === project

const isRootVisibleSession = (session: Session, directories: string[], project?: string) =>
  sessionInProject(session, project) &&
  directories.some((directory) => sessionInDirectory(session, directory)) &&
  !session.parentID &&
  !session.time?.archived &&
  !isCronSessionInfo(session as Session & { cronRunID?: string })

export const roots = (store: SessionStore, directory?: string) => {
  const directories = [directory, store.path.directory]
    .filter((value): value is string => !!value)
    .filter((value, index, list) => list.findIndex((item) => directoryKey(item) === directoryKey(value)) === index)
  return (store.session ?? []).filter((session) => isRootVisibleSession(session, directories, store.project))
}

export const sortedRootSessions = (store: SessionStore, now: number, directory?: string) =>
  roots(store, directory).sort(sortSessions(now))

export const childSessions = (sessions: Session[] | undefined, parentID: string, now: number) =>
  (sessions ?? []).filter((session) => session.parentID === parentID && !session.time?.archived).sort(sortSessions(now))

export const childSessionIndex = (sessions: Session[] | undefined, now: number) => {
  const result = (sessions ?? []).reduce((map, session) => {
    const parentID = session.parentID
    if (!parentID || session.time?.archived) return map
    const list = map.get(parentID)
    if (list) {
      list.push(session)
      return map
    }
    map.set(parentID, [session])
    return map
  }, new Map<string, Session[]>())
  result.forEach((list) => list.sort(sortSessions(now)))
  return result
}

export const loadedRootSessionCount = (sessions: Session[] | undefined) =>
  (sessions ?? []).filter((session) => !session.parentID && !session.time?.archived).length

export const hasMoreVisibleSessions = (input: { loadedRootCount: number; total: number; visible: number }) =>
  input.loadedRootCount < input.total && input.visible < input.total

export function visibleSessionDirectories(input: {
  project?: { worktree: string }
  currentDirectory?: string
  workspacesEnabled: boolean
  workspaces: string[]
  expanded?: Record<string, boolean | undefined>
}) {
  if (!input.project) return [] as string[]
  if (!input.workspacesEnabled) return [input.currentDirectory || input.project.worktree]

  const active = input.currentDirectory ? workspaceKey(input.currentDirectory) : undefined
  const local = workspaceKey(input.project.worktree)
  return input.workspaces.filter((directory) => {
    const key = workspaceKey(directory)
    const expanded = input.expanded?.[directory] ?? input.expanded?.[key] ?? key === local
    return expanded || key === active
  })
}

export const latestRootSession = (stores: SessionStore[], now: number) =>
  stores.flatMap((store) => roots(store)).sort(sortSessions(now))[0]

export function hasProjectPermissions<T>(
  request: Record<string, T[] | undefined> | undefined,
  include: (item: T) => boolean = () => true,
) {
  return Object.values(request ?? {}).some((list) => list?.some(include))
}

export const childSessionOnPath = (sessions: Session[] | undefined, rootID: string, activeID?: string) => {
  if (!activeID || activeID === rootID) return
  const map = new Map((sessions ?? []).map((session) => [session.id, session]))
  let id = activeID

  while (id) {
    const session = map.get(id)
    if (!session?.parentID) return
    if (session.parentID === rootID) return session
    id = session.parentID
  }
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree)

export const errorMessage = (err: unknown, fallback: string) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export const effectiveWorkspaceOrder = (local: string, dirs: string[], persisted?: string[]) => {
  const root = workspaceKey(local)
  const live = new Map<string, string>()

  for (const dir of dirs) {
    const key = workspaceKey(dir)
    if (key === root) continue
    if (!live.has(key)) live.set(key, dir)
  }

  if (!persisted?.length) return [local, ...live.values()]

  const result = [local]
  for (const dir of persisted) {
    const key = workspaceKey(dir)
    if (key === root) continue
    const match = live.get(key)
    if (!match) continue
    result.push(match)
    live.delete(key)
  }

  return [...result, ...live.values()]
}
