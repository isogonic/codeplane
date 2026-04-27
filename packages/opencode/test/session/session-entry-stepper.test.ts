import { describe, expect, test } from "bun:test"
import * as DateTime from "effect/DateTime"
import { SessionID } from "../../src/session/schema"
import { SessionEntry } from "../../src/v2/session-entry"
import { SessionEntryStepper } from "../../src/v2/session-entry-stepper"
import { SessionEvent } from "../../src/v2/session-event"

const sessionID = SessionID.make("ses_test")
const time = (n: number) => DateTime.makeUnsafe(n)

function run(events: SessionEvent.Event[]) {
  return events.reduce<SessionEntryStepper.MemoryState>(
    (state, event) => SessionEntryStepper.step(state, event),
    { entries: [], pending: [] },
  )
}

function assistant(state: SessionEntryStepper.MemoryState) {
  const entry = state.entries.findLast((entry) => entry.type === "assistant")
  expect(entry?.type).toBe("assistant")
  return entry as SessionEntry.Assistant
}

function tool(state: SessionEntryStepper.MemoryState, callID: string) {
  const entry = assistant(state)
  const item = entry.content.find((item) => item.type === "tool" && item.callID === callID)
  expect(item?.type).toBe("tool")
  return item as SessionEntry.AssistantTool
}

describe("session-entry-stepper", () => {
  test("projects a running tool progress update", () => {
    const state = run([
      {
        type: "session.next.step.started",
        data: {
          sessionID,
          timestamp: time(1),
          model: { id: "gpt-5.1", providerID: "openai" },
        },
      },
      {
        type: "session.next.tool.input.started",
        data: {
          sessionID,
          timestamp: time(2),
          callID: "call_1",
          name: "bash",
        },
      },
      {
        type: "session.next.tool.called",
        data: {
          sessionID,
          timestamp: time(3),
          callID: "call_1",
          tool: "bash",
          input: { command: "bun test" },
          provider: { executed: false },
        },
      },
      {
        type: "session.next.tool.progress",
        data: {
          sessionID,
          timestamp: time(4),
          callID: "call_1",
          details: { output: "running tests", description: "test suite" },
        },
      },
    ])

    expect(tool(state, "call_1").state).toEqual({
      status: "running",
      input: { command: "bun test" },
      details: { output: "running tests", description: "test suite" },
    })
  })

  test("keeps separate reasoning blocks by reasoning id", () => {
    const state = run([
      {
        type: "session.next.step.started",
        data: {
          sessionID,
          timestamp: time(1),
          model: { id: "gpt-5.1", providerID: "openai" },
        },
      },
      {
        type: "session.next.reasoning.started",
        data: { sessionID, timestamp: time(2), reasoningID: "reason_1" },
      },
      {
        type: "session.next.reasoning.started",
        data: { sessionID, timestamp: time(3), reasoningID: "reason_2" },
      },
      {
        type: "session.next.reasoning.delta",
        data: { sessionID, timestamp: time(4), reasoningID: "reason_1", delta: "first " },
      },
      {
        type: "session.next.reasoning.delta",
        data: { sessionID, timestamp: time(5), reasoningID: "reason_2", delta: "second" },
      },
      {
        type: "session.next.reasoning.ended",
        data: { sessionID, timestamp: time(6), reasoningID: "reason_1", text: "first done" },
      },
    ])

    expect(assistant(state).content).toMatchObject([
      { type: "reasoning", reasoningID: "reason_1", text: "first done" },
      { type: "reasoning", reasoningID: "reason_2", text: "second" },
    ])
  })

  test("moves active user prompts to pending entries", () => {
    const state = run([
      {
        type: "session.next.step.started",
        data: {
          sessionID,
          timestamp: time(1),
          model: { id: "gpt-5.1", providerID: "openai" },
        },
      },
      {
        type: "session.next.prompted",
        data: {
          sessionID,
          timestamp: time(2),
          prompt: {
            text: "next prompt",
          },
        },
      },
    ])

    expect(state.entries).toHaveLength(1)
    expect(state.pending).toMatchObject([{ type: "user", text: "next prompt" }])
  })
})
