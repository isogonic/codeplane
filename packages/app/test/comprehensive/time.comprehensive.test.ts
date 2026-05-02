import { describe, expect, test } from "bun:test"
import { getRelativeTime } from "../../src/utils/time"

const t = (key: string, params?: Record<string, string | number>) => {
  if (params) return `${key}:${JSON.stringify(params)}`
  return key
}

describe("getRelativeTime", () => {
  test("just now for current date", () => {
    const result = getRelativeTime(new Date().toISOString(), t)
    expect(result).toBe("common.time.justNow")
  })
  test("seconds ago is just now", () => {
    const date = new Date(Date.now() - 30_000).toISOString()
    expect(getRelativeTime(date, t)).toBe("common.time.justNow")
  })
  test("minutes ago", () => {
    const date = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(getRelativeTime(date, t)).toContain("minutesAgo")
  })
  test("hours ago", () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    expect(getRelativeTime(date, t)).toContain("hoursAgo")
  })
  test("days ago", () => {
    const date = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    expect(getRelativeTime(date, t)).toContain("daysAgo")
  })
  for (let mins = 1; mins < 60; mins++) {
    test(`${mins} minutes ago`, () => {
      const date = new Date(Date.now() - mins * 60 * 1000).toISOString()
      const result = getRelativeTime(date, t)
      expect(result).toContain("minutesAgo")
      expect(result).toContain(String(mins))
    })
  }
  for (let hrs = 1; hrs < 24; hrs++) {
    test(`${hrs} hours ago`, () => {
      const date = new Date(Date.now() - hrs * 60 * 60 * 1000).toISOString()
      const result = getRelativeTime(date, t)
      expect(result).toContain("hoursAgo")
    })
  }
  for (let d = 1; d < 30; d++) {
    test(`${d} days ago`, () => {
      const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString()
      const result = getRelativeTime(date, t)
      expect(result).toContain("daysAgo")
    })
  }
})
