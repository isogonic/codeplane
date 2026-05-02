import { describe, expect, test } from "bun:test"
import { titlecase, time, datetime, todayTimeOrDateTime, number, duration, truncate, truncateMiddle, pluralize } from "../../src/util/locale"

describe("titlecase", () => {
  test("uppercases first letter of each word", () => {
    expect(titlecase("hello world")).toBe("Hello World")
  })

  test("preserves already capitalized", () => {
    expect(titlecase("Hello World")).toBe("Hello World")
  })

  test("works with single word", () => {
    expect(titlecase("foo")).toBe("Foo")
  })

  test("works with empty string", () => {
    expect(titlecase("")).toBe("")
  })

  test("works with numbers and underscores (treats underscore as part of word)", () => {
    expect(titlecase("hello_world")).toBe("Hello_world")
  })

  test("handles punctuation", () => {
    expect(titlecase("hello-world")).toBe("Hello-World")
  })

  test("handles multi-word with various separators", () => {
    expect(titlecase("foo bar baz qux")).toBe("Foo Bar Baz Qux")
  })

  test("preserves case for non-leading chars", () => {
    expect(titlecase("hELLO wORLD")).toBe("HELLO WORLD")
  })
})

describe("time", () => {
  test("returns a string", () => {
    expect(typeof time(0)).toBe("string")
  })

  test("returns non-empty for any timestamp", () => {
    expect(time(Date.now()).length).toBeGreaterThan(0)
  })

  test("works with zero timestamp", () => {
    expect(time(0).length).toBeGreaterThan(0)
  })
})

describe("datetime", () => {
  test("returns a string with separator", () => {
    expect(datetime(0)).toContain(" · ")
  })

  test("returns time + date format", () => {
    const result = datetime(Date.now())
    expect(result.split(" · ").length).toBe(2)
  })
})

describe("todayTimeOrDateTime", () => {
  test("returns time-only for today", () => {
    const now = Date.now()
    expect(todayTimeOrDateTime(now)).not.toContain(" · ")
  })

  test("returns datetime for past date", () => {
    const lastYear = Date.now() - 365 * 24 * 60 * 60 * 1000
    expect(todayTimeOrDateTime(lastYear)).toContain(" · ")
  })
})

describe("number", () => {
  test("returns small numbers as-is", () => {
    expect(number(0)).toBe("0")
    expect(number(1)).toBe("1")
    expect(number(999)).toBe("999")
  })

  test("formats thousands as K", () => {
    expect(number(1000)).toBe("1.0K")
    expect(number(1500)).toBe("1.5K")
    expect(number(999_999)).toBe("1000.0K")
  })

  test("formats millions as M", () => {
    expect(number(1_000_000)).toBe("1.0M")
    expect(number(2_500_000)).toBe("2.5M")
  })

  test("uses one decimal place", () => {
    expect(number(1234)).toBe("1.2K")
    expect(number(1_500_000)).toBe("1.5M")
  })
})

describe("duration", () => {
  test("milliseconds for under 1s", () => {
    expect(duration(500)).toBe("500ms")
    expect(duration(0)).toBe("0ms")
  })

  test("seconds for under 1m", () => {
    expect(duration(1000)).toBe("1.0s")
    expect(duration(2500)).toBe("2.5s")
  })

  test("minutes and seconds for under 1h", () => {
    expect(duration(60_000)).toBe("1m 0s")
    expect(duration(90_000)).toBe("1m 30s")
  })

  test("hours and minutes for under 1d", () => {
    expect(duration(3_600_000)).toBe("1h 0m")
    expect(duration(5_400_000)).toBe("1h 30m")
  })

  test("formats over 1d", () => {
    const result = duration(2 * 24 * 3600 * 1000)
    expect(typeof result).toBe("string")
  })
})

describe("truncate", () => {
  test("returns string under limit", () => {
    expect(truncate("hello", 10)).toBe("hello")
  })

  test("truncates with ellipsis", () => {
    expect(truncate("hello world", 5)).toBe("hell…")
  })

  test("at exact length", () => {
    expect(truncate("hello", 5)).toBe("hello")
  })

  test("very small limit", () => {
    expect(truncate("hello", 1)).toBe("…")
  })

  test("empty string", () => {
    expect(truncate("", 5)).toBe("")
  })

  test("single character", () => {
    expect(truncate("a", 5)).toBe("a")
  })
})

describe("truncateMiddle (locale)", () => {
  test("returns string under limit", () => {
    expect(truncateMiddle("hello", 10)).toBe("hello")
  })

  test("default limit is 35", () => {
    const long = "x".repeat(50)
    expect(truncateMiddle(long).length).toBe(35)
  })

  test("ellipsis in middle", () => {
    const result = truncateMiddle("abcdefghijklmnop", 10)
    expect(result).toContain("…")
    expect(result.length).toBe(10)
  })

  test("preserves start and end characters", () => {
    const result = truncateMiddle("startmiddleend", 7)
    expect(result.startsWith("s")).toBe(true)
    expect(result.endsWith("d")).toBe(true)
  })
})

describe("pluralize", () => {
  test("singular for count of 1", () => {
    expect(pluralize(1, "{} item", "{} items")).toBe("1 item")
  })

  test("plural for count of 0", () => {
    expect(pluralize(0, "{} item", "{} items")).toBe("0 items")
  })

  test("plural for count > 1", () => {
    expect(pluralize(5, "{} item", "{} items")).toBe("5 items")
  })

  test("works without {} placeholder", () => {
    expect(pluralize(1, "single", "many")).toBe("single")
    expect(pluralize(2, "single", "many")).toBe("many")
  })

  test("count negative uses plural", () => {
    expect(pluralize(-1, "{} item", "{} items")).toBe("-1 items")
  })

  test("count fractional uses plural", () => {
    expect(pluralize(1.5, "{} item", "{} items")).toBe("1.5 items")
  })

  test("only replaces first {} occurrence", () => {
    expect(pluralize(1, "{} item from {}", "{} items from {}")).toBe("1 item from {}")
  })
})
