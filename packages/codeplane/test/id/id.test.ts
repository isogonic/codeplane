import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"

describe("Identifier.schema", () => {
  test("creates a zod schema enforcing prefix", () => {
    const s = Identifier.schema("session")
    expect(s.parse("ses_anything")).toBe("ses_anything")
  })

  test("rejects wrong prefix", () => {
    const s = Identifier.schema("session")
    expect(() => s.parse("usr_x")).toThrow()
  })

  test("for event prefix", () => {
    const s = Identifier.schema("event")
    expect(s.parse("evt_xyz")).toBe("evt_xyz")
  })

  test("for message prefix", () => {
    const s = Identifier.schema("message")
    expect(s.parse("msg_xyz")).toBe("msg_xyz")
  })
})

describe("Identifier.ascending", () => {
  test("returns string with prefix", () => {
    const id = Identifier.ascending("session")
    expect(id.startsWith("ses_")).toBe(true)
  })

  test("two ids are different", () => {
    expect(Identifier.ascending("session")).not.toBe(Identifier.ascending("session"))
  })

  test("ascending ids are sortable lexicographically", () => {
    const ids = Array.from({ length: 5 }, () => Identifier.ascending("session"))
    expect([...ids].sort()).toEqual(ids)
  })

  test("returns given id when valid", () => {
    expect(Identifier.ascending("session", "ses_provided")).toBe("ses_provided")
  })

  test("throws when given id has wrong prefix", () => {
    expect(() => Identifier.ascending("session", "usr_x")).toThrow()
  })

  test("works for all defined prefixes", () => {
    const prefixes = ["event", "session", "message", "permission", "question", "user", "part", "pty", "tool", "workspace", "entry", "cron", "crun"] as const
    for (const p of prefixes) {
      expect(typeof Identifier.ascending(p)).toBe("string")
    }
  })

  test("event prefix is 'evt'", () => {
    expect(Identifier.ascending("event").startsWith("evt_")).toBe(true)
  })

  test("permission prefix is 'per'", () => {
    expect(Identifier.ascending("permission").startsWith("per_")).toBe(true)
  })

  test("user prefix is 'usr'", () => {
    expect(Identifier.ascending("user").startsWith("usr_")).toBe(true)
  })

  test("workspace prefix is 'wrk'", () => {
    expect(Identifier.ascending("workspace").startsWith("wrk_")).toBe(true)
  })

  test("cron prefix is 'cron'", () => {
    expect(Identifier.ascending("cron").startsWith("cron_")).toBe(true)
  })
})

describe("Identifier.descending", () => {
  test("returns string with prefix", () => {
    const id = Identifier.descending("session")
    expect(id.startsWith("ses_")).toBe(true)
  })

  test("descending ids sort in reverse order", () => {
    const ids = Array.from({ length: 5 }, () => Identifier.descending("session"))
    expect([...ids].sort().reverse()).toEqual(ids)
  })

  test("returns given id when valid", () => {
    expect(Identifier.descending("session", "ses_x")).toBe("ses_x")
  })

  test("throws when given id has wrong prefix", () => {
    expect(() => Identifier.descending("session", "usr_x")).toThrow()
  })
})

describe("Identifier.create", () => {
  test("returns prefix + _ + 26 chars", () => {
    const id = Identifier.create("foo", "ascending")
    expect(id.startsWith("foo_")).toBe(true)
    expect(id.slice(4).length).toBe(26)
  })

  test("respects given timestamp", () => {
    const id1 = Identifier.create("foo", "ascending", 100)
    const id2 = Identifier.create("foo", "ascending", 100)
    expect(id1).not.toBe(id2)
  })

  test("ascending vs descending produce different IDs", () => {
    const ts = 1000
    const a = Identifier.create("foo", "ascending", ts)
    const d = Identifier.create("foo", "descending", ts)
    expect(a).not.toBe(d)
  })
})

describe("Identifier.timestamp", () => {
  test("extracts timestamp from ascending id (under 6-byte limit)", () => {
    // Encoding fits ts<<12|counter into 6 bytes (48 bits) so max ts ~2^36 ms
    const ts = 1_000_000_000
    const id = Identifier.create("foo", "ascending", ts)
    expect(Identifier.timestamp(id)).toBe(ts)
  })

  test("extracts timestamp from another ascending id", () => {
    const ts = 1_500_000_000
    const id = Identifier.create("ses", "ascending", ts)
    expect(Identifier.timestamp(id)).toBe(ts)
  })

  test("extracts timestamp from small value", () => {
    const ts = 100_000
    const id = Identifier.create("foo", "ascending", ts)
    expect(Identifier.timestamp(id)).toBe(ts)
  })
})
