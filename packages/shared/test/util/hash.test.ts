import { describe, expect, test } from "bun:test"
import { Hash } from "../../src/util/hash"

describe("Hash.fast", () => {
  test("returns 40-char hex string for empty string", () => {
    expect(Hash.fast("")).toMatch(/^[0-9a-f]{40}$/)
  })

  test("known SHA-1 hash for empty string", () => {
    expect(Hash.fast("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709")
  })

  test("known SHA-1 hash for 'abc'", () => {
    expect(Hash.fast("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d")
  })

  test("same input produces same hash", () => {
    expect(Hash.fast("hello")).toBe(Hash.fast("hello"))
  })

  test("different inputs produce different hashes", () => {
    expect(Hash.fast("hello")).not.toBe(Hash.fast("world"))
  })

  test("works with Buffer input", () => {
    expect(Hash.fast(Buffer.from("hello"))).toBe(Hash.fast("hello"))
  })

  test("works with empty Buffer", () => {
    expect(Hash.fast(Buffer.from(""))).toBe(Hash.fast(""))
  })

  test("works with binary data", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0xff])
    expect(Hash.fast(buf)).toMatch(/^[0-9a-f]{40}$/)
  })

  test("works with utf-8 unicode", () => {
    expect(Hash.fast("héllo")).toMatch(/^[0-9a-f]{40}$/)
  })

  test("works with very long input", () => {
    expect(Hash.fast("x".repeat(100_000))).toMatch(/^[0-9a-f]{40}$/)
  })

  test("output is lowercase hex", () => {
    const h = Hash.fast("test")
    expect(h).toBe(h.toLowerCase())
  })
})
