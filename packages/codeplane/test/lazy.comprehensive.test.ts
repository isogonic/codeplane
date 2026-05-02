import { describe, expect, test } from "bun:test"
import { lazy } from "../src/util/lazy"

describe("lazy basic", () => {
  test("calls only once", () => {
    let calls = 0
    const fn = lazy(() => ++calls)
    fn()
    fn()
    fn()
    expect(calls).toBe(1)
  })
  test("returns memoized value", () => {
    const fn = lazy(() => "val")
    expect(fn()).toBe("val")
    expect(fn()).toBe("val")
  })
  test("works with primitives", () => {
    expect(lazy(() => 0)()).toBe(0)
    expect(lazy(() => "")()).toBe("")
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
  })
  test("reset method clears cache", () => {
    let calls = 0
    const fn = lazy(() => ++calls)
    fn()
    fn.reset()
    fn()
    expect(calls).toBe(2)
  })
  test("rejected promise resets", async () => {
    let calls = 0
    const fn = lazy(() => {
      calls++
      return Promise.reject(new Error("nope"))
    })
    const p1 = fn()
    await p1.catch(() => {})
    // After rejection, lazy should reset
    await new Promise((r) => setTimeout(r, 10))
    fn()
    expect(calls).toBe(2)
  })
  test("memoizes successful promise", async () => {
    let calls = 0
    const fn = lazy(() => {
      calls++
      return Promise.resolve("ok")
    })
    expect(await fn()).toBe("ok")
    expect(await fn()).toBe("ok")
    expect(calls).toBe(1)
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk lazy memoization #${i}`, () => {
      const fn = lazy(() => i)
      fn()
      expect(fn()).toBe(i)
    })
  }
})
