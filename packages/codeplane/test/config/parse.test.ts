import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { ConfigParse } from "../../src/config/parse"

describe("ConfigParse.jsonc", () => {
  test("parses simple JSON", () => {
    expect(ConfigParse.jsonc('{"a": 1}', "test.json")).toEqual({ a: 1 })
  })

  test("parses JSON arrays", () => {
    expect(ConfigParse.jsonc("[1,2,3]", "test.json")).toEqual([1, 2, 3])
  })

  test("parses JSON with comments", () => {
    expect(ConfigParse.jsonc('{ /* comment */ "a": 1 }', "test.json")).toEqual({ a: 1 })
  })

  test("parses JSON with line comments", () => {
    expect(ConfigParse.jsonc('{\n  "a": 1 // comment\n}', "test.json")).toEqual({ a: 1 })
  })

  test("allows trailing commas in objects", () => {
    expect(ConfigParse.jsonc('{ "a": 1, }', "test.json")).toEqual({ a: 1 })
  })

  test("allows trailing commas in arrays", () => {
    expect(ConfigParse.jsonc("[1, 2, 3,]", "test.json")).toEqual([1, 2, 3])
  })

  test("returns boolean values", () => {
    expect(ConfigParse.jsonc("true", "test.json")).toBe(true)
    expect(ConfigParse.jsonc("false", "test.json")).toBe(false)
  })

  test("returns null", () => {
    expect(ConfigParse.jsonc("null", "test.json")).toBe(null)
  })

  test("returns numbers", () => {
    expect(ConfigParse.jsonc("42", "test.json")).toBe(42)
    expect(ConfigParse.jsonc("3.14", "test.json")).toBe(3.14)
  })

  test("returns strings", () => {
    expect(ConfigParse.jsonc('"hello"', "test.json")).toBe("hello")
  })

  test("throws JsonError on invalid input", () => {
    expect(() => ConfigParse.jsonc("{ broken", "test.json")).toThrow()
  })

  test("supports nested objects", () => {
    expect(ConfigParse.jsonc('{"a": {"b": {"c": 1}}}', "test.json")).toEqual({ a: { b: { c: 1 } } })
  })

  test("error includes filepath info in data", () => {
    try {
      ConfigParse.jsonc("{ broken", "myfile.json")
      throw new Error("expected throw")
    } catch (e: any) {
      expect(e.data?.path ?? "").toBe("myfile.json")
    }
  })

  test("empty object", () => {
    expect(ConfigParse.jsonc("{}", "test.json")).toEqual({})
  })

  test("empty array", () => {
    expect(ConfigParse.jsonc("[]", "test.json")).toEqual([])
  })

  test("preserves nested arrays", () => {
    expect(ConfigParse.jsonc("[[1,2],[3]]", "test.json")).toEqual([[1, 2], [3]])
  })

  test("preserves unicode strings", () => {
    expect(ConfigParse.jsonc('"héllo"', "test.json")).toBe("héllo")
  })
})

describe("ConfigParse.schema", () => {
  test("returns parsed data when valid", () => {
    const schema = z.object({ a: z.number() })
    expect(ConfigParse.schema(schema, { a: 1 }, "src")).toEqual({ a: 1 })
  })

  test("throws InvalidError when invalid", () => {
    const schema = z.object({ a: z.number() })
    expect(() => ConfigParse.schema(schema, { a: "x" }, "src")).toThrow()
  })

  test("supports primitive schemas", () => {
    expect(ConfigParse.schema(z.number(), 42, "src")).toBe(42)
  })

  test("rejects mismatched primitive", () => {
    expect(() => ConfigParse.schema(z.string(), 42, "src")).toThrow()
  })

  test("supports array schemas", () => {
    expect(ConfigParse.schema(z.array(z.string()), ["a", "b"], "src")).toEqual(["a", "b"])
  })

  test("rejects mismatched array element", () => {
    expect(() => ConfigParse.schema(z.array(z.number()), [1, "x"], "src")).toThrow()
  })

  test("preserves source path on error", () => {
    try {
      ConfigParse.schema(z.string(), 42, "myfile.json")
      throw new Error("expected throw")
    } catch (e: any) {
      expect(e.data?.path ?? e.message).toContain("myfile.json")
    }
  })
})
