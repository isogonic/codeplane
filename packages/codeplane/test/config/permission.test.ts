import { describe, expect, test } from "bun:test"
import { ConfigPermission } from "../../src/config/permission"

describe("ConfigPermission.Action.zod", () => {
  test("accepts 'ask'", () => {
    expect(ConfigPermission.Action.zod.parse("ask")).toBe("ask")
  })

  test("accepts 'allow'", () => {
    expect(ConfigPermission.Action.zod.parse("allow")).toBe("allow")
  })

  test("accepts 'deny'", () => {
    expect(ConfigPermission.Action.zod.parse("deny")).toBe("deny")
  })

  test("rejects unknown actions", () => {
    expect(() => ConfigPermission.Action.zod.parse("yes")).toThrow()
  })

  test("rejects numeric action", () => {
    expect(() => ConfigPermission.Action.zod.parse(1)).toThrow()
  })

  test("rejects null action", () => {
    expect(() => ConfigPermission.Action.zod.parse(null)).toThrow()
  })

  test("rejects empty string", () => {
    expect(() => ConfigPermission.Action.zod.parse("")).toThrow()
  })
})

describe("ConfigPermission.Object.zod", () => {
  test("accepts simple key->action map", () => {
    expect(ConfigPermission.Object.zod.parse({ a: "ask" })).toEqual({ a: "ask" })
  })

  test("accepts mix of actions", () => {
    expect(
      ConfigPermission.Object.zod.parse({ read: "allow", write: "deny", run: "ask" }),
    ).toEqual({ read: "allow", write: "deny", run: "ask" })
  })

  test("rejects invalid action values", () => {
    expect(() => ConfigPermission.Object.zod.parse({ a: "maybe" })).toThrow()
  })

  test("accepts empty object", () => {
    expect(ConfigPermission.Object.zod.parse({})).toEqual({})
  })
})

describe("ConfigPermission.Rule.zod", () => {
  test("accepts plain action", () => {
    expect(ConfigPermission.Rule.zod.parse("allow")).toBe("allow")
  })

  test("accepts object form", () => {
    expect(ConfigPermission.Rule.zod.parse({ a: "ask" })).toEqual({ a: "ask" })
  })

  test("rejects invalid mixed types", () => {
    expect(() => ConfigPermission.Rule.zod.parse([1, 2, 3])).toThrow()
  })

  test("rejects invalid action in object", () => {
    expect(() => ConfigPermission.Rule.zod.parse({ a: 1 })).toThrow()
  })
})

describe("ConfigPermission.Info.zod", () => {
  test("normalises shorthand action to {*: action}", () => {
    const result = ConfigPermission.Info.zod.parse("allow")
    expect(result).toEqual({ "*": "allow" })
  })

  test("preserves object form when input is object", () => {
    const input = { read: "allow", edit: "deny" }
    expect(ConfigPermission.Info.zod.parse(input as any)).toEqual(input as any)
  })

  test("rejects garbage shorthand", () => {
    expect(() => ConfigPermission.Info.zod.parse("totally-bogus")).toThrow()
  })

  test("supports per-tool permissions", () => {
    const input = { tools: { write: "ask" } }
    const result = ConfigPermission.Info.zod.parse(input as any)
    expect(result).toEqual(input as any)
  })

  test("supports todowrite=action", () => {
    const result = ConfigPermission.Info.zod.parse({ todowrite: "ask" } as any)
    expect(result.todowrite).toBe("ask")
  })

  test("supports question=action", () => {
    const result = ConfigPermission.Info.zod.parse({ question: "deny" } as any)
    expect(result.question).toBe("deny")
  })

  test("supports webfetch=action", () => {
    const result = ConfigPermission.Info.zod.parse({ webfetch: "allow" } as any)
    expect(result.webfetch).toBe("allow")
  })

  test("supports websearch=action", () => {
    const result = ConfigPermission.Info.zod.parse({ websearch: "ask" } as any)
    expect(result.websearch).toBe("ask")
  })

  test("supports custom keys", () => {
    const input = { custom_tool_xyz: "deny" }
    expect(ConfigPermission.Info.zod.parse(input as any)).toEqual(input as any)
  })
})
