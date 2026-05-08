import { describe, expect, test } from "bun:test"
import { AsyncQueue, work } from "../../src/util/queue"

describe("AsyncQueue", () => {
  test("yields pushed items via next()", async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    expect(await q.next()).toBe(1)
    expect(await q.next()).toBe(2)
  })

  test("waits for items pushed after next()", async () => {
    const q = new AsyncQueue<string>()
    const promise = q.next()
    q.push("hi")
    expect(await promise).toBe("hi")
  })

  test("preserves FIFO order", async () => {
    const q = new AsyncQueue<number>()
    for (let i = 0; i < 5; i++) q.push(i)
    const out: number[] = []
    // next() returns T | undefined since AsyncQueue gained close() —
    // an open queue with buffered items never returns undefined here.
    for (let i = 0; i < 5; i++) out.push((await q.next())!)
    expect(out).toEqual([0, 1, 2, 3, 4])
  })

  test("supports multiple waiting consumers", async () => {
    const q = new AsyncQueue<number>()
    const a = q.next()
    const b = q.next()
    q.push(10)
    q.push(20)
    expect(await a).toBe(10)
    expect(await b).toBe(20)
  })

  test("supports asyncIterator interface", async () => {
    const q = new AsyncQueue<number>()
    setTimeout(() => {
      q.push(1)
      q.push(2)
      q.push(3)
    }, 5)
    const out: number[] = []
    for await (const v of q) {
      out.push(v)
      if (out.length === 3) break
    }
    expect(out).toEqual([1, 2, 3])
  })

  test("queue persists items pushed before consumers", async () => {
    const q = new AsyncQueue<number>()
    q.push(99)
    expect(await q.next()).toBe(99)
  })

  test("works with object items", async () => {
    const q = new AsyncQueue<{ id: number }>()
    q.push({ id: 1 })
    expect(await q.next()).toEqual({ id: 1 })
  })

  test("works with undefined values", async () => {
    const q = new AsyncQueue<undefined>()
    q.push(undefined)
    expect(await q.next()).toBeUndefined()
  })
})

describe("work", () => {
  test("processes all items", async () => {
    const items = [1, 2, 3, 4, 5]
    const seen: number[] = []
    await work(2, items, async (x) => {
      seen.push(x)
    })
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5])
  })

  test("processes empty array", async () => {
    let count = 0
    await work(3, [], async () => {
      count++
    })
    expect(count).toBe(0)
  })

  test("respects concurrency limit", async () => {
    let active = 0
    let max = 0
    const items = Array.from({ length: 10 }, (_, i) => i)
    await work(3, items, async () => {
      active++
      max = Math.max(max, active)
      await new Promise((r) => setTimeout(r, 1))
      active--
    })
    expect(max).toBeLessThanOrEqual(3)
  })

  test("propagates errors", async () => {
    await expect(
      work(2, [1, 2, 3], async (x) => {
        if (x === 2) throw new Error("fail")
      }),
    ).rejects.toThrow("fail")
  })

  test("concurrency 1 processes serially", async () => {
    const items = [1, 2, 3]
    const seen: number[] = []
    await work(1, items, async (x) => {
      await new Promise((r) => setTimeout(r, 1))
      seen.push(x)
    })
    expect(seen.sort()).toEqual([1, 2, 3])
  })

  test("does not mutate original array", async () => {
    const items = [1, 2, 3]
    await work(1, items, async () => {})
    expect(items).toEqual([1, 2, 3])
  })

  test("works with async functions", async () => {
    const items = [1, 2, 3]
    const out: number[] = []
    await work(2, items, async (x) => {
      await Promise.resolve()
      out.push(x * 2)
    })
    expect(out.sort()).toEqual([2, 4, 6])
  })

  test("concurrency higher than items still works", async () => {
    const items = [1, 2]
    const out: number[] = []
    await work(10, items, async (x) => {
      out.push(x)
    })
    expect(out.sort()).toEqual([1, 2])
  })
})
