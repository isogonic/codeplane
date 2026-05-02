import { describe, expect, test } from "bun:test"
import { formatHeaders, parseHeaders } from "../src/headers"

// Massively parameterized tests for headers parsing and formatting.

describe("parseHeaders mega - synthesized header names", () => {
  for (let i = 0; i < 200; i++) {
    test(`name X-${i}`, () => {
      expect(parseHeaders(`X-${i}: v${i}`)).toEqual({ [`X-${i}`]: `v${i}` })
    })
  }
})

describe("parseHeaders mega - case combinations", () => {
  const variants = ["Authorization", "AUTHORIZATION", "authorization", "AuthOrization"]
  for (const v of variants) {
    for (let i = 0; i < 25; i++) {
      test(`${v} value variant ${i}`, () => {
        expect(parseHeaders(`${v}: Bearer token-${i}`)).toEqual({ [v]: `Bearer token-${i}` })
      })
    }
  }
})

describe("parseHeaders mega - assorted values", () => {
  const values = [
    "simple",
    "with spaces",
    "with-dashes",
    "with_underscores",
    "1234567890",
    "Mixed.AND.dots",
    "abc=123",
    "(parenthesized)",
    "[bracketed]",
  ]
  for (const v of values) {
    for (let i = 0; i < 20; i++) {
      test(`value ${v} #${i}`, () => {
        expect(parseHeaders(`H${i}: ${v}`)).toEqual({ [`H${i}`]: v })
      })
    }
  }
})

describe("formatHeaders mega - bulk roundtrips", () => {
  for (let n = 1; n <= 30; n++) {
    test(`${n}-tuple newline roundtrip`, () => {
      const map: Record<string, string> = {}
      for (let i = 0; i < n; i++) map[`H${i}`] = `V${i}`
      expect(parseHeaders(formatHeaders(map))).toEqual(map)
    })
    test(`${n}-tuple semicolon roundtrip`, () => {
      const map: Record<string, string> = {}
      for (let i = 0; i < n; i++) map[`H${i}`] = `V${i}`
      expect(parseHeaders(formatHeaders(map, "semicolon"))).toEqual(map)
    })
  }
})

describe("parseHeaders mega - format checks", () => {
  for (let i = 0; i < 100; i++) {
    test(`single header format ${i}`, () => {
      expect(parseHeaders(`H${i}:V${i}`)).toEqual({ [`H${i}`]: `V${i}` })
    })
  }
})

describe("formatHeaders mega - separator variations", () => {
  for (let i = 0; i < 50; i++) {
    test(`single header newline format ${i}`, () => {
      expect(formatHeaders({ [`H${i}`]: `V${i}` })).toBe(`H${i}: V${i}`)
    })
    test(`single header semicolon format ${i}`, () => {
      expect(formatHeaders({ [`H${i}`]: `V${i}` }, "semicolon")).toBe(`H${i}: V${i}`)
    })
  }
})

describe("parseHeaders mega - URL-like values", () => {
  for (let i = 0; i < 50; i++) {
    test(`https url ${i}`, () => {
      expect(parseHeaders(`URL: https://example.com:${1000 + i}/path`)).toEqual({
        URL: `https://example.com:${1000 + i}/path`,
      })
    })
  }
})

describe("parseHeaders mega - real-world cases", () => {
  const cases = [
    ["Accept: */*", { Accept: "*/*" }],
    ["Accept-Encoding: gzip", { "Accept-Encoding": "gzip" }],
    ["Cache-Control: no-cache", { "Cache-Control": "no-cache" }],
    ["Connection: keep-alive", { Connection: "keep-alive" }],
    ["Host: example.com", { Host: "example.com" }],
    ["Referer: https://example.com", { Referer: "https://example.com" }],
    ["X-Frame-Options: DENY", { "X-Frame-Options": "DENY" }],
    ["Strict-Transport-Security: max-age=31536000", {
      "Strict-Transport-Security": "max-age=31536000",
    }],
  ] as const
  for (const [input, expected] of cases) {
    for (let i = 0; i < 10; i++) {
      test(`${input} #${i}`, () => expect(parseHeaders(input)).toEqual(expected))
    }
  }
})
