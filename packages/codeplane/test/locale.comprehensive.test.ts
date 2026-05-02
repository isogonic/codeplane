import { describe, expect, test } from "bun:test"
import { Locale } from "../src/util"

describe("Locale.titlecase", () => {
  test("empty string", () => expect(Locale.titlecase("")).toBe(""))
  test("single word", () => expect(Locale.titlecase("hello")).toBe("Hello"))
  test("two words", () => expect(Locale.titlecase("hello world")).toBe("Hello World"))
  test("three words", () => expect(Locale.titlecase("foo bar baz")).toBe("Foo Bar Baz"))
  test("preserves case after first letter", () =>
    expect(Locale.titlecase("hELLO")).toBe("HELLO"))
  test("works on already titlecase", () =>
    expect(Locale.titlecase("Hello World")).toBe("Hello World"))
  test("digits ignored as word starts", () =>
    expect(Locale.titlecase("foo123 bar")).toBe("Foo123 Bar"))
  test("hyphens treat parts as separate words", () =>
    expect(Locale.titlecase("hello-world")).toBe("Hello-World"))
  for (let i = 0; i < 30; i++) {
    test(`bulk titlecase #${i}`, () =>
      expect(Locale.titlecase(`word${i}`)).toBe(`Word${i}`))
  }
})

describe("Locale.number", () => {
  test("zero", () => expect(Locale.number(0)).toBe("0"))
  test("small number", () => expect(Locale.number(42)).toBe("42"))
  test("999 stays raw", () => expect(Locale.number(999)).toBe("999"))
  test("1000 becomes 1.0K", () => expect(Locale.number(1000)).toBe("1.0K"))
  test("1500 becomes 1.5K", () => expect(Locale.number(1500)).toBe("1.5K"))
  test("999_999 becomes 1000.0K", () => expect(Locale.number(999_999)).toBe("1000.0K"))
  test("one million becomes 1.0M", () => expect(Locale.number(1_000_000)).toBe("1.0M"))
  test("ten million", () => expect(Locale.number(10_000_000)).toBe("10.0M"))
  test("999 million", () => expect(Locale.number(999_999_999)).toBe("1000.0M"))
})

describe("Locale.duration", () => {
  test("zero ms", () => expect(Locale.duration(0)).toBe("0ms"))
  test("ms range", () => expect(Locale.duration(500)).toBe("500ms"))
  test("rounds to seconds", () => expect(Locale.duration(1500)).toBe("1.5s"))
  test("seconds boundary", () => expect(Locale.duration(60_000)).toBe("1m 0s"))
  test("minutes + seconds", () => expect(Locale.duration(90_000)).toBe("1m 30s"))
  test("hours + minutes", () => expect(Locale.duration(3_600_000)).toBe("1h 0m"))
  for (let i = 1; i < 60; i++) {
    test(`bulk seconds-as-ms ${i}`, () => {
      expect(Locale.duration(i * 1000)).toBe(`${(i).toFixed(1)}s`)
    })
  }
})

describe("Locale.truncate", () => {
  test("short stays short", () => expect(Locale.truncate("hi", 5)).toBe("hi"))
  test("equal length stays", () => expect(Locale.truncate("hello", 5)).toBe("hello"))
  test("longer is truncated with ellipsis", () =>
    expect(Locale.truncate("abcdef", 4)).toBe("abc…"))
  test("very long is truncated", () =>
    expect(Locale.truncate("a".repeat(20), 5)).toBe("aaaa…"))
  for (let n = 2; n <= 20; n++) {
    test(`max length ${n}`, () => {
      const out = Locale.truncate("a".repeat(50), n)
      expect(out.length).toBe(n)
    })
  }
})

describe("Locale.truncateMiddle", () => {
  test("short stays short", () => expect(Locale.truncateMiddle("hi")).toBe("hi"))
  test("middle truncated", () => {
    const out = Locale.truncateMiddle("a".repeat(50), 10)
    expect(out).toContain("…")
    expect(out.length).toBeLessThanOrEqual(10)
  })
  for (let n = 5; n <= 20; n++) {
    test(`max length ${n}`, () => {
      const out = Locale.truncateMiddle("a".repeat(40), n)
      expect(out.length).toBeLessThanOrEqual(n)
    })
  }
})

describe("Locale.pluralize", () => {
  test("singular for 1", () => expect(Locale.pluralize(1, "{} item", "{} items")).toBe("1 item"))
  test("plural for 0", () => expect(Locale.pluralize(0, "{} item", "{} items")).toBe("0 items"))
  test("plural for 2", () => expect(Locale.pluralize(2, "{} item", "{} items")).toBe("2 items"))
  test("plural for 99", () =>
    expect(Locale.pluralize(99, "{} dog", "{} dogs")).toBe("99 dogs"))
  test("templates without {} return as-is", () =>
    expect(Locale.pluralize(5, "many", "many")).toBe("many"))
  for (let i = 0; i < 30; i++) {
    test(`bulk pluralize #${i}`, () => {
      const result = Locale.pluralize(i, "{} item", "{} items")
      expect(result).toContain(String(i))
    })
  }
})

describe("Locale.time / datetime / todayTimeOrDateTime", () => {
  test("time returns string", () => {
    expect(typeof Locale.time(Date.now())).toBe("string")
  })
  test("datetime returns string with separator", () => {
    expect(Locale.datetime(Date.now())).toContain("·")
  })
  test("today returns short time", () => {
    const now = Date.now()
    const result = Locale.todayTimeOrDateTime(now)
    expect(typeof result).toBe("string")
  })
  test("yesterday returns datetime", () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000 - 60 * 60 * 1000
    const result = Locale.todayTimeOrDateTime(yesterday)
    expect(result).toContain("·")
  })
})
