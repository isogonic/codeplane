import { describe, expect, test } from "bun:test"
import { formatHeaders, parseHeaders } from "../src/headers"

describe("parseHeaders - basic", () => {
  test("empty string", () => expect(parseHeaders("")).toEqual({}))
  test("only whitespace", () => expect(parseHeaders("   ")).toEqual({}))
  test("only newlines", () => expect(parseHeaders("\n\n\n")).toEqual({}))
  test("only semicolons", () => expect(parseHeaders(";;;")).toEqual({}))
  test("only spaces and tabs", () => expect(parseHeaders("\t \t ")).toEqual({}))
  test("single header newline", () => expect(parseHeaders("A: B")).toEqual({ A: "B" }))
  test("single header semicolon", () => expect(parseHeaders("A: B;")).toEqual({ A: "B" }))
  test("two headers newline", () => expect(parseHeaders("A: 1\nB: 2")).toEqual({ A: "1", B: "2" }))
  test("two headers semicolon", () => expect(parseHeaders("A: 1; B: 2")).toEqual({ A: "1", B: "2" }))
  test("three headers newline", () =>
    expect(parseHeaders("A: 1\nB: 2\nC: 3")).toEqual({ A: "1", B: "2", C: "3" }))
  test("three headers semicolon", () =>
    expect(parseHeaders("A: 1; B: 2; C: 3")).toEqual({ A: "1", B: "2", C: "3" }))
  test("mixed separators", () =>
    expect(parseHeaders("A: 1\nB: 2; C: 3")).toEqual({ A: "1", B: "2", C: "3" }))
  test("colon in value", () =>
    expect(parseHeaders("URL: https://example.com:8080")).toEqual({
      URL: "https://example.com:8080",
    }))
  test("missing colon", () => expect(parseHeaders("just-a-word")).toEqual({}))
  test("double colon", () => expect(parseHeaders("A:: B")).toEqual({ A: ": B" }))
  test("empty name", () => expect(parseHeaders(": value")).toEqual({}))
  test("empty value", () => expect(parseHeaders("Name:")).toEqual({}))
  test("multiple empty fields between", () =>
    expect(parseHeaders("\n\n\nA: B\n\n\n")).toEqual({ A: "B" }))
  test("CR LF", () => expect(parseHeaders("A: 1\r\nB: 2")).toEqual({ A: "1", B: "2" }))
  test("CR only", () => expect(parseHeaders("A: 1\rB: 2")).toEqual({ A: "1", B: "2" }))
  test("trailing semicolon", () => expect(parseHeaders("A: 1;")).toEqual({ A: "1" }))
  test("leading semicolon", () => expect(parseHeaders(";A: 1")).toEqual({ A: "1" }))
})

describe("parseHeaders - whitespace handling", () => {
  test("leading space in name", () => expect(parseHeaders(" A: B")).toEqual({ A: "B" }))
  test("trailing space in name", () => expect(parseHeaders("A : B")).toEqual({ A: "B" }))
  test("leading space in value", () => expect(parseHeaders("A:  B")).toEqual({ A: "B" }))
  test("trailing space in value", () => expect(parseHeaders("A: B ")).toEqual({ A: "B" }))
  test("tabs around value", () => expect(parseHeaders("A:\tB\t")).toEqual({ A: "B" }))
  test("tabs in name", () => expect(parseHeaders("\tA: B")).toEqual({ A: "B" }))
  test("space before colon and after", () => expect(parseHeaders("A : B")).toEqual({ A: "B" }))
  test("mixed tabs/spaces", () =>
    expect(parseHeaders(" \tA \t: \tB\t ")).toEqual({ A: "B" }))
  test("preserves internal value spaces", () =>
    expect(parseHeaders("A: hello world")).toEqual({ A: "hello world" }))
  test("preserves multiple internal spaces", () =>
    expect(parseHeaders("A: a  b  c")).toEqual({ A: "a  b  c" }))
  test("preserves quoted-looking value", () =>
    expect(parseHeaders('A: "value with spaces"')).toEqual({
      A: '"value with spaces"',
    }))
})

describe("parseHeaders - duplicates and overwrites", () => {
  test("duplicate name overwrites first", () =>
    expect(parseHeaders("A: 1\nA: 2")).toEqual({ A: "2" }))
  test("triple duplicate keeps last", () =>
    expect(parseHeaders("A: 1\nA: 2\nA: 3")).toEqual({ A: "3" }))
  test("case-sensitive names are different", () =>
    expect(parseHeaders("A: 1\na: 2")).toEqual({ A: "1", a: "2" }))
  test("duplicate semicolon-separated", () =>
    expect(parseHeaders("A: 1; A: 2")).toEqual({ A: "2" }))
})

