import { describe, expect, test } from "bun:test"
import { iife } from "../../src/util/iife"

describe("iife", () => {
  test("invokes the function and returns the result", () => {
    expect(iife(() => 42)).toBe(42)
  })

  test("returns string from function", () => {
    expect(iife(() => "hello")).toBe("hello")
  })

  test("returns object", () => {
    const obj = { a: 1 }
    expect(iife(() => obj)).toBe(obj)
  })

  test("returns array", () => {
    const arr = [1, 2, 3]
    expect(iife(() => arr)).toBe(arr)
  })

  test("returns undefined when function returns undefined", () => {
    expect(iife(() => undefined)).toBeUndefined()
  })

  test("returns null when function returns null", () => {
    expect(iife(() => null)).toBeNull()
  })

  test("invokes function only once", () => {
    let count = 0
    iife(() => {
      count++
    })
    expect(count).toBe(1)
  })

  test("propagates thrown errors", () => {
    expect(() =>
      iife(() => {
        throw new Error("boom")
      }),
    ).toThrow("boom")
  })

  test("returns boolean true", () => {
    expect(iife(() => true)).toBe(true)
  })

  test("returns boolean false", () => {
    expect(iife(() => false)).toBe(false)
  })

  test("returns NaN", () => {
    expect(iife(() => NaN)).toBeNaN()
  })

  test("returns infinity", () => {
    expect(iife(() => Infinity)).toBe(Infinity)
  })

  test("supports closure access", () => {
    const x = 100
    expect(iife(() => x + 1)).toBe(101)
  })
})
