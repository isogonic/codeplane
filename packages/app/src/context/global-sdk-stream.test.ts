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

  test("preserves deltas before a part update so the reducer can drain them safely", () => {
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
      "message.part.delta",
      "message.part.updated",
      "message.part.delta",
    ])
    expect(stringProperty(events[0], "partID")).toBe("part_1")
    expect(stringProperty(events[0], "delta")).toBe("Hel")
    expect(stringProperty(events[1], "partID")).toBe("part_2")
    expect(stringProperty(events[1], "delta")).toBe("A")
    expect(stringProperty(events[3], "delta")).toBe(" world")
  })

  test("keeps every pending field delta before a full part update", () => {
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

    expect(events.map((event) => event.payload.type)).toEqual([
      "message.part.delta",
      "message.part.delta",
      "message.part.updated",
    ])
  })

  test("heavy mixed stream: many deltas across parts + fields, barriers preserved, total content intact", () => {
    // Simulates a realistic burst from a long streaming turn:
    //   - text deltas for two different parts
    //   - reasoning deltas for one of them
    //   - a session.status barrier mid-burst (must split the merge window)
    //   - a final message.part.updated for one part (must NOT drop preceding deltas)
    const events: GlobalSdkQueuedEvent[] = []
    const expectedTextPart1 = "Hello world from streaming!"
    const expectedTextPart2 = "Second part content here."
    const expectedReasoning = "Thinking step one. Thinking step two."

    for (const ch of "Hello ") {
      events.push(messagePartDeltaEvent({ directory: "p", messageID: "m1", partID: "part_1", delta: ch }))
    }
    for (const ch of "Second") {
      events.push(messagePartDeltaEvent({ directory: "p", messageID: "m1", partID: "part_2", delta: ch }))
    }
    for (const ch of "Thinking step one. ") {
      events.push(
        messagePartDeltaEvent({
          directory: "p",
          messageID: "m1",
          partID: "part_1",
          field: "reasoning",
          delta: ch,
        }),
      )
    }
    events.push(sessionStatusEvent())
    for (const ch of "world from streaming!") {
      events.push(messagePartDeltaEvent({ directory: "p", messageID: "m1", partID: "part_1", delta: ch }))
    }
    for (const ch of " part content here.") {
      events.push(messagePartDeltaEvent({ directory: "p", messageID: "m1", partID: "part_2", delta: ch }))
    }
    for (const ch of "Thinking step two.") {
      events.push(
        messagePartDeltaEvent({
          directory: "p",
          messageID: "m1",
          partID: "part_1",
          field: "reasoning",
          delta: ch,
        }),
      )
    }
    events.push(
      messagePartUpdatedEvent({
        directory: "p",
        part: { id: "part_1", messageID: "m1" },
      }),
    )

    const out = compactGlobalSdkEventsForFlush(events)

    // Reconstruct the resulting deltas — per (partID, field), in order.
    const buckets = new Map<string, string>()
    let sawBarrier = false
    let sawPartUpdated = false
    for (const event of out) {
      if (event.payload.type === "session.status") {
        sawBarrier = true
        continue
      }
      if (event.payload.type === "message.part.updated") {
        sawPartUpdated = true
        continue
      }
      if (event.payload.type !== "message.part.delta") continue
      const partID = stringProperty(event, "partID")!
      const field = stringProperty(event, "field")!
      const delta = stringProperty(event, "delta")!
      const key = `${partID}:${field}`
      buckets.set(key, (buckets.get(key) ?? "") + delta)
    }

    expect(sawBarrier).toBe(true)
    expect(sawPartUpdated).toBe(true)
    // No characters lost across the burst.
    expect(buckets.get("part_1:text")).toBe(expectedTextPart1)
    expect(buckets.get("part_2:text")).toBe(expectedTextPart2)
    expect(buckets.get("part_1:reasoning")).toBe(expectedReasoning)
    // Barrier split the merge window — `part_1:text` ends up as TWO
    // compacted delta events (before + after the barrier), not one.
    const part1TextDeltas = out.filter(
      (e) => e.payload.type === "message.part.delta" && stringProperty(e, "partID") === "part_1" && stringProperty(e, "field") === "text",
    )
    expect(part1TextDeltas.length).toBe(2)
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
      "message.part.delta",
      "message.part.updated",
    ])
  })
})
