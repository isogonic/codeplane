import { describe, expect, test } from "bun:test"
import { Identifier } from "../src/util/identifier"

describe("Identifier.create", () => {
  test("returns a string", () => {
    expect(typeof Identifier.create(false)).toBe("string")
  })
  test("ascending creates a string", () => {
    expect(typeof Identifier.ascending()).toBe("string")
  })
  test("descending creates a string", () => {
    expect(typeof Identifier.descending()).toBe("string")
  })
  test("identifier has length 26", () => {
    expect(Identifier.create(false).length).toBe(26)
  })
  test("ascending has length 26", () => {
    expect(Identifier.ascending().length).toBe(26)
  })
  test("descending has length 26", () => {
    expect(Identifier.descending().length).toBe(26)
  })
  test("first 12 chars are hex (timestamp)", () => {
    const id = Identifier.create(false)
    expect(id.slice(0, 12)).toMatch(/^[0-9a-f]{12}$/)
  })
  test("last 14 chars are base62", () => {
    const id = Identifier.create(false)
    expect(id.slice(12)).toMatch(/^[0-9A-Za-z]{14}$/)
  })
  test("multiple ids are unique", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) ids.add(Identifier.ascending())
    expect(ids.size).toBe(1000)
  })
  test("ascending ids sort lexicographically by time", async () => {
    const a = Identifier.ascending()
    await new Promise((r) => setTimeout(r, 5))
    const b = Identifier.ascending()
    expect(a < b).toBe(true)
  })
  test("descending ids sort reverse-lexicographically by time", async () => {
    const a = Identifier.descending()
    await new Promise((r) => setTimeout(r, 5))
    const b = Identifier.descending()
    expect(a > b).toBe(true)
  })
  test("explicit timestamp produces deterministic time portion", () => {
    const id1 = Identifier.create(false, 1_000_000_000_000)
    const id2 = Identifier.create(false, 1_000_000_000_000)
    expect(id1.slice(0, 11)).toBe(id2.slice(0, 11))
  })
  test("counter increments within same timestamp", () => {
    const id1 = Identifier.create(false, 2_000_000_000_000)
    const id2 = Identifier.create(false, 2_000_000_000_000)
    expect(id1.slice(0, 12)).not.toBe(id2.slice(0, 12))
  })
})

describe("Identifier bulk", () => {
  for (let i = 0; i < 100; i++) {
    test(`bulk ascending uniqueness #${i}`, () => {
      const id = Identifier.ascending()
      expect(id.length).toBe(26)
    })
    test(`bulk descending uniqueness #${i}`, () => {
      const id = Identifier.descending()
      expect(id.length).toBe(26)
    })
  }
  test("ascending: 10000 ids are all unique", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 10_000; i++) ids.add(Identifier.ascending())
    expect(ids.size).toBe(10_000)
  })
})

describe("Identifier shape", () => {
  for (let i = 0; i < 50; i++) {
    test(`uniform shape #${i}`, () => {
      const a = Identifier.ascending()
      expect(a).toMatch(/^[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    })
  }
})
