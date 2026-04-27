import type { Session } from "@codeplane-ai/sdk/v2"

export const SESSION_INDEX_LIMIT = 1000
export const SESSION_SEARCH_LIMIT = 100

export const sessionIndexQuery = () => ({
  roots: true as const,
  archived: false as const,
  limit: SESSION_INDEX_LIMIT,
})

export const sortSessionIndex = (sessions: Session[] | undefined) =>
  (sessions ?? [])
    .filter((session): session is Session => !!session?.id)
    .toSorted((a, b) => a.id.localeCompare(b.id))

export function loadSessionIndex(client: {
  session: { list: (query: ReturnType<typeof sessionIndexQuery>) => Promise<{ data?: Session[] }> }
}) {
  return client.session.list(sessionIndexQuery()).then((x) => sortSessionIndex(x.data))
}
