import type { Event } from "@codeplane-ai/sdk/v2/client"

export type GlobalSdkQueuedEvent = {
  directory: string
  payload: Event
}

type PartDeltaEvent = GlobalSdkQueuedEvent & {
  payload: {
    type: "message.part.delta"
    properties: {
      sessionID: string
      messageID: string
      partID: string
      field: string
      delta: string
    }
  }
}

type PendingDelta = {
  deltaKey: string
  partKey: string
  value: string
  event: PartDeltaEvent
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringValue(properties: Record<string, unknown>, key: string) {
  const value = properties[key]
  return typeof value === "string" ? value : undefined
}

export function isHeartbeatEvent(event: { payload: { type: string } }) {
  return event.payload.type === "server.heartbeat"
}

export function isGlobalSdkEvent(payload: { type: string }): payload is Event {
  return payload.type !== "sync" && payload.type !== "server.heartbeat"
}

export function globalSdkCoalesceKey(directory: string, payload: Event): string | undefined {
  if (payload.type === "session.status") return `session.status:${directory}:${payload.properties.sessionID}`
  if (payload.type === "lsp.updated") return `lsp.updated:${directory}`
  return undefined
}

export function messagePartIdentityKey(input: { directory: string; messageID: string; partID: string }) {
  return `${input.directory}\0${input.messageID}\0${input.partID}`
}

function messagePartDeltaInfo(event: GlobalSdkQueuedEvent): PendingDelta | undefined {
  if (event.payload.type !== "message.part.delta") return undefined
  const properties = event.payload.properties
  if (!isRecord(properties)) return undefined

  const sessionID = stringValue(properties, "sessionID")
  const messageID = stringValue(properties, "messageID")
  const partID = stringValue(properties, "partID")
  const field = stringValue(properties, "field")
  const delta = stringValue(properties, "delta")
  if (!sessionID || !messageID || !partID || !field || delta === undefined) return undefined

  const partKey = messagePartIdentityKey({
    directory: event.directory,
    messageID,
    partID,
  })
  return {
    deltaKey: `${partKey}\0${field}`,
    partKey,
    value: delta,
    event: {
      directory: event.directory,
      payload: {
        type: "message.part.delta",
        properties: {
          sessionID,
          messageID,
          partID,
          field,
          delta,
        },
      },
    },
  }
}

function clonePartDeltaEvent(event: PartDeltaEvent, delta: string): PartDeltaEvent {
  return {
    ...event,
    payload: {
      ...event.payload,
      properties: {
        ...event.payload.properties,
        delta,
      },
    },
  }
}

export function compactGlobalSdkEventsForFlush(events: readonly GlobalSdkQueuedEvent[]): GlobalSdkQueuedEvent[] {
  const compacted: GlobalSdkQueuedEvent[] = []
  const pending = new Map<string, PendingDelta>()
  const order: string[] = []

  const flushPending = () => {
    for (const deltaKey of order) {
      const item = pending.get(deltaKey)
      if (!item) continue
      compacted.push(item.event)
    }
    pending.clear()
    order.length = 0
  }

  for (const event of events) {
    const delta = messagePartDeltaInfo(event)
    if (delta) {
      const existing = pending.get(delta.deltaKey)
      if (existing) {
        const value = existing.value + delta.value
        pending.set(delta.deltaKey, {
          ...existing,
          value,
          event: clonePartDeltaEvent(existing.event, value),
        })
        continue
      }

      pending.set(delta.deltaKey, delta)
      order.push(delta.deltaKey)
      continue
    }

    flushPending()
    compacted.push(event)
  }

  flushPending()
  return compacted
}
