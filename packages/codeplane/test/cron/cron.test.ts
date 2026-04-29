import { describe, expect, test } from "bun:test"
import { Cron } from "../../src/cron/cron"

describe("Cron.validateInput", () => {
  test("rejects unstable execution options", () => {
    expect(() => Cron.validateInput({ timeoutMs: 0 })).toThrow()
    expect(() => Cron.validateInput({ timeoutMs: -1 })).toThrow()
    expect(() => Cron.validateInput({ maxRetries: -1 })).toThrow()
    expect(() => Cron.validateInput({ maxRetries: 1.5 })).toThrow()
  })
})
