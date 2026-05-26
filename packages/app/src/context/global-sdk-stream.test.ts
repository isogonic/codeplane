import { describe, expect, test } from "bun:test"
import type { Event, Part } from "@codeplane-ai/sdk/v2/client"
import {
  compactGlobalSdkEventsForFlush,
  globalSdkCoalesceKey,
  isHeartbeatEvent,
  type GlobalSdkQueuedEvent,
} from "./global-sdk-stream"

function messagePartDeltaEvent(input: {
  directory: string
  sessionID?: string
  messageID: string
  partID: string
  field?: string
  delta: string
}): GlobalSdkQueuedEvent {
  const payload = {
    type: "message.part.delta",
    properties: {
      sessionID: input.sessionID ?? "ses_1",
      messageID: input.messageID,
      partID: input.partID,
      field: input.field ?? "text",
      delta: input.delta,
    },
  } satisfies Event
  return {
    directory: input.directory,
    payload,
  }
}

function messagePartUpdatedEvent(input: {
  directory: string
  part: {
    id: string
    messageID: string
  }
}): GlobalSdkQueuedEvent {
  const part = {
    id: input.part.id,
    sessionID: "ses_1",
    messageID: input.part.messageID,
    type: "text",
    text: input.part.id,
  } satisfies Part
  const payload = {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_1",
      part,
      time: 1,
    },
  } satisfies Event
  return {
    directory: input.directory,
    payload,
  }
}

function sessionStatusEvent(): GlobalSdkQueuedEvent {
  const payload = {
    type: "session.status",
    properties: {
      sessionID: "ses_1",
      status: { type: "busy" as const },
    },
  } satisfies Event
  return {
    directory: "project",
    payload,
  }
}

function stringProperty(event: GlobalSdkQueuedEvent, key: string) {
  const properties = event.payload.properties
  if (!properties || typeof properties !== "object") return undefined
  const value = (properties as Record<string, unknown>)[key]
  if (typeof value !== "string") return undefined
  return value
}

describe("isHeartbeatEvent", () => {
  test("filters server heartbeats from the app event stream", () => {
    expect(
      isHeartbeatEvent({
        payload: {
          type: "server.heartbeat",
        },
      }),
    ).toBe(true)
    expect(
      isHeartbeatEvent({
        payload: {
          type: "message.part.delta",
        },
      }),
    ).toBe(false)
  })
})

describe("globalSdkCoalesceKey", () => {
  test("coalesces session status and lsp updates but keeps part refreshes ordered", () => {
    expect(globalSdkCoalesceKey("project", sessionStatusEvent().payload)).toBe("session.status:project:ses_1")
    expect(
      globalSdkCoalesceKey("project", {
        type: "lsp.updated",
        properties: {},
      } as Event),
    ).toBe("lsp.updated:project")
    expect(globalSdkCoalesceKey("project", messagePartUpdatedEvent({ directory: "project", part: { id: "part_1", messageID: "msg_1" } }).payload)).toBeUndefined()
  })
})

