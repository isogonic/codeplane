import { describe, expect, test } from "bun:test"
import { retry } from "../../src/util/retry"

describe("retry", () => {
  test("returns successful result without retries", async () => {
    const result = await retry(async () => 42)
    expect(result).toBe(42)
  })

  test("retries on transient error and eventually succeeds", async () => {
    let count = 0
    const result = await retry(async () => {
      count++
      if (count < 3) throw new Error("Network connection was lost")
      return "ok"
    }, { delay: 1, factor: 1 })
    expect(result).toBe("ok")
    expect(count).toBe(3)
  })

  test("does not retry on non-transient error", async () => {
    let count = 0
    await expect(
      retry(async () => {
        count++
        throw new Error("permanent failure")
      }, { delay: 1 }),
    ).rejects.toThrow("permanent failure")
    expect(count).toBe(1)
  })

  test("respects max attempts", async () => {
    let count = 0
    await expect(
      retry(async () => {
        count++
        throw new Error("ECONNRESET")
      }, { attempts: 4, delay: 1, factor: 1 }),
    ).rejects.toThrow("ECONNRESET")
    expect(count).toBe(4)
  })

  test("default attempts is 3", async () => {
    let count = 0
    await expect(
      retry(async () => {
        count++
        throw new Error("network request failed")
      }, { delay: 1, factor: 1 }),
    ).rejects.toThrow()
    expect(count).toBe(3)
  })

  test("custom retryIf function works", async () => {
    let count = 0
    await expect(
      retry(
        async () => {
          count++
          throw new Error("any error")
        },
        { delay: 1, attempts: 3, retryIf: () => true, factor: 1 },
      ),
    ).rejects.toThrow()
    expect(count).toBe(3)
  })

  test("custom retryIf can prevent retries", async () => {
    let count = 0
    await expect(
      retry(
        async () => {
          count++
          throw new Error("ECONNRESET")
        },
        { retryIf: () => false },
      ),
    ).rejects.toThrow()
    expect(count).toBe(1)
  })

  test("retries on socket hang up", async () => {
    let count = 0
    const result = await retry(async () => {
      count++
      if (count < 2) throw new Error("socket hang up")
      return "x"
    }, { delay: 1, factor: 1 })
    expect(result).toBe("x")
    expect(count).toBe(2)
  })

  test("retries on ECONNREFUSED", async () => {
    let count = 0
    const result = await retry(async () => {
      count++
      if (count < 2) throw new Error("ECONNREFUSED 127.0.0.1:80")
      return "ok"
    }, { delay: 1, factor: 1 })
    expect(count).toBe(2)
    expect(result).toBe("ok")
  })

  test("retries on ETIMEDOUT", async () => {
    let count = 0
    await expect(
      retry(async () => {
        count++
        throw new Error("ETIMEDOUT")
      }, { attempts: 2, delay: 1, factor: 1 }),
    ).rejects.toThrow()
    expect(count).toBe(2)
  })

  test("retries on 'failed to fetch'", async () => {
    let count = 0
    const result = await retry(async () => {
      count++
      if (count < 2) throw new Error("Failed to fetch")
      return 1
    }, { delay: 1, factor: 1 })
    expect(result).toBe(1)
  })

  test("retries on 'Load failed'", async () => {
    let count = 0
    const result = await retry(async () => {
      count++
      if (count < 2) throw new Error("Load failed")
      return 1
    }, { delay: 1, factor: 1 })
    expect(result).toBe(1)
  })

  test("retries with non-Error transient", async () => {
    let count = 0
    const result = await retry(
      async () => {
        count++
        if (count < 2) throw "ECONNRESET reason string"
        return 1
      },
      { delay: 1, factor: 1 },
    )
    expect(result).toBe(1)
  })

  test("respects exponential backoff cap (maxDelay)", async () => {
    let count = 0
    const start = Date.now()
    await expect(
      retry(async () => {
        count++
        throw new Error("ECONNRESET")
      }, { attempts: 3, delay: 1, factor: 100, maxDelay: 5 }),
    ).rejects.toThrow()
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(200)
  })

  test("returns first attempt result without delay", async () => {
    const start = Date.now()
    await retry(async () => "x", { delay: 1000 })
    expect(Date.now() - start).toBeLessThan(50)
  })
})
