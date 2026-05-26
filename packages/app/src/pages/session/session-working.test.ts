import { expect, test } from "bun:test"
import type { Message, SessionStatus } from "@codeplane-ai/sdk/v2/client"
import { hasPendingAssistantMessage, hasUnansweredUserMessage, isSessionWorking } from "./session-working"

const idle = { type: "idle" } as SessionStatus
const busy = { type: "busy" } as SessionStatus

const user = (): Message =>
  ({
    id: "message-user",
    sessionID: "session-1",
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "provider", modelID: "model" },
  }) as Message

const assistant = (completed?: number): Message =>
  ({
    id: completed ? "message-assistant-done" : "message-assistant-pending",
    sessionID: "session-1",
    role: "assistant",
    parentID: "message-user",
    mode: "build",
    agent: "build",
    path: { cwd: "/repo", root: "/repo" },
    providerID: "provider",
    modelID: "model",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: completed ? { created: 2, completed } : { created: 2 },
  }) as Message

test("detects a pending assistant turn from messages", () => {
  expect(hasPendingAssistantMessage([user(), assistant()])).toBe(true)
  expect(hasPendingAssistantMessage([user(), assistant(3)])).toBe(false)
  expect(hasPendingAssistantMessage([user(), assistant(), assistant(4)])).toBe(false)
  expect(hasPendingAssistantMessage(undefined)).toBe(false)
})

test("detects a user message that has not received an assistant reply yet", () => {
  expect(hasUnansweredUserMessage([user()])).toBe(true)
  expect(hasUnansweredUserMessage([user(), assistant(3)])).toBe(false)
  expect(hasUnansweredUserMessage([assistant(3), user()])).toBe(true)
  expect(hasUnansweredUserMessage(undefined)).toBe(false)
})

test("treats pending assistant turns as working even when status is idle", () => {
  expect(isSessionWorking(idle, [user(), assistant()])).toBe(true)
  expect(isSessionWorking(idle, [user(), assistant(3)])).toBe(false)
})

test("does not keep a completed turn working when only the session status is stale busy", () => {
  expect(isSessionWorking(busy, [user(), assistant(3)])).toBe(false)
})

test("keeps a busy session working before the assistant reply starts", () => {
  expect(isSessionWorking(busy, [user()])).toBe(true)
  expect(isSessionWorking(busy, undefined)).toBe(true)
})