describe("parseHeaders - real-world headers", () => {
  test("Authorization Bearer", () =>
    expect(parseHeaders("Authorization: Bearer abc.def.ghi")).toEqual({
      Authorization: "Bearer abc.def.ghi",
    }))
  test("Authorization Basic with base64", () =>
    expect(parseHeaders("Authorization: Basic dXNlcjpwYXNz")).toEqual({
      Authorization: "Basic dXNlcjpwYXNz",
    }))
  test("Content-Type with charset (semicolon stays in value)", () =>
    expect(parseHeaders("Content-Type: application/json; charset=utf-8")).toEqual({
      "Content-Type": "application/json; charset=utf-8",
    }))
  test("User-Agent string (semicolon stays in value)", () =>
    expect(parseHeaders("User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64)")).toEqual({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64)",
    }))
  test("Cookie with multiple pairs (semicolons stay in value)", () =>
    expect(parseHeaders("Cookie: CF_Authorization=jwt; CF_AppSession=sess")).toEqual({
      Cookie: "CF_Authorization=jwt; CF_AppSession=sess",
    }))
  test("multiple headers on one line still split on '; name:'", () =>
    expect(parseHeaders("Cookie: a=1; b=2; X-API-Key: secret")).toEqual({
      Cookie: "a=1; b=2",
      "X-API-Key": "secret",
    }))
  test("X-Forwarded-For", () =>
    expect(parseHeaders("X-Forwarded-For: 192.168.1.1")).toEqual({
      "X-Forwarded-For": "192.168.1.1",
    }))
  test("Cookie header", () =>
    expect(parseHeaders("Cookie: session=abc123")).toEqual({
      Cookie: "session=abc123",
    }))
  test("Accept multiple types", () =>
    expect(parseHeaders("Accept: text/html, application/xhtml+xml")).toEqual({
      Accept: "text/html, application/xhtml+xml",
    }))
})

describe("parseHeaders - special characters", () => {
  test("unicode name", () => expect(parseHeaders("X-名前: value")).toEqual({ "X-名前": "value" }))
  test("unicode value", () => expect(parseHeaders("X-Note: 日本語")).toEqual({ "X-Note": "日本語" }))
  test("emoji in value", () =>
    expect(parseHeaders("X-Emoji: 🚀✨")).toEqual({ "X-Emoji": "🚀✨" }))
  test("special chars in value", () =>
    expect(parseHeaders("X-Special: !@#$%^&*()")).toEqual({
      "X-Special": "!@#$%^&*()",
    }))
  test("equals in value", () =>
    expect(parseHeaders("X-Equation: x = y + 1")).toEqual({ "X-Equation": "x = y + 1" }))
  test("brackets in value", () =>
    expect(parseHeaders("X-JSON: [1,2,3]")).toEqual({ "X-JSON": "[1,2,3]" }))
  test("braces in value", () =>
    expect(parseHeaders("X-JSON: {a:1}")).toEqual({ "X-JSON": "{a:1}" }))
  test("backslash in value", () =>
    expect(parseHeaders("X-Path: C:\\Users")).toEqual({ "X-Path": "C:\\Users" }))
  test("quotes in value", () =>
    expect(parseHeaders('X-Q: "hi" said')).toEqual({ "X-Q": '"hi" said' }))
})

describe("parseHeaders - large inputs", () => {
  test("many headers newlines", () => {
    const input = Array.from({ length: 100 }, (_, i) => `H${i}: V${i}`).join("\n")
    const result = parseHeaders(input)
    expect(Object.keys(result)).toHaveLength(100)
    expect(result.H0).toBe("V0")
    expect(result.H99).toBe("V99")
  })
  test("many headers semicolons", () => {
    const input = Array.from({ length: 100 }, (_, i) => `H${i}: V${i}`).join("; ")
    const result = parseHeaders(input)
    expect(Object.keys(result)).toHaveLength(100)
  })
  test("very long value", () => {
    const long = "x".repeat(10_000)
    expect(parseHeaders(`A: ${long}`)).toEqual({ A: long })
  })
  test("very long name", () => {
    const long = "X".repeat(1_000)
    expect(parseHeaders(`${long}: v`)).toEqual({ [long]: "v" })
  })
})

describe("parseHeaders - malformed inputs", () => {
  test("just colon", () => expect(parseHeaders(":")).toEqual({}))
  test("just colons", () => expect(parseHeaders(":::")).toEqual({}))
  test("name with only whitespace before colon", () =>
    expect(parseHeaders("   : value")).toEqual({}))
  test("value with only whitespace after colon", () =>
    expect(parseHeaders("Name:    ")).toEqual({}))
  test("multiple colons in line", () =>
    expect(parseHeaders("A: B: C: D")).toEqual({ A: "B: C: D" }))
  test("ignores stray colons in line", () =>
    expect(parseHeaders("\n:\nA: 1\n:\n")).toEqual({ A: "1" }))
  test("backslash newline", () =>
    expect(parseHeaders("A: B\\nC")).toEqual({ A: "B\\nC" }))
})

