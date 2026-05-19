import { describe, expect, test } from "bun:test"
import { listApplicableFacts, pickFunFact } from "./fun-facts"
import type { Totals } from "./stats"

const totals = (overrides: Partial<Totals> = {}): Totals => ({
  projects: 1,
  sessions: 0,
  archived: 0,
  files: 0,
  additions: 0,
  deletions: 0,
  thisWeek: 0,
  today: 0,
  messages: 0,
  tokens: 0,
  activeDays: 0,
  currentStreak: 0,
  longestStreak: 0,
  ...overrides,
})

const now = new Date("2026-05-19T12:00:00Z").getTime()

describe("pickFunFact", () => {
  test("returns undefined when no fact applies (empty stats)", () => {
    expect(pickFunFact(totals(), now)).toBeUndefined()
  })

  test("picks a token-comparison fact for big numbers", () => {
    const fact = pickFunFact(totals({ tokens: 500_000_000, messages: 1, activeDays: 1 }), now)
    expect(fact).toBeDefined()
    expect(fact!.key.startsWith("home.fact.")).toBe(true)
  })

  test("rotation is deterministic for a given date but differs across days", () => {
    const t = totals({ tokens: 80_000_000, messages: 5_000, activeDays: 60, currentStreak: 15, sessions: 400 })
    const day1 = pickFunFact(t, now)
    const day1again = pickFunFact(t, now)
    const day2 = pickFunFact(t, now + 24 * 60 * 60 * 1000)
    expect(day1).toEqual(day1again!)
    // there are enough applicable facts that a 1-day shift should land on a different one
    expect(day1!.key === day2!.key && JSON.stringify(day1!.params) === JSON.stringify(day2!.params)).toBe(false)
  })

  test("peak hour facts pick the right bucket", () => {
    const morning = listApplicableFacts(totals({ peakHour: 7 }))
    const night = listApplicableFacts(totals({ peakHour: 2 }))
    expect(morning.some((f) => f.key === "home.fact.peakHour.earlybird")).toBe(true)
    expect(night.some((f) => f.key === "home.fact.peakHour.midnight")).toBe(true)
  })

  test("legendary streak only triggers above 100 days", () => {
    expect(listApplicableFacts(totals({ currentStreak: 50 })).some((f) => f.key === "home.fact.streak.legendary")).toBe(
      false,
    )
    expect(
      listApplicableFacts(totals({ currentStreak: 120 })).some((f) => f.key === "home.fact.streak.legendary"),
    ).toBe(true)
  })

  test("bestEver only shows when longest > current", () => {
    expect(
      listApplicableFacts(totals({ currentStreak: 20, longestStreak: 20 })).some(
        (f) => f.key === "home.fact.streak.bestEver",
      ),
    ).toBe(false)
    expect(
      listApplicableFacts(totals({ currentStreak: 5, longestStreak: 40 })).some(
        (f) => f.key === "home.fact.streak.bestEver",
      ),
    ).toBe(true)
  })
})
