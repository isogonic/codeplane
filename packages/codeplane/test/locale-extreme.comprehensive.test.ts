import { describe, expect, test } from "bun:test"
import { Locale } from "../src/util"

describe("Locale.titlecase extreme", () => {
  // Letter combinations
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(97 + i)
    test(`single ${c}`, () => expect(Locale.titlecase(c)).toBe(c.toUpperCase()))
  }
  // Test 100 different multi-word combinations
  for (let i = 0; i < 100; i++) {
    test(`multi-word ${i}`, () => {
      expect(Locale.titlecase(`word${i} other${i}`)).toBe(`Word${i} Other${i}`)
    })
  }
})

describe("Locale.number extreme", () => {
  for (let i = 1; i < 1000; i += 10) {
    test(`number ${i}`, () => expect(Locale.number(i)).toBe(String(i)))
  }
  for (const v of [1000, 2000, 5000, 10000, 100000, 999000]) {
    test(`thousand value ${v}`, () => {
      const out = Locale.number(v)
      expect(out).toContain("K")
    })
  }
  for (const v of [1_000_000, 5_000_000, 100_000_000, 999_000_000]) {
    test(`million value ${v}`, () => {
      const out = Locale.number(v)
      expect(out).toContain("M")
    })
  }
})

describe("Locale.duration extreme", () => {
  for (let ms = 0; ms < 1000; ms += 10) {
    test(`ms ${ms}`, () => expect(Locale.duration(ms)).toBe(`${ms}ms`))
  }
  for (let s = 1; s < 60; s += 1) {
    test(`seconds ${s}`, () => {
      const out = Locale.duration(s * 1000)
      expect(out).toContain("s")
    })
  }
})

describe("Locale.truncate extreme", () => {
  for (let n = 2; n <= 100; n++) {
    test(`truncate to ${n}`, () => {
      const out = Locale.truncate("abc".repeat(50), n)
      expect(out.length).toBe(n)
    })
  }
})

describe("Locale.truncateMiddle extreme", () => {
  for (let n = 5; n <= 100; n++) {
    test(`truncate middle to ${n}`, () => {
      const out = Locale.truncateMiddle("a".repeat(150), n)
      expect(out.length).toBeLessThanOrEqual(n)
    })
  }
})

describe("Locale.pluralize extreme", () => {
  for (let i = 0; i < 200; i++) {
    test(`pluralize ${i}`, () => {
      const result = Locale.pluralize(i, "{} item", "{} items")
      if (i === 1) expect(result).toBe("1 item")
      else expect(result).toBe(`${i} items`)
    })
  }
})

describe("Locale.time and datetime extreme", () => {
  for (let i = 0; i < 50; i++) {
    test(`time format ${i}`, () => {
      const t = Date.now() - i * 60000
      expect(typeof Locale.time(t)).toBe("string")
    })
  }
  for (let i = 0; i < 50; i++) {
    test(`datetime format ${i}`, () => {
      const t = Date.now() - i * 3600000
      const result = Locale.datetime(t)
      expect(result).toContain("·")
    })
  }
})
