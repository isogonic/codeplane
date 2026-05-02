import { describe, expect, test } from "bun:test"
import { estimate } from "../../src/util/token"

describe("estimate", () => {
  test("returns 0 for empty string", () => {
    expect(estimate("")).toBe(0)
  })

  test("rounds to nearest token", () => {
    expect(estimate("abcd")).toBe(1)
  })

  test("rounds 8 chars to 2 tokens", () => {
    expect(estimate("abcdefgh")).toBe(2)
  })

  test("rounds short strings", () => {
    expect(estimate("ab")).toBe(1)
    expect(estimate("a")).toBe(0)
  })

  test("rounds zero for empty input", () => {
    expect(estimate("")).toBe(0)
  })

  test("works with longer text", () => {
    expect(estimate("hello world")).toBe(3)
  })

  test("works with unicode", () => {
    expect(estimate("héllo")).toBe(1)
  })

  test("returns non-negative", () => {
    expect(estimate("a")).toBeGreaterThanOrEqual(0)
  })

  test("monotonic in input length", () => {
    expect(estimate("abc")).toBeLessThanOrEqual(estimate("abcdef"))
    expect(estimate("a")).toBeLessThanOrEqual(estimate("ab"))
  })

  test("100 chars yields 25 tokens", () => {
    expect(estimate("x".repeat(100))).toBe(25)
  })

  test("400 chars yields 100 tokens", () => {
    expect(estimate("x".repeat(400))).toBe(100)
  })

  test("undefined treated as empty", () => {
    expect(estimate(undefined as any)).toBe(0)
  })
})
