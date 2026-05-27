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

  test("late-arriving assistant whose parentID matches an earlier user joins that user's slice", () => {
    // v29.0.33 regression: SSE events can land out-of-order so an
    // assistant with parentID="u1" might end up at array index AFTER
    // user "u2". Pre-fix the slice loop broke on the first
    // subsequent user role, dropping the late child entirely — that
    // was the user-reported "chat fails to show, refresh fixes it"
    // bug. Now we group by parentID so children find their owner
    // regardless of array position.
    const messages: MessageType[] = [
      user("u1"),
      assistant("a1", "u1"),
      user("u2"),
      assistant("late", "u1"),
      assistant("a2", "u2"),
    ]

    const result = visibleTurnSlices({ messages, renderedUserMessageIDs: ["u1", "u2"] })

    // u1 picks up both its immediate child AND the late child whose
    // parentID points back to u1. Sorted by id ("a1" < "late").
    expect(result.get("u1")?.map((message) => message.id)).toEqual(["u1", "a1", "late"])
    expect(result.get("u2")?.map((message) => message.id)).toEqual(["u2", "a2"])
  })
})
