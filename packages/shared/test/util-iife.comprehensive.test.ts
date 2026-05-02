import { describe, expect, test } from "bun:test"
import { iife } from "../src/util/iife"

describe("iife", () => {
  test("calls the function and returns result", () => {
    expect(iife(() => 42)).toBe(42)
  })
  test("works with strings", () => {
    expect(iife(() => "hello")).toBe("hello")
  })
  test("works with objects", () => {
    expect(iife(() => ({ a: 1 }))).toEqual({ a: 1 })
  })
  test("works with arrays", () => {
    expect(iife(() => [1, 2, 3])).toEqual([1, 2, 3])
  })
  test("works with undefined return", () => {
    expect(iife(() => undefined)).toBeUndefined()
  })
  test("works with null return", () => {
    expect(iife(() => null)).toBeNull()
  })
  test("preserves type via generic", () => {
    const x: number = iife(() => 1)
    expect(x).toBe(1)
  })
  test("function is called exactly once", () => {
    let calls = 0
    iife(() => {
      calls++
    })
    expect(calls).toBe(1)
  })
  test("can be nested", () => {
    expect(iife(() => iife(() => iife(() => 99)))).toBe(99)
  })
  test("captures closure variables", () => {
    const x = 5
    expect(iife(() => x * 2)).toBe(10)
  })
  test("propagates exceptions", () => {
    expect(() => iife<number>(() => { throw new Error("boom") })).toThrow("boom")
  })
  for (let i = 0; i < 100; i++) {
    test(`bulk iife #${i}`, () => expect(iife(() => i)).toBe(i))
  }
})
