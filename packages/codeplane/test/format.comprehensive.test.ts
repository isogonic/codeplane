import { describe, expect, test } from "bun:test"
import { formatDuration } from "../src/util/format"

describe("formatDuration", () => {
  test("zero returns empty", () => expect(formatDuration(0)).toBe(""))
  test("negative returns empty", () => expect(formatDuration(-5)).toBe(""))
  test("seconds", () => expect(formatDuration(30)).toBe("30s"))
  test("just under a minute", () => expect(formatDuration(59)).toBe("59s"))
  test("exactly one minute", () => expect(formatDuration(60)).toBe("1m"))
  test("minute + seconds", () => expect(formatDuration(90)).toBe("1m 30s"))
  test("two minutes exact", () => expect(formatDuration(120)).toBe("2m"))
  test("just under an hour", () => expect(formatDuration(3599)).toBe("59m 59s"))
  test("exactly one hour", () => expect(formatDuration(3600)).toBe("1h"))
  test("hour + minutes", () => expect(formatDuration(3660)).toBe("1h 1m"))
  test("two hours", () => expect(formatDuration(7200)).toBe("2h"))
  test("just under a day", () => expect(formatDuration(86399)).toBe("23h 59m"))
  test("exactly one day", () => expect(formatDuration(86400)).toBe("~1 day"))
  test("days plural", () => expect(formatDuration(86400 * 3)).toBe("~3 days"))
  test("week boundary", () => expect(formatDuration(604800)).toBe("~1 week"))
  test("two weeks", () => expect(formatDuration(604800 * 2)).toBe("~2 weeks"))
  for (let i = 1; i <= 30; i++) {
    test(`bulk seconds ${i}`, () => {
      expect(formatDuration(i)).toBe(`${i}s`)
    })
  }
  for (let i = 2; i <= 30; i++) {
    test(`bulk minutes ${i}`, () => {
      expect(formatDuration(i * 60)).toBe(`${i}m`)
    })
  }
})
