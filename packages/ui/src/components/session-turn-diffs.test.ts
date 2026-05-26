import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part, SnapshotFileDiff } from "@codeplane-ai/sdk/v2/client"
import { messageDiffs } from "./session-turn-diffs"

const sessionID = "ses_1"
const assistantID = "msg_assistant"

const assistant = {
  id: assistantID,
  sessionID,
  role: "assistant",
  time: { created: 1 },
  parentID: "msg_user",
  providerID: "provider",
  modelID: "model",
  mode: "build",
  agent: "build",
  path: { cwd: "/repo", root: "/repo" },
  cost: 0,
  tokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
} as AssistantMessage

function diff(file: string): SnapshotFileDiff {
  return {
    file,
    patch: "",
    additions: file.endsWith(".png") ? 0 : 1,
    deletions: 0,
    status: "modified",
  }
}

function tool(name: string, metadata: Record<string, unknown>): Part {
  return {
    id: `prt_${name}`,
    sessionID,
    messageID: assistantID,
    type: "tool",
    callID: `call_${name}`,
    tool: name,
    state: {
      status: "completed",
      input: {},
      output: "",
      title: name,
      metadata,
      time: { start: 1, end: 2 },
    },
  } as Part
}

describe("session turn diffs", () => {
  test("hides stale snapshot diffs when the turn only has non-mutating tool output", () => {
    expect(
      messageDiffs({
        diffs: [diff("tabs-match.png")],
        assistants: [assistant],
        partsByMessageID: {
          [assistantID]: [tool("browser", { screenshotMime: "image/png", screenshotDataUrl: "data:image/png;base64,abc" })],
        },
      }),
    ).toEqual([])
  })

  test("keeps only summary diffs named by mutating tool metadata", () => {
    expect(
      messageDiffs({
        diffs: [diff("src/app.ts"), diff("tabs-match.png")],
        assistants: [assistant],
        partsByMessageID: {
          [assistantID]: [
            tool("apply_patch", {
              files: [{ relativePath: "src/app.ts", type: "update", additions: 1, deletions: 0 }],
            }),
          ],
        },
      }),
    ).toEqual([diff("src/app.ts")])
  })

  test("matches absolute edit metadata against relative summary diffs", () => {
    expect(
      messageDiffs({
        diffs: [diff("src/app.ts")],
        assistants: [assistant],
        partsByMessageID: {
          [assistantID]: [tool("edit", { filediff: { file: "/repo/src/app.ts", additions: 1, deletions: 0 } })],
        },
      }),
    ).toEqual([diff("src/app.ts")])
  })
})
