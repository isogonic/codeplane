import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { fn } from "../../src/util/fn"

describe("fn", () => {
  const handler = fn(z.object({ x: z.number() }), (input) => input.x + 1)

  test("invokes handler with parsed input", () => {
    expect(handler({ x: 5 })).toBe(6)
  })

  test("throws on validation failure", () => {
    expect(() => handler({ x: "not a number" } as any)).toThrow()
  })

  test("force skips schema parsing", () => {
    expect(handler.force({ x: 5 })).toBe(6)
  })

  test("schema is exposed on the function", () => {
    expect(handler.schema).toBeDefined()
    expect(typeof handler.schema.parse).toBe("function")
  })

  test("supports complex schemas", () => {
    const f = fn(z.object({ list: z.array(z.string()) }), (input) => input.list.length)
    expect(f({ list: ["a", "b"] })).toBe(2)
    expect(() => f({ list: [1, 2] } as any)).toThrow()
  })

  test("supports z.string()", () => {
    const f = fn(z.string(), (s) => s.toUpperCase())
    expect(f("hello")).toBe("HELLO")
    expect(() => f(123 as any)).toThrow()
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

  test("preserves callback context", () => {
    let captured: any
    const f = fn(z.object({ a: z.number() }), (input) => {
      captured = input
      return null
    })
    f({ a: 1 })
    expect(captured).toEqual({ a: 1 })
  })

  test("schema field is the same z.ZodType", () => {
    const schema = z.object({ x: z.number() })
    const f = fn(schema, (i) => i.x)
    expect(f.schema).toBe(schema)
  })
})
