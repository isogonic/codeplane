import { describe, expect, test } from "bun:test"
import { signal } from "../../src/util/signal"

describe("signal", () => {
  test("trigger resolves wait()", async () => {
    const s = signal()
    const promise = s.wait()
    s.trigger()
    await promise
    expect(true).toBe(true)
  })

  test("multiple wait() return same promise", () => {
    const s = signal()
    expect(s.wait()).toBe(s.wait())
  })

  test("trigger before wait still resolves", async () => {
    const s = signal()
    s.trigger()
    await s.wait()
  })

  test("multiple triggers do not throw", () => {
    const s = signal()
    expect(() => {
      s.trigger()
      s.trigger()
      s.trigger()
    }).not.toThrow()
  })

  test("multiple awaiters all resolve on trigger", async () => {
    const s = signal()
    const a = s.wait()
    const b = s.wait()
    const c = s.wait()
    s.trigger()
    await Promise.all([a, b, c])
  })

  test("signals are independent", async () => {
    const a = signal()
    const b = signal()
    a.trigger()
    let resolvedB = false
    b.wait().then(() => {
      resolvedB = true
    })
    await a.wait()
    await new Promise((r) => setTimeout(r, 1))
    expect(resolvedB).toBe(false)
    b.trigger()
    await b.wait()
    expect(resolvedB).toBe(true)
  })
})
