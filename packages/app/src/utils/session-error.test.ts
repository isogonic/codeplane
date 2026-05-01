import { describe, expect, test } from "bun:test"
import { createRecentSessionErrorGate, describeSessionError, isIgnorableSessionError } from "./session-error"

describe("session error helpers", () => {
  test("describes session errors from structured data", () => {
    expect(
      describeSessionError({
        name: "UnknownError",
        data: {
          message: "Provider exploded",
        },
      }),
    ).toBe("Provider exploded")
  })

  test("falls back to the error name when no message exists", () => {
    expect(
      describeSessionError({
        name: "MessageOutputLengthError",
        data: {},
      }),
    ).toBe("MessageOutputLengthError")
  })

  test("treats message-aborted errors as ignorable", () => {
    expect(
      isIgnorableSessionError({
        name: "MessageAbortedError",
        data: {
          message: "Interrupted",
        },
      }),
    ).toBe(true)
    expect(
      isIgnorableSessionError({
        name: "UnknownError",
        data: {
          message: "Interrupted",
        },
      }),
    ).toBe(false)
  })

  test("dedupes repeated session errors within the ttl window", () => {
    const gate = createRecentSessionErrorGate(1_000)
    const error = {
      name: "UnknownError" as const,
      data: {
        message: "Provider exploded",
      },
    }
    const original = Date.now
    let now = 10_000
    Date.now = () => now

    try {
      expect(gate({ directory: "/workspace", sessionID: "ses_1", error })).toBe(true)
      expect(gate({ directory: "/workspace", sessionID: "ses_1", error })).toBe(false)

      now += 1_001

      expect(gate({ directory: "/workspace", sessionID: "ses_1", error })).toBe(true)
    } finally {
      Date.now = original
    }
  })
})
