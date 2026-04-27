import { describe, expect, test } from "bun:test"
import type { Session } from "@codeplane-ai/sdk/v2"
import { taskChildSession } from "./message-part-task"

const legacySession = {
  id: "ses_legacy",
  parentID: "ses_parent",
  title: "inspect auth (@General subagent)",
  time: { created: 1 },
} as unknown as Session

describe("taskChildSession", () => {
  test("uses stable metadata session id before legacy title fallback", () => {
    expect(
      taskChildSession(
        { description: "inspect auth", subagent_type: "general" },
        { sessionId: "ses_metadata" },
        "/project/session/ses_parent",
        [legacySession],
      ),
    ).toBe("ses_metadata")
  })

  test("keeps legacy title fallback for old task messages", () => {
    expect(
      taskChildSession(
        { description: "inspect auth", subagent_type: "general" },
        {},
        "/project/session/ses_parent",
        [legacySession],
      ),
    ).toBe("ses_legacy")
  })
})