describe("formatHeaders - basic", () => {
  test("undefined renders empty string", () => expect(formatHeaders(undefined)).toBe(""))
  test("empty object renders empty string", () => expect(formatHeaders({})).toBe(""))
  test("single header default", () => expect(formatHeaders({ A: "1" })).toBe("A: 1"))
  test("single header newline explicit", () =>
    expect(formatHeaders({ A: "1" }, "newline")).toBe("A: 1"))
  test("single header semicolon", () =>
    expect(formatHeaders({ A: "1" }, "semicolon")).toBe("A: 1"))
  test("two headers newline", () =>
    expect(formatHeaders({ A: "1", B: "2" })).toBe("A: 1\nB: 2"))
  test("two headers semicolon", () =>
    expect(formatHeaders({ A: "1", B: "2" }, "semicolon")).toBe("A: 1; B: 2"))
  test("preserves insertion order", () => {
    const value = formatHeaders({ B: "2", A: "1" })
    expect(value).toBe("B: 2\nA: 1")
  })
  test("three headers newline", () =>
    expect(formatHeaders({ A: "1", B: "2", C: "3" })).toBe("A: 1\nB: 2\nC: 3"))
  test("three headers semicolon", () =>
    expect(formatHeaders({ A: "1", B: "2", C: "3" }, "semicolon")).toBe("A: 1; B: 2; C: 3"))
})

describe("formatHeaders - special values", () => {
  test("empty value formats anyway", () => expect(formatHeaders({ A: "" })).toBe("A: "))
  test("space value", () => expect(formatHeaders({ A: " " })).toBe("A:  "))
  test("multi-word value", () =>
    expect(formatHeaders({ Hello: "world friend" })).toBe("Hello: world friend"))
  test("unicode value", () => expect(formatHeaders({ A: "日本" })).toBe("A: 日本"))
  test("value with newline (raw)", () =>
    expect(formatHeaders({ A: "x\ny" })).toBe("A: x\ny"))
  test("value with semicolon (raw)", () =>
    expect(formatHeaders({ A: "x;y" })).toBe("A: x;y"))
  test("value containing colon", () =>
    expect(formatHeaders({ URL: "http://example.com" })).toBe("URL: http://example.com"))
})

describe("parseHeaders + formatHeaders roundtrips", () => {
  const cases: Array<Record<string, string>> = [
    { A: "1" },
    { A: "1", B: "2" },
    { Authorization: "Bearer abc" },
    { "X-Custom-1": "v1", "X-Custom-2": "v2", "X-Custom-3": "v3" },
    { Long: "x".repeat(500) },
  ]
  for (const value of cases) {
    test(`roundtrip newline: ${JSON.stringify(value)}`, () =>
      expect(parseHeaders(formatHeaders(value))).toEqual(value))
    test(`roundtrip semicolon: ${JSON.stringify(value)}`, () =>
      expect(parseHeaders(formatHeaders(value, "semicolon"))).toEqual(value))
  }
})

describe("parseHeaders edge: lots of randomized inputs", () => {
  for (let i = 0; i < 50; i++) {
    test(`bulk #${i} parses without throwing`, () => {
      const random = `Header-${i}: value-${i}`
      expect(parseHeaders(random)).toEqual({ [`Header-${i}`]: `value-${i}` })
    })
  }
  for (let i = 0; i < 50; i++) {
    test(`bulk semicolon #${i} parses without throwing`, () => {
      const random = `H${i}: V${i}; H${i}b: V${i}b`
      expect(parseHeaders(random)).toEqual({
        [`H${i}`]: `V${i}`,
        [`H${i}b`]: `V${i}b`,
      })
    })
  }
})

describe("formatHeaders bulk", () => {
  for (let n = 1; n <= 50; n++) {
    test(`format with ${n} headers newline`, () => {
      const map: Record<string, string> = {}
      for (let i = 0; i < n; i++) map[`H${i}`] = `V${i}`
      const text = formatHeaders(map)
      expect(text.split("\n")).toHaveLength(n)
    })
    test(`format with ${n} headers semicolon`, () => {
      const map: Record<string, string> = {}
      for (let i = 0; i < n; i++) map[`H${i}`] = `V${i}`
      const text = formatHeaders(map, "semicolon")
      expect(text.split("; ")).toHaveLength(n)
    })
  }
})
