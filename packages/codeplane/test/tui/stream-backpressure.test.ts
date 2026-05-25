import { describe, expect, test } from "bun:test"
import type { EventAugmented, GlobalEvent } from "../../src/tui/_compat/sdk-v2"
import {
  ACTIVE_SESSION_STALE_MS,
  TUI_EVENT_FLUSH_MS,
  TUI_STREAM_DELTA_FLUSH_MS,
  compactTuiEventsForFlush,
  eventSessionID,
  isHeartbeatEvent,
  isPartDeltaEvent,
  isTuiStreamDeltaEvent,
  type PartDeltaGlobalEvent,
  shouldPollActiveSession,
  tuiEventFlushDelay,
} from "../../src/tui/util/stream-backpressure"

const delta = (input: { messageID?: string; partID?: string; field?: string; delta: string }) =>
  ({
    directory: "/tmp/project",
    payload: {
      type: "message.part.delta",
      properties: {
        sessionID: "ses_1",
        messageID: input.messageID ?? "msg_1",
        partID: input.partID ?? "prt_1",
        field: input.field ?? "text",
        delta: input.delta,
      },
    },
  }) satisfies PartDeltaGlobalEvent

const control = () =>
  ({
    directory: "global",
    payload: {
      type: "server.dropped",
      properties: {},
    },
  }) satisfies GlobalEvent

const nextDelta = (input: {
  type:
    | "session.next.text.delta"
    | "session.next.tool.input.delta"
    | "session.next.reasoning.delta"
    | "session.next.compaction.delta"
  sessionID?: string
  callID?: string
  reasoningID?: string
  delta?: string
  text?: string
}) =>
  ({
    directory: "/tmp/project",
    payload: {
      type: input.type,
      properties: {
        timestamp: 1,
        sessionID: input.sessionID ?? "ses_1",
        callID: input.callID,
        reasoningID: input.reasoningID,
        delta: input.delta,
        text: input.text,
      },
    },
  }) as GlobalEvent

const deltaProperties = (event: GlobalEvent | undefined) => (event && isPartDeltaEvent(event) ? event.payload.properties : undefined)

const eventProperties = (event: GlobalEvent | undefined) =>
  (event?.payload as { properties?: unknown } | undefined)?.properties as Record<string, unknown> | undefined

describe("tui stream backpressure", () => {
  test("compacts token deltas for the same part before emitting to Solid", () => {
    const result = compactTuiEventsForFlush([delta({ delta: "hel" }), delta({ delta: "lo" })])
    expect(result).toHaveLength(1)
    expect(deltaProperties(result[0])).toMatchObject({ delta: "hello" })
  })

  test("preserves non-delta event boundaries while compacting", () => {
    const result = compactTuiEventsForFlush([
      delta({ delta: "a" }),
      delta({ delta: "b" }),
      control(),
      delta({ delta: "c" }),
    ])

    expect(result.map((event) => String(event.payload.type))).toEqual([
      "message.part.delta",
      "server.dropped",
      "message.part.delta",
    ])
    expect(deltaProperties(result[0])).toMatchObject({ delta: "ab" })
    expect(deltaProperties(result[2])).toMatchObject({ delta: "c" })
  })

  test("keeps independent part delta streams separate", () => {
    const result = compactTuiEventsForFlush([
      delta({ partID: "a", delta: "a1" }),
      delta({ partID: "b", delta: "b1" }),
      delta({ partID: "a", delta: "a2" }),
    ])

    expect(result).toHaveLength(2)
    expect(deltaProperties(result[0])).toMatchObject({ partID: "a", delta: "a1a2" })
    expect(deltaProperties(result[1])).toMatchObject({ partID: "b", delta: "b1" })
  })

  test("compacts next stream deltas for command input and reasoning", () => {
    const result = compactTuiEventsForFlush([
      nextDelta({ type: "session.next.tool.input.delta", callID: "call_a", delta: "ls" }),
      nextDelta({ type: "session.next.reasoning.delta", reasoningID: "rsn_a", delta: "thi" }),
      nextDelta({ type: "session.next.tool.input.delta", callID: "call_a", delta: " -la" }),
      nextDelta({ type: "session.next.reasoning.delta", reasoningID: "rsn_b", delta: "other" }),
      nextDelta({ type: "session.next.reasoning.delta", reasoningID: "rsn_a", delta: "nk" }),
      nextDelta({ type: "session.next.compaction.delta", text: "sum" }),
      nextDelta({ type: "session.next.compaction.delta", text: "mary" }),
    ])

    expect(result.map((event) => String(event.payload.type))).toEqual([
      "session.next.tool.input.delta",
      "session.next.reasoning.delta",
      "session.next.reasoning.delta",
      "session.next.compaction.delta",
    ])
    expect(eventProperties(result[0])).toMatchObject({ callID: "call_a", delta: "ls -la" })
    expect(eventProperties(result[1])).toMatchObject({ reasoningID: "rsn_a", delta: "think" })
    expect(eventProperties(result[2])).toMatchObject({ reasoningID: "rsn_b", delta: "other" })
    expect(eventProperties(result[3])).toMatchObject({ text: "summary" })
  })

  test("uses a slower flush cadence for stream deltas than control events", () => {
    expect(tuiEventFlushDelay(delta({ delta: "x" }), 0)).toBe(TUI_STREAM_DELTA_FLUSH_MS)
    expect(tuiEventFlushDelay(nextDelta({ type: "session.next.tool.input.delta", callID: "call_a", delta: "x" }), 0)).toBe(
      TUI_STREAM_DELTA_FLUSH_MS,
    )
    expect(tuiEventFlushDelay(control(), 0)).toBe(TUI_EVENT_FLUSH_MS)
    expect(tuiEventFlushDelay(delta({ delta: "x" }), TUI_STREAM_DELTA_FLUSH_MS + 1)).toBe(0)
  })

  test("identifies all TUI stream delta event shapes", () => {
    expect(isTuiStreamDeltaEvent(delta({ delta: "x" }))).toBe(true)
    expect(isTuiStreamDeltaEvent(nextDelta({ type: "session.next.text.delta", delta: "x" }))).toBe(true)
    expect(isTuiStreamDeltaEvent(control())).toBe(false)
  })

  test("identifies heartbeat events as renderer noise", () => {
    expect(
      isHeartbeatEvent({
        directory: "global",
        payload: { type: "server.heartbeat", properties: {} },
      } as GlobalEvent),
    ).toBe(true)
  })

  test("session poller backs off while live events are fresh", () => {
    expect(shouldPollActiveSession({ now: 100, lastLiveEventAt: 0 })).toBe(true)
    expect(shouldPollActiveSession({ now: 1000, lastLiveEventAt: 900 })).toBe(false)
    expect(shouldPollActiveSession({ now: 1000 + ACTIVE_SESSION_STALE_MS, lastLiveEventAt: 1000 })).toBe(true)
  })

  test("extracts session ids from event payloads", () => {
    const sessionEvent = {
      id: "evt_1",
      type: "message.part.delta",
      properties: {
        sessionID: "ses_1",
        messageID: "msg_1",
        partID: "prt_1",
        field: "text",
        delta: "x",
      },
    } satisfies EventAugmented
    const connectedEvent = {
      id: "evt_2",
      type: "server.connected",
      properties: {},
    } satisfies EventAugmented

    expect(eventSessionID(sessionEvent)).toBe("ses_1")
    expect(eventSessionID(delta({ delta: "x" }))).toBe("ses_1")
    expect(eventSessionID(connectedEvent)).toBeUndefined()
  })
})
