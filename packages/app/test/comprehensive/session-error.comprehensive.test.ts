import { describe, expect, test } from "bun:test"
import {
  createRecentSessionErrorGate,
  describeSessionError,
  isIgnorableSessionError,
} from "../../src/utils/session-error"

describe("isIgnorableSessionError", () => {
  test("MessageAbortedError is ignorable", () => {
    expect(isIgnorableSessionError({ name: "MessageAbortedError" } as never)).toBe(true)
  })
  test("other errors are not ignorable", () => {
    expect(isIgnorableSessionError({ name: "OtherError" } as never)).toBe(false)
  })
  test("undefined error is not ignorable", () => {
    expect(isIgnorableSessionError(undefined as never)).toBe(false)
  })
})

describe("describeSessionError", () => {
  test("uses data.message when present", () => {
    expect(describeSessionError({ name: "X", data: { message: "msg" } } as never)).toBe("msg")
  })
  test("falls back to name", () => {
    expect(describeSessionError({ name: "X" } as never)).toBe("X")
  })
  test("falls back to unknown", () => {
    expect(describeSessionError(undefined as never)).toBe("Unknown session error")
  })
  for (let i = 0; i < 50; i++) {
    test(`name fallback #${i}`, () => {
      expect(describeSessionError({ name: `Err-${i}` } as never)).toBe(`Err-${i}`)
    })
  }
  for (let i = 0; i < 50; i++) {
    test(`message wins #${i}`, () => {
      expect(
        describeSessionError({ name: "X", data: { message: `msg-${i}` } } as never),
      ).toBe(`msg-${i}`)
    })
  }
})

describe("createRecentSessionErrorGate", () => {
  test("first error passes through", () => {
    const gate = createRecentSessionErrorGate()
    expect(gate({ directory: "/a", error: { name: "E" } as never })).toBe(true)
  })
  test("duplicate is suppressed", () => {
    const gate = createRecentSessionErrorGate()
    gate({ directory: "/a", error: { name: "E" } as never })
    expect(gate({ directory: "/a", error: { name: "E" } as never })).toBe(false)
  })
  test("different sessions are independent", () => {
    const gate = createRecentSessionErrorGate()
    gate({ directory: "/a", sessionID: "s1", error: { name: "E" } as never })
    expect(gate({ directory: "/a", sessionID: "s2", error: { name: "E" } as never })).toBe(true)
  })
  test("different errors pass through", () => {
    const gate = createRecentSessionErrorGate()
    gate({ directory: "/a", error: { name: "E1" } as never })
    expect(gate({ directory: "/a", error: { name: "E2" } as never })).toBe(true)
  })
  for (let i = 0; i < 50; i++) {
    test(`bulk distinct dirs #${i}`, () => {
      const gate = createRecentSessionErrorGate()
      expect(gate({ directory: `/dir-${i}`, error: { name: "E" } as never })).toBe(true)
    })
  }
})
