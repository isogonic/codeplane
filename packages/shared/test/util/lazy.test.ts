import { describe, expect, test } from "bun:test"
import { lazy } from "../../src/util/lazy"

describe("lazy", () => {
  test("returns the value when called", () => {
    const fn = lazy(() => 42)
    expect(fn()).toBe(42)
  })

  test("computes value only once", () => {
    let count = 0
    const fn = lazy(() => {
      count++
      return count
    })
    expect(fn()).toBe(1)
    expect(fn()).toBe(1)
    expect(fn()).toBe(1)
    expect(count).toBe(1)
  })

  test("does not invoke fn until called", () => {
    let invoked = false
    lazy(() => {
      invoked = true
      return 1
    })
    expect(invoked).toBe(false)
  })

  test("preserves identity for objects", () => {
    const obj = { x: 1 }
    const fn = lazy(() => obj)
    expect(fn()).toBe(obj)
    expect(fn()).toBe(obj)
  })

  test("works with undefined", () => {
    const fn = lazy(() => undefined)
    expect(fn()).toBeUndefined()
  })

  test("works with null", () => {
    const fn = lazy(() => null)
    expect(fn()).toBeNull()
  })

  test("works with falsy values", () => {
    const fn = lazy(() => 0)
    expect(fn()).toBe(0)
    expect(fn()).toBe(0)
  })

  test("works with empty string", () => {
    const fn = lazy(() => "")
    expect(fn()).toBe("")
    expect(fn()).toBe("")
  })

  test("works with false", () => {
    const fn = lazy(() => false)
    expect(fn()).toBe(false)
    expect(fn()).toBe(false)
  })

  test("multiple lazy instances are independent", () => {
    let count = 0
    const a = lazy(() => ++count)
    const b = lazy(() => ++count)
    expect(a()).toBe(1)
    expect(a()).toBe(1)
    expect(b()).toBe(2)
    expect(b()).toBe(2)
  })

  test("returns array", () => {
    const fn = lazy(() => [1, 2, 3])
    expect(fn()).toEqual([1, 2, 3])
  })

  test("error in fn propagates on first call", () => {
    const fn = lazy<number>(() => {
      throw new Error("fail")
    })
    expect(() => fn()).toThrow("fail")
  })
})
