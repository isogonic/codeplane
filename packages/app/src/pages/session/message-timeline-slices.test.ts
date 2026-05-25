import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message as MessageType, UserMessage } from "@codeplane-ai/sdk/v2"
import { visibleTurnSlices } from "./message-timeline-slices"

const user = (id: string) =>
  ({
    id,
    sessionID: "ses_1",
    role: "user",
    time: { created: 1 },
  }) as UserMessage

const assistant = (id: string, parentID: string) =>
  ({
    id,
    sessionID: "ses_1",
    role: "assistant",
    parentID,
    time: { created: 1 },
  }) as AssistantMessage

describe("visibleTurnSlices", () => {
  test("builds slices only for rendered user turns", () => {
    const messages: MessageType[] = [
      user("u1"),
      assistant("a1", "u1"),
      user("u2"),
      assistant("a2", "u2"),
      user("u3"),
      assistant("a3", "u3"),
    ]

    const result = visibleTurnSlices({ messages, renderedUserMessageIDs: ["u2", "u3"] })

    expect([...result.keys()]).toEqual(["u2", "u3"])
    expect(result.get("u2")?.map((message) => message.id)).toEqual(["u2", "a2"])
    expect(result.get("u3")?.map((message) => message.id)).toEqual(["u3", "a3"])
    expect(result.has("u1")).toBe(false)
  })

  test("stops a slice at the next user turn", () => {
    const messages: MessageType[] = [
      user("u1"),
      assistant("a1", "u1"),
      user("u2"),
      assistant("late", "u1"),
      assistant("a2", "u2"),
    ]

    const result = visibleTurnSlices({ messages, renderedUserMessageIDs: ["u1", "u2"] })

    expect(result.get("u1")?.map((message) => message.id)).toEqual(["u1", "a1"])
    expect(result.get("u2")?.map((message) => message.id)).toEqual(["u2", "a2"])
  })
})
