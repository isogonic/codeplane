import { describe, expect, test } from "bun:test"
import type { ToolPart } from "@codeplane-ai/sdk/v2"
import { taskSessionID, taskStatus } from "../../../src/cli/cmd/tui/routes/orchestrator"

function taskPart(metadata: Record<string, unknown>): ToolPart {
  return {
    id: "prt_test",
    messageID: "msg_test",
    sessionID: "ses_parent",
    type: "tool",
    tool: "task",
    callID: "call_test",
    state: {
      status: "completed",
      input: { description: "inspect auth", subagent_type: "general" },
      title: "inspect auth",
      output: "",
      metadata,
      time: { start: 1, end: 2 },
    },
  } as ToolPart
}

describe("orchestrator task helpers", () => {
  test("uses stable metadata session id for child navigation", () => {
    expect(taskSessionID(taskPart({ sessionId: "ses_child" }))).toBe("ses_child")
  })

  test("uses metadata status before tool state status", () => {
    expect(taskStatus(taskPart({ status: "running" }))).toBe("running")
  })
})
