import { describe, expect, test } from "bun:test"
import { lazy } from "../src/util/lazy"

describe("lazy", () => {
  test("returns the wrapped function value", () => {
    const fn = lazy(() => 42)
    expect(fn()).toBe(42)
  })
  test("calls the underlying function only once", () => {
    let calls = 0
    const fn = lazy(() => ++calls)
    fn()
    fn()
    fn()
    expect(calls).toBe(1)
  })
  test("returns the same value on subsequent calls", () => {
    const fn = lazy(() => ({ counter: 0 }))
    const a = fn()
    const b = fn()
    expect(a).toBe(b)
  })
  test("works with primitive values", () => {
    expect(lazy(() => "hello")()).toBe("hello")
    expect(lazy(() => 0)()).toBe(0)
    expect(lazy(() => false)()).toBe(false)
  })
  test("works with undefined", () => {
    let calls = 0
    const fn = lazy(() => {
      calls++
      return undefined
    })
    fn()
    fn()
    expect(calls).toBe(1)
    expect(fn()).toBeUndefined()
  })
  test("works with null", () => {
    let calls = 0
    const fn = lazy(() => {
      calls++
      return null
    })
    fn()
    fn()
    expect(calls).toBe(1)
    expect(fn()).toBeNull()
  })
  test("can be reset by reassignment of variable (not via API)", () => {
    let fn = lazy(() => "v1")
    expect(fn()).toBe("v1")
    fn = lazy(() => "v2")
    expect(fn()).toBe("v2")
  })
  test("works for expensive operations", () => {
    let calls = 0
    const fn = lazy(() => {
      calls++
      let n = 0
      for (let i = 0; i < 100; i++) n += i
      return n
    })
    fn()
    fn()
    fn()
    expect(calls).toBe(1)
  })
  test("multiple independent lazies", () => {
    const a = lazy(() => "a")
    const b = lazy(() => "b")
    expect(a()).toBe("a")
    expect(b()).toBe("b")
    expect(a()).toBe("a")
  })
  test("stores reference identity for objects", () => {
    const fn = lazy(() => ({ key: "value" }))
    const a = fn()
    const b = fn()
    expect(a).toBe(b)
  })
  for (let i = 0; i < 100; i++) {
    test(`bulk lazy #${i}`, () => {
      let calls = 0
      const fn = lazy(() => {
        calls++
        return i
      })
      fn()
      fn()
      expect(calls).toBe(1)
      expect(fn()).toBe(i)
    })
  }
})
