import { describe, expect, test } from "bun:test"
import { signal } from "../src/util/signal"

describe("signal", () => {
  test("returns object with trigger and wait", () => {
    const s = signal()
    expect(typeof s.trigger).toBe("function")
    expect(typeof s.wait).toBe("function")
  })
  test("wait resolves after trigger", async () => {
    const s = signal()
    const promise = s.wait()
    s.trigger()
    await promise
  })
  test("multiple awaits resolve when triggered", async () => {
    const s = signal()
    const a = s.wait()
    const b = s.wait()
    s.trigger()
    await Promise.all([a, b])
  })
  test("trigger before wait still resolves", async () => {
    const s = signal()
    s.trigger()
    await s.wait()
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk signal #${i}`, async () => {
      const s = signal()
      s.trigger()
      await s.wait()
    })
  }
})
