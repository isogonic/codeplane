import { getFilename } from "@codeplane-ai/shared/util/path"
import { type Session } from "@codeplane-ai/sdk/v2/client"
import { directoryContains, directoryKey } from "@/context/global-sync/utils"
import { isCronSessionInfo } from "./sidebar-cron-helpers"

type SessionStore = {
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

const isRootVisibleSession = (session: Session, directories: string[]) =>
  directories.some((directory) => sessionInDirectory(session, directory)) &&
  !session.parentID &&
  !session.time?.archived &&
  !isCronSessionInfo(session as Session & { cronRunID?: string })

export const roots = (store: SessionStore, directory?: string) => {
  const directories = [directory, store.path.directory]
    .filter((value): value is string => !!value)
    .filter((value, index, list) => list.findIndex((item) => directoryKey(item) === directoryKey(value)) === index)
  return (store.session ?? []).filter((session) => isRootVisibleSession(session, directories))
}

export const sortedRootSessions = (store: SessionStore, now: number, directory?: string) =>
  roots(store, directory).sort(sortSessions(now))

export const childSessions = (sessions: Session[] | undefined, parentID: string, now: number) =>
  (sessions ?? [])
    .filter((session) => session.parentID === parentID && !session.time?.archived)
    .sort(sortSessions(now))

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
