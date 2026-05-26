import type { Session } from "@codeplane-ai/sdk/v2/client"
import type { State } from "./types"
import { directoryContains, directoryKey } from "./utils"

type EventLike = {
  type: string
  properties?: unknown
}

type SessionIdentity = Pick<Session, "id" | "directory"> & { projectID?: string }
type StoreLike = {
  project: State["project"]
  session: SessionIdentity[]
}

const routeBySessionID = new Set([
  "message.part.delta",
  "message.part.removed",
  "message.part.updated",
  "message.removed",
  "message.updated",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.rejected",
  "question.replied",
  "session.diff",
  "session.status",
  "todo.updated",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function eventSessionInfo(event: EventLike): SessionIdentity | undefined {
  if (!isRecord(event.properties)) return undefined
  if (!isRecord(event.properties.info)) return undefined
  if (typeof event.properties.info.id !== "string") return undefined
  if (typeof event.properties.info.directory !== "string") return undefined
  return {
    id: event.properties.info.id,
    directory: event.properties.info.directory,
    projectID: typeof event.properties.info.projectID === "string" ? event.properties.info.projectID : undefined,
  }
}

function eventSessionID(event: EventLike): string | undefined {
  if (!isRecord(event.properties)) return undefined
  if (typeof event.properties.sessionID === "string") return event.properties.sessionID
  if (isRecord(event.properties.info)) {
    if (typeof event.properties.info.sessionID === "string") return event.properties.info.sessionID
    if (typeof event.properties.info.directory === "string" && typeof event.properties.info.id === "string") {
      return event.properties.info.id
    }
  }
  if (isRecord(event.properties.part) && typeof event.properties.part.sessionID === "string") {
    return event.properties.part.sessionID
  }
  return undefined
}

function projectMatches(store: StoreLike, info?: { projectID?: string }) {
  if (!info?.projectID) return true
  if (!store.project) return false
  return store.project === info.projectID
}

function pushUnique(list: string[], directory: string) {
  const key = directoryKey(directory)
  if (list.some((item) => directoryKey(item) === key)) return
  list.push(directory)
}

export function globalEventTargetDirectories(input: {
  source: string
  event: EventLike
  stores: Array<{ directory: string; store: StoreLike }>
}) {
  const info = eventSessionInfo(input.event)
  const sessionID = routeBySessionID.has(input.event.type) ? eventSessionID(input.event) : undefined
  const result: string[] = []
  const sourceKey = directoryKey(input.source)

  input.stores.forEach((item) => {
    const knownSession = sessionID ? item.store.session.find((session) => session.id === sessionID) : undefined
    if (directoryKey(item.directory) === sourceKey) {
      pushUnique(result, item.directory)
      return
    }
    if (info && directoryContains(item.directory, info.directory)) {
      if (!projectMatches(item.store, info)) return
      pushUnique(result, item.directory)
      return
    }
    if (knownSession) {
      if (!projectMatches(item.store, knownSession)) return
      pushUnique(result, item.directory)
    }
  })

  return result
}
