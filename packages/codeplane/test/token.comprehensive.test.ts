import { describe, expect, test } from "bun:test"
import { Token } from "../src/util"

describe("Token.estimate", () => {
  test("empty string returns 0", () => expect(Token.estimate("")).toBe(0))
  test("undefined-like returns 0", () => {
    // @ts-expect-error - testing falsy
    expect(Token.estimate(undefined)).toBe(0)
  })
  test("4 chars returns 1", () => expect(Token.estimate("abcd")).toBe(1))
  test("8 chars returns 2", () => expect(Token.estimate("abcdefgh")).toBe(2))
  test("rounds correctly", () => {
    // 5 chars / 4 chars per token = 1.25 -> rounds to 1
    expect(Token.estimate("abcde")).toBe(1)
  })
  test("rounds up for 6", () => expect(Token.estimate("abcdef")).toBe(2))
  test("never negative", () => expect(Token.estimate("a")).toBeGreaterThanOrEqual(0))
  for (let i = 0; i < 50; i++) {
    test(`bulk estimate ${i}`, () => {
      const value = "x".repeat(i)
      expect(Token.estimate(value)).toBe(Math.max(0, Math.round(i / 4)))
    })
  }
})
