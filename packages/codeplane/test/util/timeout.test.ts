import { describe, expect, spyOn, test } from "bun:test"
import { withTimeout } from "../../src/util/timeout"

describe("util.timeout", () => {
  test("should resolve when promise completes before timeout", async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("fast"), 10)
    })

    const result = await withTimeout(fastPromise, 100)
    expect(result).toBe("fast")
  })

  test("should reject when promise exceeds timeout", async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("slow"), 200)
    })

    await expect(withTimeout(slowPromise, 50)).rejects.toThrow("Operation timed out after 50ms")
  })

  test("should clear timeout when promise rejects first", async () => {
    const clear = spyOn(globalThis, "clearTimeout")

    try {
      const error = await withTimeout(Promise.reject(new Error("boom")), 100).catch((error) => error)
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe("boom")
      expect(clear).toHaveBeenCalledTimes(1)
    } finally {
      clear.mockRestore()
    }
  })
})
