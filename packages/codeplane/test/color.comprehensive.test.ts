import { describe, expect, test } from "bun:test"
import { Color } from "../src/util"

describe("Color.isValidHex", () => {
  test("valid hex - lowercase", () => expect(Color.isValidHex("#abcdef")).toBe(true))
  test("valid hex - uppercase", () => expect(Color.isValidHex("#ABCDEF")).toBe(true))
  test("valid hex - mixed case", () => expect(Color.isValidHex("#AbCdEf")).toBe(true))
  test("valid hex - digits", () => expect(Color.isValidHex("#012345")).toBe(true))
  test("valid hex - all zeros", () => expect(Color.isValidHex("#000000")).toBe(true))
  test("valid hex - all f", () => expect(Color.isValidHex("#ffffff")).toBe(true))
  test("invalid - missing #", () => expect(Color.isValidHex("abcdef")).toBe(false))
  test("invalid - 3 chars", () => expect(Color.isValidHex("#abc")).toBe(false))
  test("invalid - 7 chars", () => expect(Color.isValidHex("#abcdefg")).toBe(false))
  test("invalid - 5 chars", () => expect(Color.isValidHex("#abcde")).toBe(false))
  test("invalid - non-hex char", () => expect(Color.isValidHex("#abcxef")).toBe(false))
  test("invalid - empty", () => expect(Color.isValidHex("")).toBe(false))
  test("invalid - undefined", () => expect(Color.isValidHex(undefined)).toBe(false))
  test("invalid - null is undefined-ish", () =>
    expect(Color.isValidHex(undefined)).toBe(false))
  test("invalid - rgb format", () => expect(Color.isValidHex("rgb(0,0,0)")).toBe(false))
  test("invalid - hex with spaces", () => expect(Color.isValidHex("# abcdef")).toBe(false))
  for (let i = 0; i < 100; i++) {
    const value = "#" + i.toString(16).padStart(6, "0")
    test(`bulk valid #${i}`, () => expect(Color.isValidHex(value)).toBe(true))
  }
  for (const bad of ["#xyz123", "#12345", "#1234567", "#-12345", "##abcdef", " #abcdef"]) {
    test(`bulk invalid: ${bad}`, () => expect(Color.isValidHex(bad)).toBe(false))
  }
})

describe("Color.hexToRgb", () => {
  test("black", () => expect(Color.hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 }))
  test("white", () => expect(Color.hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 }))
  test("red", () => expect(Color.hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 }))
  test("green", () => expect(Color.hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 }))
  test("blue", () => expect(Color.hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 255 }))
  test("uppercase", () => expect(Color.hexToRgb("#FF8800")).toEqual({ r: 255, g: 136, b: 0 }))
  test("mixed", () => expect(Color.hexToRgb("#1a2B3c")).toEqual({ r: 26, g: 43, b: 60 }))
  for (let i = 0; i < 50; i++) {
    test(`bulk hex ${i}`, () => {
      const v = i.toString(16).padStart(2, "0")
      const hex = `#${v}${v}${v}`
      const expected = parseInt(v, 16)
      expect(Color.hexToRgb(hex)).toEqual({ r: expected, g: expected, b: expected })
    })
  }
})

describe("Color.hexToAnsiBold", () => {
  test("invalid hex returns undefined", () =>
    expect(Color.hexToAnsiBold("not-a-color")).toBeUndefined())
  test("undefined returns undefined", () =>
    expect(Color.hexToAnsiBold(undefined)).toBeUndefined())
  test("returns ansi escape code", () => {
    const result = Color.hexToAnsiBold("#ff0000")
    expect(result).toContain("\x1b[")
  })
  test("ends with bold marker", () => {
    const result = Color.hexToAnsiBold("#ff0000")
    expect(result?.endsWith("\x1b[1m")).toBe(true)
  })
  test("includes RGB values", () => {
    const result = Color.hexToAnsiBold("#ff0000")
    expect(result).toContain("255;0;0")
  })
})
