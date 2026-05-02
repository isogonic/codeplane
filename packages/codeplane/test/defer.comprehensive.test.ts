import { describe, expect, test } from "bun:test"
import { defer } from "../src/util/defer"

describe("defer", () => {
  test("Symbol.dispose calls function", () => {
    let called = false
    const d = defer(() => {
      called = true
    })
    d[Symbol.dispose]()
    expect(called).toBe(true)
  })
  test("Symbol.asyncDispose returns promise", async () => {
    let called = false
    const d = defer(() => {
      called = true
    })
    await d[Symbol.asyncDispose]()
    expect(called).toBe(true)
  })
  test("supports async cleanup", async () => {
    let called = false
    const d = defer(async () => {
      await new Promise((r) => setTimeout(r, 1))
      called = true
    })
    await d[Symbol.asyncDispose]()
    expect(called).toBe(true)
  })
  test("using statement triggers cleanup", () => {
    let called = false
    const block = () => {
      using _ = defer(() => {
        called = true
      })
    }
    block()
    expect(called).toBe(true)
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk defer #${i}`, () => {
      let value = 0
      using _ = defer(() => {
        value = i
      })
      expect(value).toBe(0)
    })
  }
})
