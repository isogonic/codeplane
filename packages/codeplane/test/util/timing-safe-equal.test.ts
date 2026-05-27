import { describe, expect, test } from "bun:test"
import { timingSafeEqual } from "../../src/util/timing-safe-equal"

describe("timingSafeEqual", () => {
  test("returns true for equal strings", async () => {
    expect(await timingSafeEqual("hunter2", "hunter2")).toBe(true)
  })

  test("returns false for different same-length strings", async () => {
    expect(await timingSafeEqual("hunter2", "hunter3")).toBe(false)
  })

  test("returns false for different-length strings", async () => {
    expect(await timingSafeEqual("short", "longer-string")).toBe(false)
  })

  test("returns false for empty vs non-empty", async () => {
    expect(await timingSafeEqual("", "x")).toBe(false)
    expect(await timingSafeEqual("x", "")).toBe(false)
  })

  test("returns true for empty vs empty", async () => {
    expect(await timingSafeEqual("", "")).toBe(true)
  })

  test("handles utf-8 multi-byte characters", async () => {
    expect(await timingSafeEqual("café", "café")).toBe(true)
    expect(await timingSafeEqual("café", "cafe")).toBe(false)
  })
})
