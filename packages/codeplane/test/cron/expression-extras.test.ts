import { describe, expect, test } from "bun:test"
import { CronExpression, CronParseError } from "../../src/cron/expression"

describe("CronExpression.parse aliases", () => {
  test("@yearly", () => {
    const r = CronExpression.parse("@yearly")
    expect(r.minute.has(0)).toBe(true)
    expect(r.hour.has(0)).toBe(true)
    expect(r.dayOfMonth.has(1)).toBe(true)
    expect(r.month.has(1)).toBe(true)
  })

  test("@annually equals @yearly", () => {
    expect(CronExpression.parse("@annually")).toEqual(CronExpression.parse("@yearly"))
  })

  test("@monthly", () => {
    const r = CronExpression.parse("@monthly")
    expect(r.minute.has(0)).toBe(true)
    expect(r.hour.has(0)).toBe(true)
    expect(r.dayOfMonth.has(1)).toBe(true)
  })

  test("@weekly", () => {
    const r = CronExpression.parse("@weekly")
    expect(r.dayOfWeek.has(0)).toBe(true)
  })

  test("@daily", () => {
    const r = CronExpression.parse("@daily")
    expect(r.minute.has(0)).toBe(true)
    expect(r.hour.has(0)).toBe(true)
  })

  test("@midnight equals @daily", () => {
    expect(CronExpression.parse("@midnight")).toEqual(CronExpression.parse("@daily"))
  })

  test("@hourly", () => {
    const r = CronExpression.parse("@hourly")
    expect(r.minute.has(0)).toBe(true)
    expect(r.hour.size).toBe(24)
  })

  test("aliases case-insensitive", () => {
    expect(CronExpression.parse("@DAILY")).toEqual(CronExpression.parse("@daily"))
  })
})

describe("CronExpression.parse fields", () => {
  test("simple expression", () => {
    const r = CronExpression.parse("0 12 * * *")
    expect(r.minute.has(0)).toBe(true)
    expect(r.hour.has(12)).toBe(true)
    expect(r.dayOfMonth.size).toBe(31)
    expect(r.month.size).toBe(12)
    expect(r.dayOfWeek.size).toBe(7)
  })

  test("range", () => {
    const r = CronExpression.parse("0-5 * * * *")
    expect([...r.minute].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
  })

  test("step", () => {
    const r = CronExpression.parse("*/15 * * * *")
    expect([...r.minute].sort((a, b) => a - b)).toEqual([0, 15, 30, 45])
  })

  test("range with step", () => {
    const r = CronExpression.parse("0-30/10 * * * *")
    expect([...r.minute].sort((a, b) => a - b)).toEqual([0, 10, 20, 30])
  })

  test("multiple values", () => {
    const r = CronExpression.parse("0,15,30,45 * * * *")
    expect([...r.minute].sort((a, b) => a - b)).toEqual([0, 15, 30, 45])
  })

  test("month names", () => {
    const r = CronExpression.parse("0 0 1 jan *")
    expect(r.month.has(1)).toBe(true)
  })

  test("day names", () => {
    const r = CronExpression.parse("0 0 * * mon")
    expect(r.dayOfWeek.has(1)).toBe(true)
  })

  test("dayOfWeek 7 normalized to 0 (sunday)", () => {
    const r = CronExpression.parse("0 0 * * 7")
    expect(r.dayOfWeek.has(0)).toBe(true)
    expect(r.dayOfWeek.has(7)).toBe(false)
  })
})

describe("CronExpression.parse errors", () => {
  test("throws CronParseError for invalid", () => {
    expect(() => CronExpression.parse("invalid")).toThrow(CronParseError)
  })

  test("throws on too few fields", () => {
    expect(() => CronExpression.parse("0 0 * *")).toThrow()
  })

  test("throws on too many fields", () => {
    expect(() => CronExpression.parse("0 0 * * * *")).toThrow()
  })

  test("throws on out of range minute", () => {
    expect(() => CronExpression.parse("60 0 * * *")).toThrow()
  })

  test("throws on out of range hour", () => {
    expect(() => CronExpression.parse("0 24 * * *")).toThrow()
  })

  test("throws on negative minute", () => {
    expect(() => CronExpression.parse("-1 0 * * *")).toThrow()
  })

  test("throws on bad range start>end", () => {
    expect(() => CronExpression.parse("5-1 0 * * *")).toThrow()
  })

  test("throws on bad step value", () => {
    expect(() => CronExpression.parse("*/0 * * * *")).toThrow()
  })

  test("throws on empty token", () => {
    expect(() => CronExpression.parse("0 ,0 * * *")).toThrow()
  })

  test("throws on non-integer minute", () => {
    expect(() => CronExpression.parse("0.5 0 * * *")).toThrow()
  })
})

describe("CronExpression.isValid", () => {
  test("valid expression returns true", () => {
    expect(CronExpression.isValid("0 12 * * *")).toBe(true)
  })

  test("valid alias returns true", () => {
    expect(CronExpression.isValid("@daily")).toBe(true)
  })

  test("invalid expression returns false", () => {
    expect(CronExpression.isValid("xx")).toBe(false)
  })

  test("empty returns false", () => {
    expect(CronExpression.isValid("")).toBe(false)
  })

  test("out of range returns false", () => {
    expect(CronExpression.isValid("60 0 * * *")).toBe(false)
  })
})

describe("CronExpression.next", () => {
  test("returns a number greater than 'from'", () => {
    const from = new Date(2024, 0, 1, 0, 0).getTime()
    expect(CronExpression.next("0 12 * * *", from)).toBeGreaterThan(from)
  })

  test("@hourly fires every hour", () => {
    const from = new Date(2024, 0, 1, 0, 30).getTime()
    const result = CronExpression.next("@hourly", from)
    expect(new Date(result).getMinutes()).toBe(0)
  })

  test("@daily fires at midnight", () => {
    const from = new Date(2024, 0, 1, 12, 0).getTime()
    const result = CronExpression.next("@daily", from)
    const date = new Date(result)
    expect(date.getMinutes()).toBe(0)
    expect(date.getHours()).toBe(0)
  })

  test("respects specific hour", () => {
    const from = new Date(2024, 0, 1, 12, 0).getTime()
    const result = CronExpression.next("0 15 * * *", from)
    expect(new Date(result).getHours()).toBe(15)
  })

  test("returns next minute when current matches", () => {
    const from = new Date(2024, 0, 1, 0, 0, 30).getTime()
    const result = CronExpression.next("* * * * *", from)
    expect(result).toBeGreaterThan(from)
  })

  test("supports start as Date object", () => {
    const from = new Date(2024, 0, 1, 0, 0)
    const result = CronExpression.next("@daily", from)
    expect(typeof result).toBe("number")
  })
})
