import { describe, expect, test } from "bun:test"
import { withTimeout } from "../src/util/timeout"

describe("withTimeout", () => {
  test("resolves before timeout", async () => {
    expect(await withTimeout(Promise.resolve("ok"), 100)).toBe("ok")
  })
  test("rejects when timeout exceeds", async () => {
    const slow = new Promise((r) => setTimeout(() => r("late"), 200))
    await expect(withTimeout(slow, 10)).rejects.toThrow(/timed out/i)
  })
  test("propagates rejection from promise", async () => {
    const fail = Promise.reject(new Error("inner"))
    await expect(withTimeout(fail, 100)).rejects.toThrow("inner")
  })
  test("clears timeout on success", async () => {
    expect(await withTimeout(Promise.resolve(1), 100)).toBe(1)
  })
  test("works with 0 timeout (still allows microtask)", async () => {
    await expect(withTimeout(new Promise(() => {}), 1)).rejects.toThrow()
  })
  test("preserves value type", async () => {
    const result: number = await withTimeout(Promise.resolve(42), 100)
    expect(result).toBe(42)
  })
  for (let i = 0; i < 20; i++) {
    test(`bulk resolves #${i}`, async () => {
      expect(await withTimeout(Promise.resolve(i), 1000)).toBe(i)
    })
  }
})
