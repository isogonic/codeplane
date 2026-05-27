import type { EventAugmented, GlobalEvent } from "@/tui/_compat/sdk-v2"

export const TUI_EVENT_FLUSH_MS = 16
export const TUI_STREAM_DELTA_FLUSH_MS = 16
export const ACTIVE_SESSION_POLL_INTERVAL_MS = 10_000
export const ACTIVE_SESSION_STALE_MS = 7_500

export type PartDeltaGlobalEvent = GlobalEvent & {
  payload: {
    type: "message.part.delta"
    properties: {
      messageID: string
      partID: string
      field: string
      delta: string
    }
  }
}

export type TuiStreamDeltaGlobalEvent = GlobalEvent & {
  payload: {
    type: string
    properties: Record<string, unknown>
  }
}

type DeltaField = "delta" | "text"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringValue(properties: Record<string, unknown>, key: string) {
  const value = properties[key]
  return typeof value === "string" ? value : undefined
}

function payloadProperties(event: GlobalEvent) {
  const properties = (event.payload as { properties?: unknown }).properties
  return isRecord(properties) ? properties : undefined
}

export function isHeartbeatEvent(event: GlobalEvent) {
  return event.payload.type === "server.heartbeat"
}

export function isPartDeltaEvent(event: GlobalEvent): event is PartDeltaGlobalEvent {
  if (event.payload.type !== "message.part.delta") return false
  const properties = event.payload.properties
  if (!isRecord(properties)) return false
  return (
    typeof properties.messageID === "string" &&
    typeof properties.partID === "string" &&
    typeof properties.field === "string" &&
    typeof properties.delta === "string"
  )
}

function streamDeltaInfo(event: GlobalEvent): { key: string; field: DeltaField; value: string } | undefined {
  const properties = payloadProperties(event)
  if (!properties) return undefined

  switch (event.payload.type as string) {
    case "message.part.delta": {
      const messageID = stringValue(properties, "messageID")
      const partID = stringValue(properties, "partID")
      const field = stringValue(properties, "field")
      const delta = stringValue(properties, "delta")
      if (!messageID || !partID || !field || delta === undefined) return undefined
      return {
        key: `message.part.delta\0${messageID}\0${partID}\0${field}`,
        field: "delta",
        value: delta,
      }
    }
    case "session.next.text.delta": {
      const sessionID = stringValue(properties, "sessionID")
      const delta = stringValue(properties, "delta")
      if (!sessionID || delta === undefined) return undefined
      return {
        key: `session.next.text.delta\0${sessionID}`,
        field: "delta",
        value: delta,
      }
    }
    case "session.next.tool.input.delta": {
      const sessionID = stringValue(properties, "sessionID")
      const callID = stringValue(properties, "callID")
      const delta = stringValue(properties, "delta")
      if (!sessionID || !callID || delta === undefined) return undefined
      return {
        key: `session.next.tool.input.delta\0${sessionID}\0${callID}`,
        field: "delta",
        value: delta,
      }
    }
    case "session.next.reasoning.delta": {
      const sessionID = stringValue(properties, "sessionID")
      const reasoningID = stringValue(properties, "reasoningID")
      const delta = stringValue(properties, "delta")
      if (!sessionID || !reasoningID || delta === undefined) return undefined
      return {
        key: `session.next.reasoning.delta\0${sessionID}\0${reasoningID}`,
        field: "delta",
        value: delta,
      }
    }
    case "session.next.compaction.delta": {
      const sessionID = stringValue(properties, "sessionID")
      const text = stringValue(properties, "text")
      if (!sessionID || text === undefined) return undefined
      return {
        key: `session.next.compaction.delta\0${sessionID}`,
        field: "text",
        value: text,
      }
    }
  }

  return undefined
}

export function isTuiStreamDeltaEvent(event: GlobalEvent): event is TuiStreamDeltaGlobalEvent {
  return streamDeltaInfo(event) !== undefined
}

function cloneStreamDelta(event: GlobalEvent, field: DeltaField, value: string): GlobalEvent {
  return {
    ...event,
    payload: {
      ...event.payload,
      properties: {
        ...payloadProperties(event),
        [field]: value,
      },
    },
  } as GlobalEvent
}

export function compactTuiEventsForFlush(events: readonly GlobalEvent[]): GlobalEvent[] {
  const compacted: GlobalEvent[] = []
  const pending = new Map<string, { field: DeltaField; value: string; event: TuiStreamDeltaGlobalEvent }>()
  const order: string[] = []

  const flushPending = () => {
    for (const key of order) {
      const event = pending.get(key)
      if (event) compacted.push(event.event)
    }
    pending.clear()
    order.length = 0
  }

  for (const event of events) {
    const info = streamDeltaInfo(event)
    if (!info) {
      flushPending()
      compacted.push(event)
      continue
    }

    const existing = pending.get(info.key)
    if (!existing) {
      pending.set(info.key, {
        field: info.field,
        value: info.value,
        event: cloneStreamDelta(event, info.field, info.value) as TuiStreamDeltaGlobalEvent,
      })
      order.push(info.key)
      continue
    }

    const value = existing.value + info.value
    pending.set(info.key, {
      field: info.field,
      value,
      event: cloneStreamDelta(existing.event, info.field, value) as TuiStreamDeltaGlobalEvent,
    })
  }

  flushPending()
  return compacted
}

export function tuiEventFlushDelay(event: GlobalEvent, elapsedMs: number) {
  const target = isTuiStreamDeltaEvent(event) ? TUI_STREAM_DELTA_FLUSH_MS : TUI_EVENT_FLUSH_MS
  return Math.max(0, target - elapsedMs)
}

export function eventSessionID(event: EventAugmented | GlobalEvent): string | undefined {
  const properties = (event as { properties?: unknown }).properties
  if (isRecord(properties) && typeof properties.sessionID === "string") return properties.sessionID

  const payload = (event as { payload?: { properties?: unknown } }).payload
  if (!payload) return undefined

  const payloadProperties = payload.properties
  if (!isRecord(payloadProperties)) return undefined
  return typeof payloadProperties.sessionID === "string" ? payloadProperties.sessionID : undefined
}

export function shouldPollActiveSession(input: { now: number; lastLiveEventAt: number }) {
  if (input.lastLiveEventAt === 0) return true
  return input.now - input.lastLiveEventAt >= ACTIVE_SESSION_STALE_MS
}