describe("compactGlobalSdkEventsForFlush", () => {
  test("compacts consecutive token deltas for the same part and field", () => {
    const events = compactGlobalSdkEventsForFlush([
      messagePartDeltaEvent({
        directory: "project",
        messageID: "msg_1",
        partID: "part_1",
        delta: "Hel",
      }),
      messagePartDeltaEvent({
        directory: "project",
        messageID: "msg_1",
        partID: "part_1",
        delta: "lo",
      }),
    ])

    expect(events).toHaveLength(1)
    expect(events[0].payload.type).toBe("message.part.delta")
    expect(stringProperty(events[0], "delta")).toBe("Hello")
  })

  test("keeps barrier events in order and only compacts deltas within each stream window", () => {
    const events = compactGlobalSdkEventsForFlush([
      messagePartDeltaEvent({
        directory: "project",
        messageID: "msg_1",
        partID: "part_1",
        delta: "Hel",
      }),
      sessionStatusEvent(),
      messagePartDeltaEvent({
        directory: "project",
        messageID: "msg_1",
        partID: "part_1",
        delta: "lo",
      }),
    ])

    expect(events.map((event) => event.payload.type)).toEqual([
      "message.part.delta",
      "session.status",
      "message.part.delta",
    ])
    expect(stringProperty(events[0], "delta")).toBe("Hel")
    expect(stringProperty(events[2], "delta")).toBe("lo")
  })

  test("does not compact across directories or fields", () => {
    const events = compactGlobalSdkEventsForFlush([
      messagePartDeltaEvent({
        directory: "project-a",
        messageID: "msg_1",
        partID: "part_1",
        field: "text",
        delta: "A",
      }),
      messagePartDeltaEvent({
        directory: "project-b",
        messageID: "msg_1",
        partID: "part_1",
        field: "text",
        delta: "B",
      }),
      messagePartDeltaEvent({
        directory: "project-a",
        messageID: "msg_1",
        partID: "part_1",
        field: "reasoning",
        delta: "plan",
      }),
    ])

    expect(events).toHaveLength(3)
    expect(events.map((event) => event.directory)).toEqual(["project-a", "project-b", "project-a"])
    expect(events.map((event) => stringProperty(event, "field"))).toEqual(["text", "text", "reasoning"])
  })

  test("drops stale deltas before a part update but keeps later deltas after the update", () => {
    const events = compactGlobalSdkEventsForFlush([
      messagePartDeltaEvent({
        directory: "project",
        messageID: "msg_1",
        partID: "part_1",
        delta: "Hel",
      }),
      messagePartDeltaEvent({
        directory: "project",
        messageID: "msg_1",
        partID: "part_2",
        delta: "A",
      }),
      messagePartUpdatedEvent({
        directory: "project",
        part: {
          id: "part_1",
          messageID: "msg_1",
        },
      }),
      messagePartDeltaEvent({
        directory: "project",
        messageID: "msg_1",
        partID: "part_1",
        delta: " world",
      }),
    ])

    expect(events.map((event) => event.payload.type)).toEqual([
      "message.part.delta",
      "message.part.updated",
      "message.part.delta",
    ])
    expect(stringProperty(events[0], "partID")).toBe("part_2")
    expect(stringProperty(events[0], "delta")).toBe("A")
    expect(stringProperty(events[2], "partID")).toBe("part_1")
    expect(stringProperty(events[2], "delta")).toBe(" world")
  })

  test("drops every pending field delta for a part when a full part update arrives", () => {
    const events = compactGlobalSdkEventsForFlush([
      messagePartDeltaEvent({
        directory: "project",
        messageID: "msg_1",
        partID: "part_1",
        field: "text",
        delta: "Hel",
      }),
      messagePartDeltaEvent({
        directory: "project",
        messageID: "msg_1",
        partID: "part_1",
        field: "reasoning",
        delta: "plan",
      }),
      messagePartUpdatedEvent({
        directory: "project",
        part: {
          id: "part_1",
          messageID: "msg_1",
        },
      }),
    ])

    expect(events.map((event) => event.payload.type)).toEqual(["message.part.updated"])
  })

  test("keeps repeated full part updates in order so later refreshes can replace older stream state", () => {
    const events = compactGlobalSdkEventsForFlush([
      messagePartUpdatedEvent({
        directory: "project",
        part: {
          id: "part_1",
          messageID: "msg_1",
        },
      }),
      messagePartDeltaEvent({
        directory: "project",
        messageID: "msg_1",
        partID: "part_1",
        delta: " stale",
      }),
      messagePartUpdatedEvent({
        directory: "project",
        part: {
          id: "part_1",
          messageID: "msg_1",
        },
      }),
    ])

    expect(events.map((event) => event.payload.type)).toEqual([
      "message.part.updated",
      "message.part.updated",
    ])
  })
})
