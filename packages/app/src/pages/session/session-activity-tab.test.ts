import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import { buildSessionActivity } from "./session-activity-tab"

const tokens = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: {
    read: 0,
    write: 0,
  },
}

const user = (input: {
  id: string
  time: number
  providerID: string
  modelID: string
  diffs?: NonNullable<Extract<Message, { role: "user" }>["summary"]>["diffs"]
}): Extract<Message, { role: "user" }> => ({
  id: input.id,
  sessionID: "session",
  role: "user",
  time: {
    created: input.time,
  },
  agent: "build",
  model: {
    providerID: input.providerID,
    modelID: input.modelID,
  },
  summary: input.diffs
    ? {
        diffs: input.diffs,
      }
    : undefined,
})

const assistant = (input: {
  id: string
  parentID: string
  time: number
  completed?: number
  providerID: string
  modelID: string
}): Extract<Message, { role: "assistant" }> => ({
  id: input.id,
  sessionID: "session",
  role: "assistant",
  time: {
    created: input.time,
    completed: input.completed,
  },
  parentID: input.parentID,
  modelID: input.modelID,
  providerID: input.providerID,
  mode: "build",
  agent: "build",
  path: {
    cwd: "/repo",
    root: "/repo",
  },
  cost: 0,
  tokens,
})

describe("buildSessionActivity", () => {
  test("collects tool calls, model switches, file events, and file heat", () => {
    const messages: Message[] = [
      user({
        id: "u1",
        time: 1000,
        providerID: "openai",
        modelID: "gpt-5",
        diffs: [
          {
            file: "src/a.ts",
            patch: "",
            additions: 4,
            deletions: 1,
            status: "modified",
          },
        ],
      }),
      assistant({
        id: "a1",
        parentID: "u1",
        time: 1100,
        completed: 1800,
        providerID: "openai",
        modelID: "gpt-5",
      }),
      user({
        id: "u2",
        time: 2000,
        providerID: "anthropic",
        modelID: "claude",
        diffs: [
          {
            file: "src/a.ts",
            patch: "",
            additions: 2,
            deletions: 0,
            status: "modified",
          },
          {
            file: "src/b.ts",
            patch: "",
            additions: 1,
            deletions: 3,
            status: "added",
          },
        ],
      }),
      assistant({
        id: "a2",
        parentID: "u2",
        time: 2100,
        completed: 2600,
        providerID: "anthropic",
        modelID: "claude",
      }),
    ]

    const parts: Record<string, Part[]> = {
      a1: [
        {
          id: "p1",
          sessionID: "session",
          messageID: "a1",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "completed",
            input: {
              description: "Run tests",
            },
            output: "",
            title: "Run tests",
            metadata: {},
            time: {
              start: 1200,
              end: 1500,
            },
          },
        },
      ],
      a2: [
        {
          id: "p2",
          sessionID: "session",
          messageID: "a2",
          type: "tool",
          callID: "call-2",
          tool: "read",
          state: {
            status: "pending",
            input: {
              filePath: "src/b.ts",
            },
            raw: "{}",
          },
        },
      ],
    }

    const activity = buildSessionActivity({ messages, parts })

    expect(activity.totals).toEqual({
      tools: 2,
      modelSwitches: 1,
      files: 2,
    })
    expect(activity.heatmap.map((item) => [item.file, item.count, item.additions, item.deletions])).toEqual([
      ["src/a.ts", 2, 6, 1],
      ["src/b.ts", 1, 1, 3],
    ])
    expect(activity.events.map((event) => `${event.kind}:${event.id}`)).toEqual([
      "model:model:u1",
      "tool:tool:p1",
      "file:file:u1:src/a.ts",
      "model:model:u2",
      "tool:tool:p2",
      "file:file:u2:src/a.ts",
      "file:file:u2:src/b.ts",
    ])
  })
})
