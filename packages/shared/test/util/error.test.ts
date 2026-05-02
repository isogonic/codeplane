import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { NamedError } from "../../src/util/error"

describe("NamedError.hasName", () => {
  test("returns true when error has matching name", () => {
    const e = new Error("oops")
    e.name = "Custom"
    expect(NamedError.hasName(e, "Custom")).toBe(true)
  })

  test("returns false when error has different name", () => {
    const e = new Error("oops")
    e.name = "Other"
    expect(NamedError.hasName(e, "Custom")).toBe(false)
  })

  test("returns false for null", () => {
    expect(NamedError.hasName(null, "Custom")).toBe(false)
  })

  test("returns false for undefined", () => {
    expect(NamedError.hasName(undefined, "Custom")).toBe(false)
  })

  test("returns false for primitive", () => {
    expect(NamedError.hasName("string", "Custom")).toBe(false)
    expect(NamedError.hasName(42, "Custom")).toBe(false)
  })

  test("returns false for plain object without name property", () => {
    expect(NamedError.hasName({}, "Custom")).toBe(false)
  })

  test("returns true for plain object with name property", () => {
    expect(NamedError.hasName({ name: "Custom" }, "Custom")).toBe(true)
  })

  test("returns false when name is not string", () => {
    expect(NamedError.hasName({ name: 42 }, "42")).toBe(false)
  })
})

describe("NamedError.create", () => {
  const MyErr = NamedError.create(
    "MyErr",
    z.object({
      code: z.string(),
    }),
  )

  test("instances have the configured name", () => {
    const e = new MyErr({ code: "x" })
    expect(e.name).toBe("MyErr")
  })

  test("instances are Error instances", () => {
    const e = new MyErr({ code: "x" })
    expect(e instanceof Error).toBe(true)
  })

  test("instances expose data", () => {
    const e = new MyErr({ code: "abc" })
    expect(e.data).toEqual({ code: "abc" })
  })

  test("instances toObject returns name and data", () => {
    const e = new MyErr({ code: "abc" })
    expect(e.toObject()).toEqual({ name: "MyErr", data: { code: "abc" } })
  })

  test("schema returns the configured zod schema", () => {
    const e = new MyErr({ code: "abc" })
    expect(typeof e.schema()).toBe("object")
  })

  test("isInstance returns true for matching", () => {
    const e = new MyErr({ code: "x" })
    expect(MyErr.isInstance(e)).toBe(true)
  })

  test("isInstance returns false for non-error", () => {
    expect(MyErr.isInstance({})).toBe(false)
    expect(MyErr.isInstance({ name: "Other" })).toBe(false)
  })

  test("isInstance returns true for any object with matching name", () => {
    expect(MyErr.isInstance({ name: "MyErr" })).toBe(true)
  })

  test("schema validates valid input", () => {
    const e = new MyErr({ code: "x" })
    const parsed = e.schema().safeParse({ name: "MyErr", data: { code: "x" } })
    expect(parsed.success).toBe(true)
  })

  test("schema rejects wrong name literal", () => {
    const e = new MyErr({ code: "x" })
    const parsed = e.schema().safeParse({ name: "WRONG", data: { code: "x" } })
    expect(parsed.success).toBe(false)
  })

  test("constructor name is set", () => {
    expect(MyErr.name).toBe("MyErr")
  })

  test("error message reflects name", () => {
    const e = new MyErr({ code: "x" })
    expect(e.message).toBe("MyErr")
  })

  test("toObject returns plain object literal", () => {
    const e = new MyErr({ code: "z" })
    const obj = e.toObject()
    expect(typeof obj).toBe("object")
    expect(obj.name).toBe("MyErr")
    expect(obj.data).toEqual({ code: "z" })
  })

  test("two different error classes don't cross-match", () => {
    const A = NamedError.create("A", z.object({ x: z.string() }))
    const B = NamedError.create("B", z.object({ x: z.string() }))
    const a = new A({ x: "1" })
    expect(B.isInstance(a)).toBe(false)
    expect(A.isInstance(a)).toBe(true)
  })
})

describe("NamedError.Unknown", () => {
  test("Unknown error has name UnknownError", () => {
    const e = new NamedError.Unknown({ message: "oops" })
    expect(e.name).toBe("UnknownError")
  })

  test("Unknown error stores message data", () => {
    const e = new NamedError.Unknown({ message: "oops" })
    expect(e.data).toEqual({ message: "oops" })
  })

  test("Unknown error toObject returns proper shape", () => {
    const e = new NamedError.Unknown({ message: "oops" })
    expect(e.toObject()).toEqual({ name: "UnknownError", data: { message: "oops" } })
  })

  test("Unknown error is an Error", () => {
    expect(new NamedError.Unknown({ message: "x" })).toBeInstanceOf(Error)
  })
})
