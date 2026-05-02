import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { fn } from "../../src/util/fn"

describe("fn (codeplane)", () => {
  const handler = fn(z.object({ x: z.number() }), (input) => input.x * 2)

  test("invokes handler with parsed input", () => {
    expect(handler({ x: 5 })).toBe(10)
  })

  test("throws on validation failure", () => {
    expect(() => handler({ x: "not a number" } as any)).toThrow()
  })

  test("force skips schema parsing", () => {
    expect(handler.force({ x: 5 })).toBe(10)
  })

  test("schema is exposed on the function", () => {
    expect(handler.schema).toBeDefined()
  })

  test("supports complex schemas with arrays", () => {
    const f = fn(z.object({ list: z.array(z.string()) }), (input) => input.list.length)
    expect(f({ list: ["a", "b"] })).toBe(2)
    expect(() => f({ list: [1, 2] } as any)).toThrow()
  })

  test("supports refinements", () => {
    const f = fn(z.number().min(10), (x) => x * 2)
    expect(f(20)).toBe(40)
    expect(() => f(5)).toThrow()
  })

  test("force allows invalid input", () => {
    const f = fn(z.number().min(10), (x) => x * 2)
    expect(f.force(5)).toBe(10)
  })

  test("returns result from callback", () => {
    const f = fn(z.string(), () => "constant")
    expect(f("anything")).toBe("constant")
  })

  test("supports nested object schemas", () => {
    const schema = z.object({ outer: z.object({ inner: z.boolean() }) })
    const f = fn(schema, (i) => i.outer.inner)
    expect(f({ outer: { inner: true } })).toBe(true)
    expect(f({ outer: { inner: false } })).toBe(false)
  })

  test("supports optional fields", () => {
    const f = fn(z.object({ x: z.number().optional() }), (i) => i.x ?? 0)
    expect(f({})).toBe(0)
    expect(f({ x: 5 })).toBe(5)
  })

  test("supports tuple schemas", () => {
    const f = fn(z.tuple([z.string(), z.number()]), ([s, n]) => `${s}-${n}`)
    expect(f(["a", 1])).toBe("a-1")
  })
})
