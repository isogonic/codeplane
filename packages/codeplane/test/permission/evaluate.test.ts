import { describe, expect, test } from "bun:test"
import { evaluate } from "../../src/permission/evaluate"

describe("permission evaluate", () => {
  test("returns ask with wildcard pattern when no rules", () => {
    expect(evaluate("read", "/some/file")).toEqual({
      action: "ask",
      permission: "read",
      pattern: "*",
    })
  })

  test("matches exact permission and pattern", () => {
    const result = evaluate("read", "/file.txt", [{ permission: "read", pattern: "/file.txt", action: "allow" }])
    expect(result.action).toBe("allow")
  })

  test("matches with wildcard permission", () => {
    const result = evaluate("read", "/file.txt", [{ permission: "*", pattern: "*", action: "deny" }])
    expect(result.action).toBe("deny")
  })

  test("later rule overrides earlier in same ruleset", () => {
    const result = evaluate("read", "/file.txt", [
      { permission: "read", pattern: "/file.txt", action: "allow" },
      { permission: "read", pattern: "/file.txt", action: "deny" },
    ])
    expect(result.action).toBe("deny")
  })

  test("later ruleset overrides earlier ruleset", () => {
    const result = evaluate(
      "read",
      "/file.txt",
      [{ permission: "read", pattern: "/file.txt", action: "allow" }],
      [{ permission: "read", pattern: "/file.txt", action: "deny" }],
    )
    expect(result.action).toBe("deny")
  })

  test("non-matching rules do not affect result", () => {
    const result = evaluate(
      "read",
      "/file.txt",
      [
        { permission: "write", pattern: "*", action: "deny" },
        { permission: "read", pattern: "/other", action: "deny" },
      ],
    )
    expect(result.action).toBe("ask")
  })

  test("falls through when permission does not match any rule", () => {
    expect(
      evaluate("foo", "/x", [{ permission: "bar", pattern: "*", action: "deny" }]).action,
    ).toBe("ask")
  })

  test("supports glob-style pattern", () => {
    const result = evaluate("read", "/src/file.ts", [
      { permission: "read", pattern: "/src/*", action: "allow" },
    ])
    expect(result.action).toBe("allow")
  })

  test("returns the matched rule object", () => {
    const rule = { permission: "read", pattern: "/file", action: "allow" as const }
    const result = evaluate("read", "/file", [rule])
    expect(result).toBe(rule)
  })

  test("handles empty rulesets", () => {
    expect(evaluate("read", "/file").action).toBe("ask")
  })

  test("handles multiple empty rulesets", () => {
    expect(evaluate("read", "/file", [], []).action).toBe("ask")
  })

  test("deny takes precedence at end of ruleset", () => {
    const result = evaluate("write", "/y", [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "*", pattern: "*", action: "deny" },
    ])
    expect(result.action).toBe("deny")
  })

  test("ask is the default", () => {
    expect(evaluate("read", "/file").action).toBe("ask")
  })

  test("rule pattern wildcard matches anything", () => {
    expect(evaluate("read", "/x/y/z", [{ permission: "*", pattern: "*", action: "allow" }]).action).toBe("allow")
  })
})
