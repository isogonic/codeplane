import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import { checkServerHealth } from "./server-health"

const server: ServerConnection.HttpBase = {
  url: "http://localhost:4096",
}

function abortFromInput(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.signal) return init.signal
  if (input instanceof Request) return input.signal
  return undefined
}

describe("checkServerHealth", () => {
  test("returns healthy response with version", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch)

    expect(result).toEqual({ healthy: true, version: "1.2.3" })
  })

  test("returns unhealthy when request fails", async () => {
    const fetch = (async () => {
      throw new Error("network")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch)

    expect(result).toEqual({ healthy: false })
  })

  test("uses timeout fallback when AbortSignal.timeout is unavailable", async () => {
    const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: undefined,
    })

    let aborted = false
    const fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = abortFromInput(input, init)
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(new DOMException("Aborted", "AbortError"))
          },
          { once: true },
        )
      })) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      timeoutMs: 10,
    }).finally(() => {
      if (timeout) Object.defineProperty(AbortSignal, "timeout", timeout)
      if (!timeout) Reflect.deleteProperty(AbortSignal, "timeout")
    })

    expect(aborted).toBe(true)
    expect(result).toEqual({ healthy: false })
  })

  test("uses provided abort signal", async () => {
    let signal: AbortSignal | undefined
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      signal = abortFromInput(input, init)
      return new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const abort = new AbortController()
    await checkServerHealth(server, fetch, {
      signal: abort.signal,
    })

    expect(signal).toBe(abort.signal)
  })

  test("retries transient failures and eventually succeeds", async () => {
    let count = 0
    const fetch = (async () => {
      count += 1
      if (count < 3) throw new TypeError("network")
      return new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      retryCount: 2,
      retryDelayMs: 1,
    })

    expect(count).toBe(3)
    expect(result).toEqual({ healthy: true, version: "1.2.3" })
  })

  test("returns unhealthy when retries are exhausted", async () => {
    let count = 0
    const fetch = (async () => {
      count += 1
      throw new TypeError("network")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      retryCount: 2,
      retryDelayMs: 1,
    })

    expect(count).toBe(3)
    expect(result).toEqual({ healthy: false })
  })

  test("does not retry when an AbortError is thrown", async () => {
    let count = 0
    const fetch = (async () => {
      count += 1
      throw new DOMException("Aborted", "AbortError")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      retryCount: 5,
      retryDelayMs: 1,
    })

    expect(count).toBe(1)
    expect(result).toEqual({ healthy: false })
  })

  test("does not retry on a non-network error", async () => {
    let count = 0
    const fetch = (async () => {
      count += 1
      throw new Error("syntax problem in response")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      retryCount: 5,
      retryDelayMs: 1,
    })

    expect(count).toBe(1)
    expect(result).toEqual({ healthy: false })
  })

  test("retries on errors whose message matches network keywords", async () => {
    let count = 0
    const fetch = (async () => {
      count += 1
      if (count < 2) throw new Error("ECONNREFUSED")
      return new Response(JSON.stringify({ healthy: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      retryCount: 2,
      retryDelayMs: 1,
    })

    expect(count).toBe(2)
    expect(result.healthy).toBe(true)
  })

  test("returns healthy=false when response data is empty", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch)

    expect(result).toEqual({ healthy: false, version: undefined })
  })

  test("aborts cleanly if signal is already aborted before retry wait", async () => {
    const controller = new AbortController()
    let count = 0
    const fetch = (async () => {
      count += 1
      controller.abort()
      throw new TypeError("network")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      signal: controller.signal,
      retryCount: 3,
      retryDelayMs: 1000,
    })

    expect(count).toBe(1)
    expect(result).toEqual({ healthy: false })
  })
})
