import { describe, expect, test } from "bun:test"
import { isResizeObserverNoise } from "./silence-resize-observer"

describe("isResizeObserverNoise", () => {
  test("matches browser resize observer loop messages", () => {
    expect(isResizeObserverNoise("ResizeObserver loop completed with undelivered notifications.")).toBe(true)
    expect(isResizeObserverNoise(new Error("ResizeObserver loop limit exceeded"))).toBe(true)
    expect(isResizeObserverNoise({ message: "ResizeObserver loop limit exceeded" })).toBe(true)
  })

  test("ignores unrelated errors", () => {
    expect(isResizeObserverNoise("Something else failed")).toBe(false)
    expect(isResizeObserverNoise(new Error("Network down"))).toBe(false)
    expect(isResizeObserverNoise({ message: "Unhandled promise rejection" })).toBe(false)
  })
})
