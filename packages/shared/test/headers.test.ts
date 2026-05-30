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

  test("preserves semicolons inside cookie and content-type values", () => {
    expect(parseHeaders("Cookie: a=1; b=2; X-Env: prod\nContent-Type: text/plain; charset=utf-8")).toEqual({
      Cookie: "a=1; b=2",
      "X-Env": "prod",
      "Content-Type": "text/plain; charset=utf-8",
    })
  })

  test("does not split a value's parenthesised tokens (Firefox User-Agent rv:)", () => {
    expect(
      parseHeaders("User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0"),
    ).toEqual({
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0",
    })
  })

  test("still splits real second headers that follow a parenthesised value", () => {
    expect(parseHeaders("User-Agent: Mozilla/5.0 (X11; rv:109.0); X-Foo: bar")).toEqual({
      "User-Agent": "Mozilla/5.0 (X11; rv:109.0)",
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
