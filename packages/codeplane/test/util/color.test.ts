import { describe, expect, test } from "bun:test"
import { isValidHex, hexToRgb, hexToAnsiBold } from "../../src/util/color"

describe("isValidHex", () => {
  test("returns false for undefined", () => {
    expect(isValidHex(undefined)).toBe(false)
  })

  test("returns false for empty string", () => {
    expect(isValidHex("")).toBe(false)
  })

  test("returns true for #RRGGBB lowercase", () => {
    expect(isValidHex("#abcdef")).toBe(true)
  })

  test("returns true for #RRGGBB uppercase", () => {
    expect(isValidHex("#ABCDEF")).toBe(true)
  })

  test("returns true for mixed case", () => {
    expect(isValidHex("#aBcDeF")).toBe(true)
  })

  test("returns false for missing #", () => {
    expect(isValidHex("abcdef")).toBe(false)
  })

  test("returns false for short hex (#RGB)", () => {
    expect(isValidHex("#abc")).toBe(false)
  })

  test("returns false for 8-char alpha hex", () => {
    expect(isValidHex("#abcdefab")).toBe(false)
  })

  test("returns false for non-hex chars", () => {
    expect(isValidHex("#xyzabc")).toBe(false)
  })

  test("returns true for digits only", () => {
    expect(isValidHex("#123456")).toBe(true)
  })

  test("returns false for too short", () => {
    expect(isValidHex("#12345")).toBe(false)
  })

  test("returns false for too long", () => {
    expect(isValidHex("#1234567")).toBe(false)
  })

  test("returns false for double hash", () => {
    expect(isValidHex("##123456")).toBe(false)
  })

  test("returns false for trailing whitespace", () => {
    expect(isValidHex("#123456 ")).toBe(false)
  })

  test("returns false for leading whitespace", () => {
    expect(isValidHex(" #123456")).toBe(false)
  })

  test("acts as type guard", () => {
    const v: string | undefined = "#abcdef"
    if (isValidHex(v)) {
      expect(v.length).toBe(7)
    }
  })
})

describe("hexToRgb", () => {
  test("converts #000000 to (0,0,0)", () => {
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 })
  })

  test("converts #ffffff to (255,255,255)", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 })
  })

  test("converts #FF0000 to (255,0,0)", () => {
    expect(hexToRgb("#FF0000")).toEqual({ r: 255, g: 0, b: 0 })
  })

  test("converts #00FF00 to (0,255,0)", () => {
    expect(hexToRgb("#00FF00")).toEqual({ r: 0, g: 255, b: 0 })
  })

  test("converts #0000FF to (0,0,255)", () => {
    expect(hexToRgb("#0000FF")).toEqual({ r: 0, g: 0, b: 255 })
  })

  test("converts #336699 correctly", () => {
    expect(hexToRgb("#336699")).toEqual({ r: 0x33, g: 0x66, b: 0x99 })
  })

  test("handles uppercase letters", () => {
    expect(hexToRgb("#ABCDEF")).toEqual({ r: 0xab, g: 0xcd, b: 0xef })
  })

  test("handles lowercase letters", () => {
    expect(hexToRgb("#abcdef")).toEqual({ r: 0xab, g: 0xcd, b: 0xef })
  })
})

describe("hexToAnsiBold", () => {
  test("returns undefined for invalid hex", () => {
    expect(hexToAnsiBold(undefined)).toBeUndefined()
    expect(hexToAnsiBold("")).toBeUndefined()
    expect(hexToAnsiBold("notahex")).toBeUndefined()
    expect(hexToAnsiBold("#xyzxyz")).toBeUndefined()
    expect(hexToAnsiBold("#abc")).toBeUndefined()
  })

  test("returns ansi escape sequence for valid hex", () => {
    expect(hexToAnsiBold("#FF0000")).toBe("\x1b[38;2;255;0;0m\x1b[1m")
  })

  test("includes 38;2 for true color", () => {
    const result = hexToAnsiBold("#123456")
    expect(result).toContain("38;2")
  })

  test("includes RGB values", () => {
    const result = hexToAnsiBold("#101010")
    expect(result).toContain("16;16;16")
  })

  test("includes bold sequence", () => {
    const result = hexToAnsiBold("#abcdef")
    expect(result?.endsWith("\x1b[1m")).toBe(true)
  })

  test("handles black", () => {
    expect(hexToAnsiBold("#000000")).toBe("\x1b[38;2;0;0;0m\x1b[1m")
  })

  test("handles white", () => {
    expect(hexToAnsiBold("#ffffff")).toBe("\x1b[38;2;255;255;255m\x1b[1m")
  })
})
