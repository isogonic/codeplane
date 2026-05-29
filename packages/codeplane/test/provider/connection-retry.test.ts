import { test, expect, describe } from "bun:test"
import { isTransientConnectionError, fetchWithConnectRetry } from "@/provider/provider"

const reset = () => Object.assign(new Error("The socket connection was closed unexpectedly"), { code: "ECONNRESET" })
const ok = () => new Response("data: ok\n\n", { status: 200 })

describe("isTransientConnectionError", () => {
  test("matches Bun socket-closed message (the z.ai failure)", () => {
    expect(
      isTransientConnectionError(
        new Error("The socket connection was closed unexpectedly. For more information, pass verbose: true"),
      ),
    ).toBe(true)
  })

  test("matches ECONNRESET by code", () => {
    expect(isTransientConnectionError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(true)
  })

  test("matches common transient codes", () => {
    for (const code of ["ECONNREFUSED", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET", "EAI_AGAIN"]) {
      expect(isTransientConnectionError(Object.assign(new Error("x"), { code }))).toBe(true)
    }
  })

  test("matches AI SDK wrapper via message and via nested cause", () => {
    const bun = Object.assign(new Error("The socket connection was closed unexpectedly"), { code: "ECONNRESET" })
    // AI SDK shape: message already contains the text (matches directly)...
    const apiErr = Object.assign(new Error("Cannot connect to API: The socket connection was closed unexpectedly"), {
      name: "AI_APICallError",
      isRetryable: true,
      cause: bun,
    })
    expect(isTransientConnectionError(apiErr)).toBe(true)
    // ...and even when the wrapper message is opaque, the cause is inspected.
    const opaque = Object.assign(new Error("upstream error"), { name: "AI_APICallError", cause: bun })
    expect(isTransientConnectionError(opaque)).toBe(true)
  })

  test("matches AggregateError with a transient inner error", () => {
    const agg = Object.assign(new Error("all attempts failed"), {
      errors: [new Error("boom"), Object.assign(new Error("x"), { code: "ECONNRESET" })],
    })
    expect(isTransientConnectionError(agg)).toBe(true)
  })

  test("does NOT retry user/timeout aborts", () => {
    expect(isTransientConnectionError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false)
    expect(isTransientConnectionError(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe(false)
    // An abort whose cause looks transient is still not retried (an abort is an abort).
    const abortWithCause = Object.assign(new Error("aborted"), {
      name: "AbortError",
      cause: Object.assign(new Error("x"), { code: "ECONNRESET" }),
    })
    expect(isTransientConnectionError(abortWithCause)).toBe(false)
  })

  test("does NOT match non-connection errors", () => {
    expect(isTransientConnectionError(new Error("Rate limited"))).toBe(false)
    expect(isTransientConnectionError(Object.assign(new Error("bad request"), { statusCode: 400 }))).toBe(false)
    expect(isTransientConnectionError(null)).toBe(false)
    expect(isTransientConnectionError(undefined)).toBe(false)
    expect(isTransientConnectionError("ECONNRESET")).toBe(false)
  })

  test("does not infinite-loop on a self-referential cause", () => {
    const e: { message: string; cause?: unknown } = { message: "weird" }
    e.cause = e
    expect(isTransientConnectionError(e)).toBe(false)
  })
})

describe("fetchWithConnectRetry", () => {
  test("returns immediately on success (no retry)", async () => {
    let calls = 0
    const res = await fetchWithConnectRetry(
      async () => {
        calls++
        return ok()
      },
      { sleepMs: () => 0 },
    )
    expect(res.status).toBe(200)
    expect(calls).toBe(1)
  })

  test("retries a transient socket close, then succeeds (the z.ai case)", async () => {
    let calls = 0
    const retried: number[] = []
    const res = await fetchWithConnectRetry(
      async () => {
        calls++
        if (calls === 1) throw reset()
        return ok()
      },
      { sleepMs: () => 0, onRetry: (attempt) => retried.push(attempt) },
    )
    expect(res.status).toBe(200)
    expect(calls).toBe(2) // failed once, succeeded on the immediate retry
    expect(retried).toEqual([1])
  })

  test("gives up after maxRetries and rethrows the original error", async () => {
    let calls = 0
    await expect(
      fetchWithConnectRetry(
        async () => {
          calls++
          throw reset()
        },
        { sleepMs: () => 0 },
      ),
    ).rejects.toThrow("socket connection was closed")
    expect(calls).toBe(3) // initial + 2 retries
  })

  test("does not retry a non-transient error", async () => {
    let calls = 0
    await expect(
      fetchWithConnectRetry(
        async () => {
          calls++
          throw new Error("400 Bad Request")
        },
        { sleepMs: () => 0 },
      ),
    ).rejects.toThrow("400 Bad Request")
    expect(calls).toBe(1)
  })

  test("does not retry once the abort signal is aborted", async () => {
    const ctl = new AbortController()
    ctl.abort()
    let calls = 0
    await expect(
      fetchWithConnectRetry(
        async () => {
          calls++
          throw reset()
        },
        { signal: ctl.signal, sleepMs: () => 0 },
      ),
    ).rejects.toThrow("socket connection was closed")
    expect(calls).toBe(1)
  })
})
