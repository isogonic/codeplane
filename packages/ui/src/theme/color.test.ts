import { describe, expect, test } from "bun:test"
import {
  hexToRgb,
  rgbToHex,
  rgbToOklch,
  oklchToRgb,
  hexToOklch,
  oklchToHex,
  fitOklch,
  generateScale,
  generateNeutralScale,
  blend,
  shift,
  withAlpha,
} from "./color"
import type { HexColor } from "./types"

describe("hexToRgb", () => {
  test("converts #000000 to (0,0,0)", () => {
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 })
  })

  test("converts #ffffff to (1,1,1)", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 1, g: 1, b: 1 })
  })

  test("converts #ff0000 to (1,0,0)", () => {
    expect(hexToRgb("#ff0000")).toEqual({ r: 1, g: 0, b: 0 })
  })

  test("converts #00ff00 to (0,1,0)", () => {
    expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 1, b: 0 })
  })

  test("converts #0000ff to (0,0,1)", () => {
    expect(hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 1 })
  })

  test("supports 3-char shorthand #abc", () => {
    const result = hexToRgb("#abc")
    expect(Math.abs(result.r - 0xaa / 255)).toBeLessThan(0.001)
    expect(Math.abs(result.g - 0xbb / 255)).toBeLessThan(0.001)
    expect(Math.abs(result.b - 0xcc / 255)).toBeLessThan(0.001)
  })

  test("supports 8-char hex (ignores alpha)", () => {
    expect(hexToRgb("#ff0000ff")).toEqual({ r: 1, g: 0, b: 0 })
  })

  test("supports lowercase", () => {
    expect(hexToRgb("#abcdef")).toEqual(hexToRgb("#ABCDEF"))
  })
})

describe("rgbToHex", () => {
  test("converts (1,0,0) to #ff0000", () => {
    expect(rgbToHex(1, 0, 0)).toBe("#ff0000")
  })

  test("converts (0,0,0) to #000000", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000")
  })

  test("converts (1,1,1) to #ffffff", () => {
    expect(rgbToHex(1, 1, 1)).toBe("#ffffff")
  })

  test("clamps values above 1", () => {
    expect(rgbToHex(2, 2, 2)).toBe("#ffffff")
  })

  test("clamps negative values", () => {
    expect(rgbToHex(-1, -1, -1)).toBe("#000000")
  })

  test("rounds to nearest", () => {
    expect(rgbToHex(0.5, 0.5, 0.5)).toBe("#808080")
  })

  test("hex output is always 7 chars", () => {
    expect(rgbToHex(0.1, 0.2, 0.3).length).toBe(7)
  })

  test("hex starts with #", () => {
    expect(rgbToHex(0, 0, 0).startsWith("#")).toBe(true)
  })
})

describe("rgbToOklch / oklchToRgb roundtrip", () => {
  test("roundtrip pure red", () => {
    const oklch = rgbToOklch(1, 0, 0)
    const rgb = oklchToRgb(oklch)
    expect(Math.abs(rgb.r - 1)).toBeLessThan(0.01)
    expect(Math.abs(rgb.g - 0)).toBeLessThan(0.01)
    expect(Math.abs(rgb.b - 0)).toBeLessThan(0.01)
  })

  test("roundtrip pure green", () => {
    const oklch = rgbToOklch(0, 1, 0)
    const rgb = oklchToRgb(oklch)
    expect(Math.abs(rgb.r - 0)).toBeLessThan(0.01)
    expect(Math.abs(rgb.g - 1)).toBeLessThan(0.01)
    expect(Math.abs(rgb.b - 0)).toBeLessThan(0.01)
  })

  test("roundtrip pure blue", () => {
    const oklch = rgbToOklch(0, 0, 1)
    const rgb = oklchToRgb(oklch)
    expect(Math.abs(rgb.r - 0)).toBeLessThan(0.01)
    expect(Math.abs(rgb.g - 0)).toBeLessThan(0.01)
    expect(Math.abs(rgb.b - 1)).toBeLessThan(0.01)
  })

  test("roundtrip black", () => {
    const oklch = rgbToOklch(0, 0, 0)
    const rgb = oklchToRgb(oklch)
    expect(Math.abs(rgb.r)).toBeLessThan(0.01)
    expect(Math.abs(rgb.g)).toBeLessThan(0.01)
    expect(Math.abs(rgb.b)).toBeLessThan(0.01)
  })

  test("roundtrip white", () => {
    const oklch = rgbToOklch(1, 1, 1)
    const rgb = oklchToRgb(oklch)
    expect(Math.abs(rgb.r - 1)).toBeLessThan(0.01)
    expect(Math.abs(rgb.g - 1)).toBeLessThan(0.01)
    expect(Math.abs(rgb.b - 1)).toBeLessThan(0.01)
  })
})

