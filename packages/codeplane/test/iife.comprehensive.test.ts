import { describe, expect, test } from "bun:test"
import { iife } from "../src/util/iife"

describe("iife", () => {
  test("calls and returns", () => expect(iife(() => 42)).toBe(42))
  test("with strings", () => expect(iife(() => "hello")).toBe("hello"))
  test("with arrays", () => expect(iife(() => [1, 2, 3])).toEqual([1, 2, 3]))
  test("with objects", () => expect(iife(() => ({ a: 1 }))).toEqual({ a: 1 }))
  test("with undefined", () => expect(iife(() => undefined)).toBeUndefined())
  test("with null", () => expect(iife(() => null)).toBeNull())
  test("called once", () => {
    let calls = 0
    iife(() => calls++)
    expect(calls).toBe(1)
  })
  test("nested", () => expect(iife(() => iife(() => iife(() => 7)))).toBe(7))
  for (let i = 0; i < 100; i++) {
    test(`bulk iife #${i}`, () => expect(iife(() => i)).toBe(i))
  }
})
