import { describe, expect, test } from "bun:test"
import { Color } from "../src/util"

describe("Color.isValidHex mega", () => {
  for (let i = 0; i < 256; i++) {
    const v = i.toString(16).padStart(2, "0")
    const hex = `#${v}${v}${v}`
    test(`valid grayscale ${hex}`, () => expect(Color.isValidHex(hex)).toBe(true))
  }
  for (const bad of ["#GGGGGG", "abcdef", "#abcdg1", "##aabbcc", "#abcdef ", "#aabbccd"]) {
    for (let i = 0; i < 5; i++) {
      test(`invalid #${i}: ${bad}`, () => expect(Color.isValidHex(bad)).toBe(false))
    }
  }
})

describe("Color.hexToRgb mega", () => {
  for (let i = 0; i < 256; i++) {
    const v = i.toString(16).padStart(2, "0")
    const hex = `#${v}${v}${v}`
    test(`grayscale ${hex}`, () =>
      expect(Color.hexToRgb(hex)).toEqual({ r: i, g: i, b: i }))
  }
})

describe("Color.hexToAnsiBold mega", () => {
  for (let i = 0; i < 50; i++) {
    const v = i.toString(16).padStart(2, "0")
    const hex = `#${v}${v}${v}`
    test(`grayscale ${hex} produces escape`, () => {
      const out = Color.hexToAnsiBold(hex)
      expect(out).toContain("\x1b[")
    })
  }
})
