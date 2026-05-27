import { describe, expect, spyOn, test, vi } from "bun:test"
import { createRoot } from "solid-js"
import { createCopiedState } from "./create-copied-state"

describe("createCopiedState", () => {
  test("resets copied state after the configured delay", async () => {
    vi.useFakeTimers()
    try {
      let copied!: () => boolean
      let flash!: () => void
      let dispose!: () => void

      createRoot((cleanup) => {
        dispose = cleanup
        const state = createCopiedState(10)
        copied = state.copied
        flash = state.flash
      })

      flash()
      await Promise.resolve()
      expect(copied()).toBe(true)

      vi.advanceTimersByTime(10)
      expect(copied()).toBe(false)
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test("cleans up a pending timer on dispose", () => {
    vi.useFakeTimers()
    const clear = spyOn(globalThis, "clearTimeout")
    try {
      let flash!: () => void
      let dispose!: () => void

      createRoot((cleanup) => {
        dispose = cleanup
        flash = createCopiedState(10).flash
      })

      flash()
      dispose()
      expect(clear).toHaveBeenCalled()
    } finally {
      clear.mockRestore()
      vi.useRealTimers()
    }
  })
})
