import { describe, expect, test } from "bun:test"
import { retry } from "../src/util/retry"

describe("retry success", () => {
  test("returns immediately when first attempt succeeds", async () => {
    let calls = 0
    const result = await retry(async () => {
      calls++
      return "ok"
    })
    expect(result).toBe("ok")
    expect(calls).toBe(1)
  })
  test("returns value on first success", async () => {
    expect(await retry(async () => 42)).toBe(42)
  })
  test("works with sync values returned in async", async () => {
    expect(await retry(async () => "hi")).toBe("hi")
  })
})

describe("retry on transient errors", () => {
  test("retries on 'load failed'", async () => {
    let calls = 0
    const result = await retry(
      async () => {
        calls++
        if (calls < 2) throw new Error("Load failed")
        return "done"
      },
      { delay: 1, attempts: 3 },
    )
    expect(result).toBe("done")
    expect(calls).toBe(2)
  })
  test("retries on 'network connection was lost'", async () => {
    let calls = 0
    const result = await retry(
      async () => {
        calls++
        if (calls < 3) throw new Error("Network connection was lost")
        return "ok"
      },
      { delay: 1, attempts: 5 },
    )
    expect(result).toBe("ok")
    expect(calls).toBe(3)
  })
  test("retries on 'failed to fetch'", async () => {
    let calls = 0
    await retry(
      async () => {
        calls++
        if (calls < 2) throw new Error("Failed to fetch")
        return "ok"
      },
      { delay: 1 },
    )
    expect(calls).toBe(2)
  })
  test("retries on ECONNRESET", async () => {
    let calls = 0
    await retry(
      async () => {
        calls++
        if (calls < 2) throw new Error("ECONNRESET happened")
        return "ok"
      },
      { delay: 1 },
    )
    expect(calls).toBe(2)
  })
  test("retries on ETIMEDOUT", async () => {
    let calls = 0
    await retry(
      async () => {
        calls++
        if (calls < 2) throw new Error("ETIMEDOUT remote")
        return "ok"
      },
      { delay: 1 },
    )
    expect(calls).toBe(2)
  })
  test("retries on socket hang up", async () => {
    let calls = 0
    await retry(
      async () => {
        calls++
        if (calls < 2) throw new Error("socket hang up")
        return "ok"
      },
      { delay: 1 },
    )
    expect(calls).toBe(2)
  })
})

describe("retry exhaustion", () => {
  test("throws after attempts exhausted", async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls++
          throw new Error("network connection was lost")
        },
        { delay: 1, attempts: 3 },
      ),
    ).rejects.toThrow("network connection was lost")
    expect(calls).toBe(3)
  })
  test("does not retry on non-transient errors", async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls++
          throw new Error("validation error")
        },
        { delay: 1, attempts: 5 },
      ),
    ).rejects.toThrow("validation error")
    expect(calls).toBe(1)
  })
  test("throws original error not a wrapped one", async () => {
    const original = new Error("custom-non-transient")
    let thrown: unknown
    try {
      await retry(async () => {
        throw original
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(original)
  })
})

describe("retry custom retryIf", () => {
  test("custom retry function controls retries", async () => {
    let calls = 0
    await retry(
      async () => {
        calls++
        if (calls < 3) throw new Error("custom error")
        return "ok"
      },
      { delay: 1, retryIf: (e) => (e as Error).message.includes("custom") },
    )
    expect(calls).toBe(3)
  })
  test("custom retry function can refuse retries", async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls++
          throw new Error("custom error")
        },
        { delay: 1, retryIf: () => false },
      ),
    ).rejects.toThrow()
    expect(calls).toBe(1)
  })
})

describe("retry options", () => {
  test("respects attempts option", async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls++
          throw new Error("etimedout")
        },
        { attempts: 2, delay: 1 },
      ),
    ).rejects.toThrow()
    expect(calls).toBe(2)
  })
  test("respects custom delay (no real wait verification)", async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls++
          throw new Error("etimedout")
        },
        { attempts: 2, delay: 5, factor: 1, maxDelay: 5 },
      ),
    ).rejects.toThrow()
    expect(calls).toBe(2)
  })
  test("attempts default is 3", async () => {
    let calls = 0
    await expect(
      retry(async () => {
        calls++
        throw new Error("etimedout")
      }, { delay: 1 }),
    ).rejects.toThrow()
    expect(calls).toBe(3)
  })
})

describe("retry varied transient detection", () => {
  const transient = [
    "load failed",
    "Load Failed",
    "LOAD FAILED",
    "network request failed",
    "Failed to fetch",
    "ECONNRESET",
    "ECONNREFUSED",
    "etimedout",
    "Socket Hang Up",
  ]
  for (const message of transient) {
    test(`detects "${message}" as transient`, async () => {
      let calls = 0
      await expect(
        retry(
          async () => {
            calls++
            throw new Error(message)
          },
          { delay: 1, attempts: 2 },
        ),
      ).rejects.toThrow()
      expect(calls).toBe(2)
    })
  }
})
