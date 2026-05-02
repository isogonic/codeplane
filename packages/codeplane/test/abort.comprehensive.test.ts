import { describe, expect, test } from "bun:test"
import { abortAfter, abortAfterAny } from "../src/util/abort"

describe("abortAfter", () => {
  test("returns object with controller, signal, clearTimeout", () => {
    const out = abortAfter(100)
    expect(out.controller).toBeInstanceOf(AbortController)
    expect(out.signal).toBe(out.controller.signal)
    expect(typeof out.clearTimeout).toBe("function")
    out.clearTimeout()
  })
  test("aborts after delay", async () => {
    const out = abortAfter(10)
    await new Promise((r) => setTimeout(r, 30))
    expect(out.signal.aborted).toBe(true)
  })
  test("clearTimeout prevents abort", async () => {
    const out = abortAfter(20)
    out.clearTimeout()
    await new Promise((r) => setTimeout(r, 50))
    expect(out.signal.aborted).toBe(false)
  })
  test("does not abort before delay", async () => {
    const out = abortAfter(100)
    await new Promise((r) => setTimeout(r, 5))
    expect(out.signal.aborted).toBe(false)
    out.clearTimeout()
  })
  test("can call clearTimeout after abort", async () => {
    const out = abortAfter(5)
    await new Promise((r) => setTimeout(r, 20))
    expect(() => out.clearTimeout()).not.toThrow()
  })
  for (let i = 0; i < 20; i++) {
    test(`bulk basic #${i}`, () => {
      const out = abortAfter(1000)
      expect(out.signal.aborted).toBe(false)
      out.clearTimeout()
    })
  }
})

describe("abortAfterAny", () => {
  test("returns signal that aborts on timeout", async () => {
    const out = abortAfterAny(10)
    await new Promise((r) => setTimeout(r, 30))
    expect(out.signal.aborted).toBe(true)
  })
  test("aborts when any input signal aborts", () => {
    const c = new AbortController()
    const out = abortAfterAny(1000, c.signal)
    c.abort()
    expect(out.signal.aborted).toBe(true)
    out.clearTimeout()
  })
  test("clearTimeout cancels timer", async () => {
    const out = abortAfterAny(10)
    out.clearTimeout()
    await new Promise((r) => setTimeout(r, 30))
    expect(out.signal.aborted).toBe(false)
  })
  test("works with already-aborted input", () => {
    const c = new AbortController()
    c.abort()
    const out = abortAfterAny(1000, c.signal)
    expect(out.signal.aborted).toBe(true)
  })
  test("works with multiple input signals", () => {
    const a = new AbortController()
    const b = new AbortController()
    const out = abortAfterAny(1000, a.signal, b.signal)
    a.abort()
    expect(out.signal.aborted).toBe(true)
    out.clearTimeout()
  })
})
