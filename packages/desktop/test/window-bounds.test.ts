import { describe, expect, test } from "bun:test"
import { hasWindowPosition, normalizeWindowBoundsForRestore } from "../src/main/window-bounds"

describe("desktop window bounds restore", () => {
  test("uses the normal startup size when no saved bounds exist", () => {
    expect(normalizeWindowBoundsForRestore()).toEqual({
      width: 1280,
      height: 800,
      maximized: undefined,
    })
  })

  test("preserves negative coordinates for monitors left of the primary display", () => {
    const bounds = normalizeWindowBoundsForRestore({
      x: -1728,
      y: 24,
      width: 1200,
      height: 760,
    })

    expect(bounds).toEqual({
      x: -1728,
      y: 24,
      width: 1200,
      height: 760,
      maximized: undefined,
    })
    expect(hasWindowPosition(bounds)).toBe(true)
  })

  test("preserves far-out coordinates for stacked or right-side displays", () => {
    expect(
      normalizeWindowBoundsForRestore({
        x: 5760,
        y: -1440,
        width: 1440,
        height: 900,
        maximized: true,
      }),
    ).toEqual({
      x: 5760,
      y: -1440,
      width: 1440,
      height: 900,
      maximized: true,
    })
  })

  test("does not clamp the position when dimensions need safety floors", () => {
    expect(
      normalizeWindowBoundsForRestore({
        x: -10000,
        y: 9000,
        width: 120,
        height: 160,
      }),
    ).toEqual({
      x: -10000,
      y: 9000,
      width: 800,
      height: 480,
      maximized: undefined,
    })
  })

  test("drops the position only when one coordinate is not finite", () => {
    const bounds = normalizeWindowBoundsForRestore({
      x: Number.NaN,
      y: 50,
      width: 1000,
      height: 700,
    })

    expect(bounds).toEqual({
      width: 1000,
      height: 700,
      maximized: undefined,
    })
    expect(hasWindowPosition(bounds)).toBe(false)
  })

  test("rounds finite bounds without changing their screen", () => {
    expect(
      normalizeWindowBoundsForRestore({
        x: -512.4,
        y: 384.6,
        width: 1111.4,
        height: 777.6,
      }),
    ).toEqual({
      x: -512,
      y: 385,
      width: 1111,
      height: 778,
      maximized: undefined,
    })
  })
})
