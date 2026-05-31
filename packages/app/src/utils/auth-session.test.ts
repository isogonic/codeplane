import { afterEach, describe, expect, test } from "bun:test"
import { AuthSession } from "./auth-session"

afterEach(() => {
  // clear any keys touched by tests
  for (const key of ["http://a", "http://b", "k1", "k2"]) AuthSession.clear(key)
})

describe("AuthSession", () => {
  test("reportExpired marks a key as expired and notifies subscribers", () => {
    const seen: string[] = []
    const unsub = AuthSession.subscribe((key) => seen.push(key))
    AuthSession.reportExpired("k1")
    expect(seen).toEqual(["k1"])
    expect(AuthSession.isExpired("k1")).toBe(true)
    expect(AuthSession.isExpired("k2")).toBe(false)
    unsub()
  })

  test("clear removes the expired mark", () => {
    AuthSession.reportExpired("k1")
    expect(AuthSession.isExpired("k1")).toBe(true)
    AuthSession.clear("k1")
    expect(AuthSession.isExpired("k1")).toBe(false)
  })

  test("undefined key is a no-op", () => {
    let fired = 0
    const unsub = AuthSession.subscribe(() => fired++)
    AuthSession.reportExpired(undefined)
    expect(fired).toBe(0)
    expect(AuthSession.isExpired(undefined)).toBe(false)
    unsub()
  })

  test("unsubscribed listeners stop receiving events", () => {
    const seen: string[] = []
    const unsub = AuthSession.subscribe((key) => seen.push(key))
    unsub()
    AuthSession.reportExpired("k1")
    expect(seen).toEqual([])
  })
})
