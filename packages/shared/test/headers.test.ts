import { describe, expect, test } from "bun:test"
import { formatHeaders, parseHeaders } from "../src/headers"

describe("parseHeaders", () => {
  test("accepts newline-separated input (Desktop format)", () => {
    expect(parseHeaders("Authorization: Bearer abc\nX-Foo: bar")).toEqual({
      Authorization: "Bearer abc",
      "X-Foo": "bar",
    })
  })

  test("accepts semicolon-separated input (TUI format)", () => {
    expect(parseHeaders("Authorization: Bearer abc; X-Foo: bar")).toEqual({
      Authorization: "Bearer abc",
      "X-Foo": "bar",
    })
  })

  test("ignores blanks and malformed entries", () => {
    expect(parseHeaders("\n\nA: b\n\n   ;:nope;C: d ;")).toEqual({ A: "b", C: "d" })
  })

  test("returns {} for empty input", () => {
    expect(parseHeaders("")).toEqual({})
  })

  test("drops entries with control characters after trimming", () => {
    expect(parseHeaders("Good: ok\nBad\0Name: no\nAlso-Bad: no\0pe")).toEqual({ Good: "ok" })
  })
})

describe("formatHeaders", () => {
  test("newline separator by default", () => {
    expect(formatHeaders({ A: "1", B: "2" })).toBe("A: 1\nB: 2")
  })

  test("semicolon separator on request", () => {
    expect(formatHeaders({ A: "1", B: "2" }, "semicolon")).toBe("A: 1; B: 2")
  })

  test("undefined input renders empty", () => {
    expect(formatHeaders(undefined)).toBe("")
  })
})
