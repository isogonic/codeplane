import { describe, expect, test } from "bun:test"
import { CronExpression } from "../../src/cron/expression"

describe("cron expression", () => {
  test("accepts 7 as Sunday", () => {
    const next = new Date(CronExpression.next("0 9 * * 7", new Date(2026, 3, 29, 8, 0)))

    expect(next.getDay()).toBe(0)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
  })

  test("rejects empty list parts", () => {
    expect(CronExpression.isValid("0,,15 9 * * *")).toBe(false)
  })

  test("bounds impossible date searches", () => {
    expect(() => CronExpression.next("0 0 31 2 *", new Date(2026, 0, 1))).toThrow(
      "Could not find next time within 400 years",
    )
  })
})
