import { describe, expect, test } from "bun:test"
import { isResizeObserverNoise } from "../../src/utils/silence-resize-observer"

describe("isResizeObserverNoise", () => {
  test("matches the exact phrase", () =>
    expect(isResizeObserverNoise("ResizeObserver loop completed")).toBe(true))
  test("matches with extra context", () =>
    expect(isResizeObserverNoise("Error: ResizeObserver loop completed with undelivered notifications")).toBe(true))
  test("does not match unrelated strings", () =>
    expect(isResizeObserverNoise("TypeError: foo")).toBe(false))
  test("matches Error objects", () =>
    expect(isResizeObserverNoise(new Error("ResizeObserver loop"))).toBe(true))
  test("matches objects with message field", () =>
    expect(isResizeObserverNoise({ message: "ResizeObserver loop happened" })).toBe(true))
  test("does not match objects without message", () =>
    expect(isResizeObserverNoise({})).toBe(false))
  test("does not match null", () => expect(isResizeObserverNoise(null)).toBe(false))
  test("does not match undefined", () =>
    expect(isResizeObserverNoise(undefined)).toBe(false))
  test("does not match number", () => expect(isResizeObserverNoise(42)).toBe(false))
  for (let i = 0; i < 50; i++) {
    test(`bulk match #${i}`, () => {
      const message = `ResizeObserver loop iteration ${i}`
      expect(isResizeObserverNoise(message)).toBe(true)
    })
  }
  for (let i = 0; i < 50; i++) {
    test(`bulk no match #${i}`, () => {
      expect(isResizeObserverNoise(`OtherError-${i}`)).toBe(false)
    })
  }
})
