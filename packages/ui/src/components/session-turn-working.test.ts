import { describe, expect, test } from "bun:test"
import type { AssistantMessage } from "@codeplane-ai/sdk/v2/client"
import type { SessionStatus } from "@codeplane-ai/sdk/v2"
import { hasPendingTurnAssistant, isSessionTurnWorking } from "./session-turn-working"

const idle = { type: "idle" } as SessionStatus
const busy = { type: "busy" } as SessionStatus

const assistant = (completed?: number): AssistantMessage =>
  ({
    id: completed ? "assistant-complete" : "assistant-pending",
    sessionID: "session-1",
    role: "assistant",
    parentID: "user-1",
    mode: "build",
    agent: "build",
    path: { cwd: "/repo", root: "/repo" },
    providerID: "provider",
    modelID: "model",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: completed ? { created: 2, completed } : { created: 2 },
  }) as AssistantMessage

describe("session-turn-working", () => {
  test("detects a pending assistant in the current turn", () => {
    expect(hasPendingTurnAssistant([assistant()])).toBe(true)
    expect(hasPendingTurnAssistant([assistant(3)])).toBe(false)
    expect(hasPendingTurnAssistant([assistant(), assistant(4)])).toBe(false)
  })

  test("keeps a turn working while the latest assistant is unfinished even if status is idle", () => {
    expect(
      isSessionTurnWorking({
        active: true,
        status: idle,
        assistantMessages: [assistant()],
      }),
    ).toBe(true)
  })

  test("respects inactive turns", () => {
    expect(
      isSessionTurnWorking({
        active: false,
        status: busy,
        assistantMessages: [assistant()],
      }),
    ).toBe(false)
  })
})
