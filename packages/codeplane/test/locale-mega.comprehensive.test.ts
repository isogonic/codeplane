import { describe, expect, test } from "bun:test"
import { Locale } from "../src/util"

describe("Locale.titlecase mega", () => {
  for (let i = 0; i < 100; i++) {
    test(`bulk word${i}`, () =>
      expect(Locale.titlecase(`word${i}`)).toBe(`Word${i}`))
  }
  for (let i = 0; i < 100; i++) {
    test(`bulk two words ${i}`, () =>
      expect(Locale.titlecase(`a${i} b${i}`)).toBe(`A${i} B${i}`))
  }
})

describe("Locale.number mega", () => {
  for (let i = 0; i < 100; i++) {
    test(`integer ${i}`, () => expect(Locale.number(i)).toBe(String(i)))
  }
  for (let i = 1000; i <= 5000; i += 100) {
    test(`thousand ${i}`, () => {
      expect(Locale.number(i)).toContain("K")
    })
  }
})

describe("Locale.duration mega", () => {
  for (let i = 0; i < 100; i++) {
    test(`ms-only ${i}`, () => expect(Locale.duration(i)).toBe(`${i}ms`))
  }
  for (let i = 1000; i <= 5000; i += 100) {
    test(`seconds ${i}`, () => {
      expect(Locale.duration(i)).toContain("s")
    })
  }
})

describe("Locale.truncate mega", () => {
  for (let n = 2; n <= 50; n++) {
    test(`length ${n} long input`, () => {
      const out = Locale.truncate("a".repeat(100), n)
      expect(out.length).toBe(n)
    })
  }
  for (let n = 5; n <= 50; n++) {
    test(`length ${n} short stays`, () => {
      const out = Locale.truncate("hi", n)
      expect(out).toBe("hi")
    })
  }
})

describe("Locale.pluralize mega", () => {
  for (let i = 0; i < 100; i++) {
    test(`pluralize ${i}`, () => {
      const result = Locale.pluralize(i, "{} item", "{} items")
      expect(result).toContain(String(i))
    })
  }
})
