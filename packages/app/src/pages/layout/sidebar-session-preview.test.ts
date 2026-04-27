import { describe, expect, test } from "bun:test"
import type { AssistantMessage, TextPart, UserMessage } from "@opencode-ai/sdk/v2/client"
import { formatSessionPreviewCost, formatSessionPreviewDuration, getSessionPreview } from "./sidebar-session-preview"

const user = (input: { id: string; created: number; modelID?: string }) =>
  ({
    id: input.id,
    sessionID: "session",
    role: "user",
    time: {
      created: input.created,
    },
    agent: "build",
    model: {
      providerID: "anthropic",
      modelID: input.modelID ?? "claude-sonnet-4",
    },
  }) satisfies UserMessage

const assistant = (input: { id: string; parentID: string; created: number; completed?: number; cost?: number }) =>
  ({
    id: input.id,
    sessionID: "session",
    role: "assistant",
    time: {
      created: input.created,
      completed: input.completed,
    },
    parentID: input.parentID,
    modelID: "claude-sonnet-4",
    providerID: "anthropic",
    mode: "build",
    agent: "build",
    path: {
      cwd: "/repo",
      root: "/repo",
    },
    cost: input.cost ?? 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  }) satisfies AssistantMessage

const text = (input: { id: string; messageID: string; value: string; ignored?: boolean; synthetic?: boolean }) =>
  ({
    id: input.id,
    sessionID: "session",
    messageID: input.messageID,
    type: "text",
    text: input.value,
    ignored: input.ignored,
    synthetic: input.synthetic,
  }) satisfies TextPart

describe("getSessionPreview", () => {
  test("returns last prompt with matching assistant metrics", () => {
    const first = user({ id: "u1", created: 1 })
    const last = user({ id: "u2", created: 3, modelID: "claude-opus-4" })

    const result = getSessionPreview({
      messages: [
        first,
        assistant({ id: "a1", parentID: first.id, created: 2, completed: 4, cost: 0.01 }),
        last,
        assistant({ id: "a2", parentID: last.id, created: 5, completed: 15, cost: 0.0025 }),
      ],
      parts: {
        [first.id]: [text({ id: "p1", messageID: first.id, value: "first prompt" })],
        [last.id]: [text({ id: "p2", messageID: last.id, value: "last prompt" })],
      },
    })

    expect(result).toEqual({
      loading: false,
      prompt: "last prompt",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      cost: 0.0025,
      duration: 10,
    })
  })

  test("uses the user selected model while the last prompt is unanswered", () => {
    const last = user({ id: "u1", created: 1, modelID: "claude-opus-4" })

    const result = getSessionPreview({
      messages: [last],
      parts: {
        [last.id]: [
          text({ id: "p1", messageID: last.id, value: "visible" }),
          text({ id: "p2", messageID: last.id, value: "ignored", ignored: true }),
          text({ id: "p3", messageID: last.id, value: "synthetic", synthetic: true }),
        ],
      },
    })

    expect(result).toMatchObject({
      loading: false,
      prompt: "visible",
      providerID: "anthropic",
      modelID: "claude-opus-4",
    })
    expect(result.cost).toBeUndefined()
    expect(result.duration).toBeUndefined()
  })

  test("marks unloaded message caches as loading", () => {
    expect(getSessionPreview({ messages: undefined, parts: {} })).toEqual({ loading: true })
  })
})

describe("session preview formatters", () => {
  test("formats compact duration and cost values", () => {
    expect(formatSessionPreviewDuration(65_000, "en")).toBe("1m 5s")
    expect(formatSessionPreviewCost(0.0025, "en")).toBe("$0.0025")
  })
})
