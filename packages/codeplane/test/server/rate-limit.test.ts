import { afterEach, describe, expect, test } from "bun:test"
import * as AuthRateLimit from "../../src/server/rate-limit"

afterEach(() => {
  AuthRateLimit.reset()
})

describe("AuthRateLimit", () => {
  test("allows attempts under the soft limit without locking", () => {
    const key = "client-a"
    for (let i = 0; i < AuthRateLimit.config.SOFT_LIMIT; i++) {
      const before = AuthRateLimit.check(key)
      expect(before.allowed).toBe(true)
      AuthRateLimit.recordFailure(key)
    }
    // SOFT_LIMIT failures recorded but no lockout yet — the (SOFT_LIMIT+1)-th
    // try is still allowed in principle (it's the failure of that try that
    // triggers the first lockout).
    expect(AuthRateLimit.check(key).allowed).toBe(true)
  })

  test("locks out after the soft limit with exponential backoff", () => {
    const key = "client-b"
    const now = 1_000_000
    for (let i = 0; i < AuthRateLimit.config.SOFT_LIMIT; i++) {
      AuthRateLimit.recordFailure(key, now)
    }
    // First failure past the soft limit triggers the smallest lockout.
    AuthRateLimit.recordFailure(key, now)
    const first = AuthRateLimit.check(key, now)
    expect(first.allowed).toBe(false)
    expect(first.retryAfterMs).toBe(AuthRateLimit.config.BASE_LOCKOUT_MS)

    // Each additional failure doubles the lockout.
    AuthRateLimit.recordFailure(key, now)
    const second = AuthRateLimit.check(key, now)
    expect(second.allowed).toBe(false)
    expect(second.retryAfterMs).toBe(AuthRateLimit.config.BASE_LOCKOUT_MS * 2)
  })

  test("hard limit produces a window-long block", () => {
    const key = "client-c"
    const now = 2_000_000
    for (let i = 0; i < AuthRateLimit.config.HARD_LIMIT; i++) {
      AuthRateLimit.recordFailure(key, now)
    }
    const verdict = AuthRateLimit.check(key, now)
    expect(verdict.allowed).toBe(false)
    expect(verdict.retryAfterMs).toBeGreaterThanOrEqual(AuthRateLimit.config.HARD_BLOCK_MS - 1)
  })

  test("recordSuccess clears the counter for that client", () => {
    const key = "client-d"
    const now = 3_000_000
    for (let i = 0; i < AuthRateLimit.config.SOFT_LIMIT + 1; i++) {
      AuthRateLimit.recordFailure(key, now)
    }
    expect(AuthRateLimit.check(key, now).allowed).toBe(false)
    AuthRateLimit.recordSuccess(key)
    expect(AuthRateLimit.check(key, now).allowed).toBe(true)
  })

  test("stale entries past the window are cleaned up on check", () => {
    const key = "client-e"
    const t0 = 4_000_000
    for (let i = 0; i < AuthRateLimit.config.SOFT_LIMIT + 1; i++) {
      AuthRateLimit.recordFailure(key, t0)
    }
    expect(AuthRateLimit.check(key, t0).allowed).toBe(false)

    // Past the window AND past the lockout — entry is reaped.
    const future = t0 + AuthRateLimit.config.WINDOW_MS + 1_000
    expect(AuthRateLimit.check(key, future).allowed).toBe(true)
    expect(AuthRateLimit.size()).toBe(0)
  })

  test("counters are per-client", () => {
    const a = "client-f-1"
    const b = "client-f-2"
    for (let i = 0; i < AuthRateLimit.config.SOFT_LIMIT + 1; i++) {
      AuthRateLimit.recordFailure(a)
    }
    expect(AuthRateLimit.check(a).allowed).toBe(false)
    expect(AuthRateLimit.check(b).allowed).toBe(true)
  })

  test("rolling the window starts a fresh counter", () => {
    const key = "client-g"
    const t0 = 5_000_000
    for (let i = 0; i < AuthRateLimit.config.SOFT_LIMIT; i++) {
      AuthRateLimit.recordFailure(key, t0)
    }
    // After the window expires, the next failure starts at 1 again rather
    // than continuing from the prior count.
    const later = t0 + AuthRateLimit.config.WINDOW_MS + 1
    const entry = AuthRateLimit.recordFailure(key, later)
    expect(entry.failures).toBe(1)
    expect(AuthRateLimit.check(key, later).allowed).toBe(true)
  })
})