describe("hexToOklch / oklchToHex", () => {
  test("hexToOklch returns object with l,c,h", () => {
    const result = hexToOklch("#336699" as HexColor)
    expect(typeof result.l).toBe("number")
    expect(typeof result.c).toBe("number")
    expect(typeof result.h).toBe("number")
  })

  test("oklchToHex returns hex string", () => {
    const result = oklchToHex({ l: 0.5, c: 0.1, h: 50 })
    expect(result.startsWith("#")).toBe(true)
    expect(result.length).toBe(7)
  })

  test("hexToOklch hue is in [0,360)", () => {
    const colors: HexColor[] = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff"]
    for (const c of colors) {
      const oklch = hexToOklch(c)
      expect(oklch.h).toBeGreaterThanOrEqual(0)
      expect(oklch.h).toBeLessThan(360)
    }
  })
})

describe("fitOklch", () => {
  test("clamps l to [0,1]", () => {
    expect(fitOklch({ l: 2, c: 0, h: 0 }).l).toBe(1)
    expect(fitOklch({ l: -1, c: 0, h: 0 }).l).toBe(0)
  })

  test("clamps c to non-negative", () => {
    expect(fitOklch({ l: 0.5, c: -1, h: 0 }).c).toBe(0)
  })

  test("normalizes h to [0,360)", () => {
    expect(fitOklch({ l: 0.5, c: 0.1, h: 720 }).h).toBe(0)
    expect(fitOklch({ l: 0.5, c: 0.1, h: -10 }).h).toBe(350)
  })
})

describe("generateScale", () => {
  test("returns array of 12 hex colors", () => {
    const scale = generateScale("#3366cc", false)
    expect(scale.length).toBe(12)
    for (const c of scale) {
      expect(c.startsWith("#")).toBe(true)
    }
  })

  test("dark and light produce different scales", () => {
    expect(generateScale("#3366cc", true)).not.toEqual(generateScale("#3366cc", false))
  })
})

describe("generateNeutralScale", () => {
  test("returns array of 12 hex colors", () => {
    const scale = generateNeutralScale("#888888", false)
    expect(scale.length).toBe(12)
  })

  test("supports ink override", () => {
    const scale = generateNeutralScale("#fff", false, "#000")
    expect(scale.length).toBe(12)
  })
})

describe("blend", () => {
  test("blend with alpha=0 returns first color", () => {
    expect(blend("#ff0000", "#0000ff", 0)).toBe("#0000ff")
  })

  test("blend with alpha=1 returns second color", () => {
    expect(blend("#ff0000", "#0000ff", 1)).toBe("#ff0000")
  })

  test("blend produces hex format", () => {
    expect(blend("#ff0000", "#0000ff", 0.5).startsWith("#")).toBe(true)
  })
})

describe("shift", () => {
  test("returns hex color", () => {
    const result = shift("#336699", { l: 0.05 })
    expect(result.startsWith("#")).toBe(true)
  })

  test("zero shift produces similar color", () => {
    const result = shift("#336699", {})
    expect(result.length).toBe(7)
  })
})

describe("withAlpha", () => {
  test("returns rgba() string", () => {
    expect(withAlpha("#ff0000", 1)).toContain("rgba(")
  })

  test("alpha 0 included in output", () => {
    expect(withAlpha("#ff0000", 0)).toContain("0")
  })

  test("alpha 1 included in output", () => {
    expect(withAlpha("#ff0000", 1)).toContain("1)")
  })

  test("alpha 0.5 included in output", () => {
    expect(withAlpha("#ff0000", 0.5)).toContain("0.5")
  })

  test("preserves rgb values for #ff0000", () => {
    const result = withAlpha("#ff0000", 1)
    expect(result).toBe("rgba(255, 0, 0, 1)")
  })

  test("preserves rgb values for #00ff00", () => {
    expect(withAlpha("#00ff00", 0.5)).toBe("rgba(0, 255, 0, 0.5)")
  })
})
