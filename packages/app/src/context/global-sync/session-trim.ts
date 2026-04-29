import type { PermissionRequest, Session } from "@codeplane-ai/sdk/v2/client"
import { cmp } from "./utils"
import { SESSION_RECENT_LIMIT, SESSION_RECENT_WINDOW } from "./types"

export function sessionUpdatedAt(session: Session) {
  return session.time.updated ?? session.time.created
}

export function compareSessionRecent(a: Session, b: Session) {
  const aUpdated = sessionUpdatedAt(a)
  const bUpdated = sessionUpdatedAt(b)
  if (aUpdated !== bUpdated) return bUpdated - aUpdated
  return cmp(a.id, b.id)
}

export function trimSessions(
  input: Session[],
  options: {
    limit: number
    permission: Record<string, PermissionRequest[]>
    now?: number
    preserve?: Iterable<string>
  },
) {
  const limit = Math.max(0, options.limit)
  const cutoff = (options.now ?? Date.now()) - SESSION_RECENT_WINDOW
  const preserve = new Set(options.preserve ?? [])
  // Dedup by id up front. Callers concatenate sessions from several sources
  // (rootSessions / existing childSessions / freshly loaded children /
  // preservedSessions) and only dedup some of those pairwise, so the same
  // session id can appear multiple times in `input` — without this the
  // sidebar's child list rendered each subsession duplicated 2-8x.
  const seen = new Set<string>()
  const all = input
    .filter((s): s is Session => !!s?.id)
    .filter((s) => {
      if (seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })
    .filter((s) => !s.time?.archived || preserve.has(s.id))
  const roots = all
    .filter((s) => !s.parentID)
    .filter((s) => !s.time?.archived)
    .sort(compareSessionRecent)
  const children = all.filter((s) => !!s.parentID)
  const keepRoots = roots
    .slice(0, limit + SESSION_RECENT_LIMIT)
    .concat(all.filter((s) => !s.parentID && preserve.has(s.id)))
    .filter((session, index, list) => list.findIndex((item) => item.id === session.id) === index)
  const keepRootIds = new Set(keepRoots.map((s) => s.id))
  const keepChildren = children.filter((s) => {
    if (preserve.has(s.id)) return true
    if (s.time?.archived) return false
    if (s.parentID && keepRootIds.has(s.parentID)) return true
    const perms = options.permission[s.id] ?? []
    if (perms.length > 0) return true
    return sessionUpdatedAt(s) > cutoff
  })
  return [...keepRoots, ...keepChildren].sort((a, b) => cmp(a.id, b.id))
}
