import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/util/identifier"

describe("Identifier.ascending", () => {
  test("returns string of length 26", () => {
    expect(Identifier.ascending().length).toBe(26)
  })

  test("returns alphanumeric string", () => {
    expect(Identifier.ascending()).toMatch(/^[0-9A-Za-z]+$/)
  })

  test("two consecutive ids are different", () => {
    const a = Identifier.ascending()
    const b = Identifier.ascending()
    expect(a).not.toBe(b)
  })

  test("id has hex prefix", () => {
    const id = Identifier.ascending()
    expect(id.slice(0, 12)).toMatch(/^[0-9a-f]{12}$/)
  })

  test("ids are lexicographically sortable", () => {
    const ids = Array.from({ length: 5 }, () => Identifier.ascending())
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })

  test("100 generated ids are all unique", () => {
    const ids = new Set(Array.from({ length: 100 }, () => Identifier.ascending()))
    expect(ids.size).toBe(100)
  })

  test("returns different result on each call", () => {
    const ids = Array.from({ length: 10 }, () => Identifier.ascending())
    expect(new Set(ids).size).toBe(10)
  })
})

describe("Identifier.descending", () => {
  test("returns string of length 26", () => {
    expect(Identifier.descending().length).toBe(26)
  })

  test("returns alphanumeric string", () => {
    expect(Identifier.descending()).toMatch(/^[0-9A-Za-z]+$/)
  })

  test("two consecutive ids are different", () => {
    const a = Identifier.descending()
    const b = Identifier.descending()
    expect(a).not.toBe(b)
  })

  test("descending ids sort in reverse order", () => {
    const ids = Array.from({ length: 5 }, () => Identifier.descending())
    const sorted = [...ids].sort().reverse()
    expect(ids).toEqual(sorted)
  })

  test("100 generated ids are all unique", () => {
    const ids = new Set(Array.from({ length: 100 }, () => Identifier.descending()))
    expect(ids.size).toBe(100)
  })
})

describe("Identifier.create", () => {
  test("supports explicit timestamp (ascending)", () => {
    const id = Identifier.create(false, 1_000_000_000)
    expect(id.length).toBe(26)
  })

  test("supports explicit timestamp (descending)", () => {
    const id = Identifier.create(true, 1_000_000_000)
    expect(id.length).toBe(26)
  })

  test("two ids with same timestamp differ at counter", () => {
    const a = Identifier.create(false, 1_000_000_000)
    const b = Identifier.create(false, 1_000_000_000)
    expect(a).not.toBe(b)
  })

  test("ascending vs descending produce different ids", () => {
    const ts = 2_000_000_000
    const asc = Identifier.create(false, ts)
    const desc = Identifier.create(true, ts)
    expect(asc).not.toBe(desc)
  })

  test("hex prefix is 12 chars", () => {
    const id = Identifier.create(false, 1_500_000_000)
    expect(id.slice(0, 12)).toMatch(/^[0-9a-f]{12}$/)
  })

  test("random suffix is 14 chars", () => {
    const id = Identifier.create(false, 1_500_000_000)
    expect(id.slice(12).length).toBe(14)
  })

  test("monotonic ascending in same call group", () => {
    const ts = 3_000_000_000
    const a = Identifier.create(false, ts)
    const b = Identifier.create(false, ts)
    expect(a < b).toBe(true)
  })

  test("monotonic descending in same call group", () => {
    const ts = 3_500_000_000
    const a = Identifier.create(true, ts)
    const b = Identifier.create(true, ts)
    expect(a > b).toBe(true)
  })

  test("supports zero timestamp", () => {
    const id = Identifier.create(false, 0)
    expect(id.length).toBe(26)
  })

  test("supports large timestamps", () => {
    const id = Identifier.create(false, 9_999_999_999_999)
    expect(id.length).toBe(26)
  })
})
