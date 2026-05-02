import { describe, expect, test } from "bun:test"
import { terminalWriter } from "../../src/utils/terminal-writer"

describe("terminalWriter basic", () => {
  test("push triggers write", async () => {
    let written: string | undefined
    const writer = terminalWriter((data, done) => {
      written = data
      done?.()
    })
    writer.push("hello")
    await new Promise((r) => queueMicrotask(() => r(undefined)))
    expect(written).toBe("hello")
  })
  test("multiple pushes batch into one write", async () => {
    const writes: string[] = []
    const writer = terminalWriter((data, done) => {
      writes.push(data)
      done?.()
    })
    writer.push("a")
    writer.push("b")
    writer.push("c")
    await new Promise((r) => queueMicrotask(() => r(undefined)))
    expect(writes).toEqual(["abc"])
  })
  test("empty push is no-op", () => {
    let called = 0
    const writer = terminalWriter(() => {
      called++
    })
    writer.push("")
    expect(called).toBe(0)
  })
  test("flush calls done when idle", () => {
    let called = false
    const writer = terminalWriter((_data, done) => done?.())
    writer.flush(() => {
      called = true
    })
    expect(called).toBe(true)
  })
  test("flush waits when busy", async () => {
    let called = false
    const writer = terminalWriter((_data, done) => done?.())
    writer.push("a")
    writer.flush(() => {
      called = true
    })
    await new Promise((r) => queueMicrotask(() => r(undefined)))
    expect(called).toBe(true)
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk basic write ${i}`, async () => {
      const writes: string[] = []
      const writer = terminalWriter((data, done) => {
        writes.push(data)
        done?.()
      })
      writer.push(`data-${i}`)
      await new Promise((r) => queueMicrotask(() => r(undefined)))
      expect(writes[0]).toBe(`data-${i}`)
    })
  }
})
