import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { NamedError } from "../src/util/error"

describe("NamedError.create", () => {
  test("creates a class with correct name", () => {
    const MyError = NamedError.create("MyError", z.object({ msg: z.string() }))
    expect(MyError.name).toBe("MyError")
  })
  test("instances have name property matching tag", () => {
    const MyError = NamedError.create("CustomTag", z.object({ msg: z.string() }))
    const err = new MyError({ msg: "boom" })
    expect(err.name).toBe("CustomTag")
  })
  test("instances are Error instances", () => {
    const MyError = NamedError.create("E", z.object({ value: z.number() }))
    const err = new MyError({ value: 1 })
    expect(err).toBeInstanceOf(Error)
  })
  test("instances expose data field", () => {
    const MyError = NamedError.create("E", z.object({ value: z.number() }))
    const err = new MyError({ value: 42 })
    expect(err.data).toEqual({ value: 42 })
  })
  test("isInstance returns true for matching class", () => {
    const A = NamedError.create("A", z.object({}))
    const B = NamedError.create("B", z.object({}))
    expect(A.isInstance(new A({}))).toBe(true)
    expect(A.isInstance(new B({}))).toBe(false)
  })
  test("isInstance returns false for plain objects without name", () => {
    const A = NamedError.create("A", z.object({}))
    expect(A.isInstance({})).toBe(false)
  })
  test("isInstance returns false for plain object with different name", () => {
    const A = NamedError.create("A", z.object({}))
    expect(A.isInstance({ name: "Other" })).toBe(false)
  })
  test("toObject returns name and data", () => {
    const MyError = NamedError.create("X", z.object({ a: z.string(), b: z.number() }))
    const err = new MyError({ a: "hi", b: 1 })
    expect(err.toObject()).toEqual({ name: "X", data: { a: "hi", b: 1 } })
  })
  test("Schema field shape includes name and data", () => {
    const MyError = NamedError.create("ZZ", z.object({ value: z.string() }))
    const result = MyError.Schema.safeParse({ name: "ZZ", data: { value: "ok" } })
    expect(result.success).toBe(true)
  })
  test("Schema rejects mismatched name", () => {
    const MyError = NamedError.create("AA", z.object({ value: z.string() }))
    const result = MyError.Schema.safeParse({ name: "BB", data: { value: "ok" } })
    expect(result.success).toBe(false)
  })
  test("Schema rejects mismatched data shape", () => {
    const MyError = NamedError.create("CC", z.object({ value: z.string() }))
    const result = MyError.Schema.safeParse({ name: "CC", data: { value: 42 } })
    expect(result.success).toBe(false)
  })
})

describe("NamedError.hasName", () => {
  test("matches when name property equals", () => {
    expect(NamedError.hasName({ name: "X" }, "X")).toBe(true)
  })
  test("does not match when name differs", () => {
    expect(NamedError.hasName({ name: "X" }, "Y")).toBe(false)
  })
  test("returns false for null/undefined", () => {
    expect(NamedError.hasName(null, "X")).toBe(false)
    expect(NamedError.hasName(undefined, "X")).toBe(false)
  })
  test("returns false for primitives", () => {
    expect(NamedError.hasName(42, "X")).toBe(false)
    expect(NamedError.hasName("string", "X")).toBe(false)
  })
  test("works with Error instances", () => {
    const err = new Error("oops")
    err.name = "Custom"
    expect(NamedError.hasName(err, "Custom")).toBe(true)
  })
})

describe("NamedError.Unknown", () => {
  test("Unknown error has correct tag", () => {
    const err = new NamedError.Unknown({ message: "oops" })
    expect(err.name).toBe("UnknownError")
  })
  test("Unknown stores message", () => {
    const err = new NamedError.Unknown({ message: "oops" })
    expect(err.data.message).toBe("oops")
  })
  test("Unknown.isInstance true", () => {
    expect(NamedError.Unknown.isInstance(new NamedError.Unknown({ message: "x" }))).toBe(true)
  })
  test("Unknown.isInstance false for other", () => {
    expect(NamedError.Unknown.isInstance(new Error("oops"))).toBe(false)
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk Unknown #${i}`, () => {
      const err = new NamedError.Unknown({ message: `msg-${i}` })
      expect(err.data.message).toBe(`msg-${i}`)
    })
  }
})

describe("NamedError class identity", () => {
  test("each created class has its own toObject", () => {
    const A = NamedError.create("A", z.object({ x: z.number() }))
    const B = NamedError.create("B", z.object({ y: z.number() }))
    expect(new A({ x: 1 }).toObject()).toEqual({ name: "A", data: { x: 1 } })
    expect(new B({ y: 2 }).toObject()).toEqual({ name: "B", data: { y: 2 } })
  })
  test("error options pass through", () => {
    const E = NamedError.create("E", z.object({}))
    const cause = new Error("cause")
    const err = new E({}, { cause })
    expect(err.cause).toBe(cause)
  })
})
