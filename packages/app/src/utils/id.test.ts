import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Identifier } from "./id"

describe("Identifier", () => {
  test("ascending() generates an id with the expected prefix", () => {
    const id = Identifier.ascending("session")
    expect(id.startsWith("ses_")).toBe(true)
    expect(id.length).toBeGreaterThan(20)
  })

  test("descending() generates an id with the expected prefix", () => {
    const id = Identifier.descending("message")
    expect(id.startsWith("msg_")).toBe(true)
    expect(id.length).toBeGreaterThan(20)
  })

  test("ascending ids increase over time", async () => {
    const a = Identifier.ascending("session")
    await new Promise((resolve) => setTimeout(resolve, 5))
    const b = Identifier.ascending("session")
    expect(b > a).toBe(true)
  })

  test("descending ids decrease over time", async () => {
    const a = Identifier.descending("session")
    await new Promise((resolve) => setTimeout(resolve, 5))
    const b = Identifier.descending("session")
    expect(b < a).toBe(true)
  })

  test("ids generated in the same millisecond are unique", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i += 1) {
      ids.add(Identifier.ascending("session"))
    }
    expect(ids.size).toBe(100)
  })

  test("returns a given id when provided and prefix matches", () => {
    const given = "ses_abc123"
    expect(Identifier.ascending("session", given)).toBe(given)
    expect(Identifier.descending("session", given)).toBe(given)
  })

  test("throws when given id has the wrong prefix", () => {
    expect(() => Identifier.ascending("session", "msg_abc")).toThrow(/does not start with/)
    expect(() => Identifier.descending("user", "ses_abc")).toThrow(/does not start with/)
  })

  test("schema() validates the prefix", () => {
    const sessionSchema = Identifier.schema("session")
    expect(sessionSchema.safeParse("ses_anything").success).toBe(true)
    expect(sessionSchema.safeParse("msg_anything").success).toBe(false)
  })

  test("falls back to Math.random when crypto.getRandomValues is unavailable", () => {
    const original = globalThis.crypto
    // @ts-expect-error overriding to test fallback path
    globalThis.crypto = undefined

    try {
      const id = Identifier.ascending("part")
      expect(id.startsWith("prt_")).toBe(true)
      expect(id.length).toBeGreaterThan(20)
    } finally {
      globalThis.crypto = original
    }
  })

  test("falls back when getRandomValues is not a function", () => {
    const original = globalThis.crypto
    // @ts-expect-error overriding to test fallback
    globalThis.crypto = { getRandomValues: undefined }

    try {
      const id = Identifier.ascending("pty")
      expect(id.startsWith("pty_")).toBe(true)
      expect(id.length).toBeGreaterThan(20)
    } finally {
      globalThis.crypto = original
    }
  })
})
