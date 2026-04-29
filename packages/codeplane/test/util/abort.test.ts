import { describe, expect, spyOn, test } from "bun:test"
import { abortAfterAny } from "../../src/util/abort"

describe("util.abort", () => {
  test("clears timeout when a joined signal aborts first", () => {
    const controller = new AbortController()
    const clear = spyOn(globalThis, "clearTimeout")
    const timeout = abortAfterAny(10_000, controller.signal)

    try {
      controller.abort(new Error("stop"))

      expect(timeout.signal.aborted).toBe(true)
      expect(clear).toHaveBeenCalledTimes(1)

      timeout.clearTimeout()
      expect(clear).toHaveBeenCalledTimes(1)
    } finally {
      timeout.clearTimeout()
      clear.mockRestore()
    }
  })

  test("clears timeout when a joined signal is already aborted", () => {
    const controller = new AbortController()
    const clear = spyOn(globalThis, "clearTimeout")
    controller.abort(new Error("stop"))
    const timeout = abortAfterAny(10_000, controller.signal)

    try {
      expect(timeout.signal.aborted).toBe(true)
      expect(clear).toHaveBeenCalledTimes(1)
    } finally {
      timeout.clearTimeout()
      clear.mockRestore()
    }
  })
})
