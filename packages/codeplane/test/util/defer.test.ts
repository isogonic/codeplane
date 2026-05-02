import { describe, expect, test } from "bun:test"
import { defer } from "../../src/util/defer"

describe("defer", () => {
  test("returns object with both Symbol.dispose and Symbol.asyncDispose", () => {
    const d = defer(() => {})
    expect(typeof d[Symbol.dispose]).toBe("function")
    expect(typeof d[Symbol.asyncDispose]).toBe("function")
  })

  test("Symbol.dispose runs the function", () => {
    let called = false
    const d = defer(() => {
      called = true
    })
    d[Symbol.dispose]()
    expect(called).toBe(true)
  })

  test("Symbol.asyncDispose returns a promise that resolves", async () => {
    let called = false
    const d = defer(() => {
      called = true
    })
    await d[Symbol.asyncDispose]()
    expect(called).toBe(true)
  })

  test("Symbol.asyncDispose awaits async fns", async () => {
    let called = false
    const d = defer(async () => {
      await new Promise((r) => setTimeout(r, 1))
      called = true
    })
    await d[Symbol.asyncDispose]()
    expect(called).toBe(true)
  })

  test("supports `using` syntax", () => {
    let called = false
    {
      using _ = defer(() => {
        called = true
      })
    }
    expect(called).toBe(true)
  })

  test("Symbol.dispose called twice runs fn twice", () => {
    let count = 0
    const d = defer(() => {
      count++
    })
    d[Symbol.dispose]()
    d[Symbol.dispose]()
    expect(count).toBe(2)
  })
})
