import { describe, expect, test } from "bun:test"
import {
  RETRY_INITIAL_DELAY,
  RETRY_BACKOFF_FACTOR,
  RETRY_MAX_DELAY_NO_HEADERS,
  RETRY_MAX_DELAY,
  FREE_USAGE_EXCEEDED_MESSAGE,
} from "../../src/session/retry"

describe("retry constants", () => {
  test("RETRY_INITIAL_DELAY is 2000", () => {
    expect(RETRY_INITIAL_DELAY).toBe(2000)
  })

  test("RETRY_BACKOFF_FACTOR is 2", () => {
    expect(RETRY_BACKOFF_FACTOR).toBe(2)
  })

  test("RETRY_MAX_DELAY_NO_HEADERS is 30s", () => {
    expect(RETRY_MAX_DELAY_NO_HEADERS).toBe(30_000)
  })

  test("RETRY_MAX_DELAY is 32-bit max", () => {
    expect(RETRY_MAX_DELAY).toBe(2_147_483_647)
  })

  test("FREE_USAGE_EXCEEDED_MESSAGE is non-empty", () => {
    expect(typeof FREE_USAGE_EXCEEDED_MESSAGE).toBe("string")
    expect(FREE_USAGE_EXCEEDED_MESSAGE.length).toBeGreaterThan(0)
  })

  test("RETRY_INITIAL_DELAY is positive", () => {
    expect(RETRY_INITIAL_DELAY).toBeGreaterThan(0)
  })

  test("RETRY_MAX_DELAY > RETRY_MAX_DELAY_NO_HEADERS", () => {
    expect(RETRY_MAX_DELAY).toBeGreaterThan(RETRY_MAX_DELAY_NO_HEADERS)
  })

  test("RETRY_BACKOFF_FACTOR is positive", () => {
    expect(RETRY_BACKOFF_FACTOR).toBeGreaterThan(0)
  })
})
