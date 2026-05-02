import { describe, expect, test } from "bun:test"
import { checksum, hash, sampledChecksum } from "../src/util/encode"

describe("hash function", () => {
  test("empty produces deterministic output", async () => {
    const a = await hash("")
    const b = await hash("")
    expect(a).toBe(b)
  })
  test("returns 64 hex chars for SHA-256", async () => {
    const value = await hash("anything")
    expect(value).toMatch(/^[0-9a-f]{64}$/)
  })
  test("different inputs produce different outputs", async () => {
    expect(await hash("a")).not.toBe(await hash("b"))
  })
  test("works with unicode", async () => {
    const value = await hash("日本語")
    expect(value).toMatch(/^[0-9a-f]{64}$/)
  })
  test("works with long input", async () => {
    const value = await hash("x".repeat(10_000))
    expect(value).toMatch(/^[0-9a-f]{64}$/)
  })
  test("supports SHA-1", async () => {
    const value = await hash("abc", "SHA-1")
    expect(value).toMatch(/^[0-9a-f]{40}$/)
  })
  test("supports SHA-512", async () => {
    const value = await hash("abc", "SHA-512")
    expect(value).toMatch(/^[0-9a-f]{128}$/)
  })
  for (let i = 0; i < 30; i++) {
    test(`stable hash for value-${i}`, async () => {
      const value = `value-${i}`
      expect(await hash(value)).toBe(await hash(value))
    })
  }
})

describe("checksum (FNV-1a like)", () => {
  test("empty returns undefined", () => {
    expect(checksum("")).toBeUndefined()
  })
  test("returns base36 string for non-empty", () => {
    const value = checksum("abc")
    expect(typeof value).toBe("string")
    expect(value!.length).toBeGreaterThan(0)
  })
  test("same input returns same output", () => {
    expect(checksum("hello world")).toBe(checksum("hello world"))
  })
  test("different inputs return different outputs (typically)", () => {
    expect(checksum("hello")).not.toBe(checksum("world"))
  })
  test("works with very long input", () => {
    const value = checksum("x".repeat(100_000))
    expect(value).toBeDefined()
  })
  test("works with unicode", () => {
    expect(checksum("日本語")).toBeDefined()
  })
  test("base36 alphabet only", () => {
    const value = checksum("test value")!
    expect(/^[0-9a-z]+$/.test(value)).toBe(true)
  })
  for (let i = 0; i < 30; i++) {
    test(`stable checksum for value-${i}`, () => {
      const v = `value-${i}-content`
      expect(checksum(v)).toBe(checksum(v))
    })
  }
})

describe("sampledChecksum", () => {
  test("empty input returns undefined", () => {
    expect(sampledChecksum("")).toBeUndefined()
  })
  test("short content uses checksum directly", () => {
    const v = sampledChecksum("hello")
    expect(v).toBe(checksum("hello"))
  })
  test("content under default limit returns full checksum", () => {
    const v = "x".repeat(100)
    expect(sampledChecksum(v)).toBe(checksum(v))
  })
  test("content above limit returns sampled form", () => {
    const v = "x".repeat(1_000_000)
    const result = sampledChecksum(v)
    expect(result).toBeDefined()
    expect(result!.startsWith(`${v.length}:`)).toBe(true)
  })
  test("custom limit threshold", () => {
    const v = "x".repeat(100)
    const result = sampledChecksum(v, 50)
    expect(result!.startsWith("100:")).toBe(true)
  })
  test("contains 5 sample hashes joined by colon", () => {
    const v = "x".repeat(1_000_000)
    const result = sampledChecksum(v)
    const parts = result!.split(":")
    expect(parts).toHaveLength(6)
  })
  test("deterministic for same input", () => {
    const v = "x".repeat(1_000_000)
    expect(sampledChecksum(v)).toBe(sampledChecksum(v))
  })
  for (let i = 0; i < 20; i++) {
    test(`bulk sampled #${i}`, () => {
      const v = `bulk-${i}`.repeat(100)
      expect(sampledChecksum(v)).toBeDefined()
    })
  }
})
