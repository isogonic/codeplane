import { describe, expect, test } from "bun:test"
import { errorData, errorFormat, errorMessage } from "../src/util/error"

describe("errorMessage", () => {
  test("Error.message", () => expect(errorMessage(new Error("oops"))).toBe("oops"))
  test("Error with empty message uses name", () => {
    const e = new Error("")
    e.name = "CustomError"
    expect(errorMessage(e)).toBe("CustomError")
  })
  test("string errors", () => expect(errorMessage("just a string")).toBe("just a string"))
  test("number errors", () => expect(errorMessage(42)).toBe("42"))
  test("null", () => expect(errorMessage(null)).toBe("null"))
  test("undefined", () => expect(errorMessage(undefined)).toBe("undefined"))
  test("plain object with message", () =>
    expect(errorMessage({ message: "hi" })).toBe("hi"))
  test("nested data.message", () =>
    expect(errorMessage({ data: { message: "deep" } })).toBe("deep"))
  test("empty object falls back", () =>
    expect(errorMessage({})).not.toBe("[object Object]"))
  for (let i = 0; i < 30; i++) {
    test(`bulk #${i}`, () => expect(errorMessage(new Error(`msg-${i}`))).toBe(`msg-${i}`))
  }
})

describe("errorFormat", () => {
  test("Error returns stack or formatted", () => {
    const result = errorFormat(new Error("oops"))
    expect(result).toContain("oops")
  })
  test("string returns string", () => expect(errorFormat("plain")).toBe("plain"))
  test("number returns string", () => expect(errorFormat(42)).toBe("42"))
  test("plain object returns JSON", () => {
    const result = errorFormat({ a: 1 })
    expect(result).toContain('"a": 1')
  })
  test("circular returns fallback", () => {
    const obj: Record<string, unknown> = {}
    obj.self = obj
    expect(errorFormat(obj)).toContain("Unexpected")
  })
})

describe("errorData", () => {
  test("Error has type/message/stack", () => {
    const e = new Error("hi")
    const data = errorData(e)
    expect(data.message).toBe("hi")
    expect(typeof data.type).toBe("string")
  })
  test("Error.cause is formatted", () => {
    const cause = new Error("cause")
    const e = new Error("outer", { cause })
    const data = errorData(e)
    expect(data.cause).toContain("cause")
  })
  test("number returns type=number", () => {
    expect(errorData(42).type).toBe("number")
  })
  test("string returns type=string", () => {
    expect(errorData("hi").type).toBe("string")
  })
  test("plain object preserves keys as strings", () => {
    const data = errorData({ code: "X", message: "hi" })
    expect(data.code).toBe("X")
    expect(data.message).toBe("hi")
  })
  test("plain object converts non-string values", () => {
    const data = errorData({ count: 42, flag: true })
    expect(data.count).toBe(42)
    expect(data.flag).toBe(true)
  })
})
