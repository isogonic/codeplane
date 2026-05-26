import type { FollowupDraft } from "@/components/prompt-input/submit"

export type FollowupItem = FollowupDraft & { id: string }

export type FollowupSession = {
  id: string
  parentID?: string
  time: {
    archived?: number
  }
  cronRunID?: string
}

export function nextRunnableFollowup(input: {
  items: Record<string, FollowupItem[] | undefined>
  failed: Record<string, string | undefined>
  paused: Record<string, boolean | undefined>
  sending: boolean
  session: (sessionID: string, item: FollowupItem) => FollowupSession | undefined
  busy: (sessionID: string, item: FollowupItem) => boolean
  blocked: (sessionID: string, item: FollowupItem) => boolean
}) {
  if (input.sending) return

  return Object.entries(input.items)
    .flatMap(([sessionID, items]) => {
      const item = items?.[0]
      return item ? [{ sessionID, item }] : []
    })
    .sort((a, b) => a.item.id.localeCompare(b.item.id))
    .find(({ sessionID, item }) => {
      const session = input.session(sessionID, item)
      if (session?.parentID) return false
      if (session?.time.archived !== undefined) return false
      if (session?.cronRunID) return false
      if (input.failed[sessionID] === item.id) return false
      if (input.paused[sessionID]) return false
      if (input.busy(sessionID, item)) return false
      if (input.blocked(sessionID, item)) return false
      return true
    })
}
