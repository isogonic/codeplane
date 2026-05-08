import { describe, expect, test } from "bun:test"
import { AsyncQueue, work } from "../src/util/queue"

describe("AsyncQueue", () => {
  test("push then next resolves immediately", async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    expect(await q.next()).toBe(1)
  })
  test("next then push resolves", async () => {
    const q = new AsyncQueue<number>()
    const promise = q.next()
    q.push(42)
    expect(await promise).toBe(42)
  })
  test("FIFO ordering", async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)
    expect(await q.next()).toBe(1)
    expect(await q.next()).toBe(2)
    expect(await q.next()).toBe(3)
  })
  test("multiple pending consumers get values in order", async () => {
    const q = new AsyncQueue<number>()
    const a = q.next()
    const b = q.next()
    q.push(1)
    q.push(2)
    expect(await a).toBe(1)
    expect(await b).toBe(2)
  })
  test("works with strings", async () => {
    const q = new AsyncQueue<string>()
    q.push("hello")
    expect(await q.next()).toBe("hello")
  })
  test("works with objects", async () => {
    const q = new AsyncQueue<{ id: number }>()
    q.push({ id: 1 })
    // next() now returns T | undefined (undefined signals end-of-stream
    // after close()). Open queue with a value buffered → never undefined.
    const out = await q.next()
    expect(out?.id).toBe(1)
  })
  test("async iterator yields values", async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    const it = q[Symbol.asyncIterator]()
    expect((await it.next()).value).toBe(1)
    expect((await it.next()).value).toBe(2)
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk push/next #${i}`, async () => {
      const q = new AsyncQueue<number>()
      q.push(i)
      expect(await q.next()).toBe(i)
    })
  }

  test("maxSize drops oldest item when full and invokes onDrop", () => {
    const dropped: number[] = []
    const q = new AsyncQueue<number>({ maxSize: 3, onDrop: (n) => dropped.push(n) })
    q.push(1)
    q.push(2)
    q.push(3)
    q.push(4) // forces 1 to be dropped
    q.push(5) // forces 2 to be dropped
    expect(dropped).toEqual([1, 2])
    expect(q.size).toBe(3)
  })

  test("maxSize does not drop when a consumer is waiting", async () => {
    const dropped: number[] = []
    const q = new AsyncQueue<number>({ maxSize: 1, onDrop: (n) => dropped.push(n) })
    const pending = q.next()
    q.push(99)
    expect(await pending).toBe(99)
    expect(dropped).toEqual([])
  })

  test("close ends pending consumers with undefined", async () => {
    const q = new AsyncQueue<number>()
    const pending = q.next()
    q.close()
    expect(await pending).toBeUndefined()
  })

  test("close terminates async iteration after draining buffered items", async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    q.close()
    const seen: number[] = []
    for await (const n of q) seen.push(n)
    expect(seen).toEqual([1, 2])
  })

  test("push after close is silently dropped", () => {
    const q = new AsyncQueue<number>()
    q.close()
    q.push(1)
    expect(q.size).toBe(0)
  })

  test("clear discards buffered items", () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    q.clear()
    expect(q.size).toBe(0)
  })
})

describe("work concurrent", () => {
  test("processes all items", async () => {
    const items = [1, 2, 3, 4, 5]
    let count = 0
    await work(2, items, async () => {
      count++
    })
    expect(count).toBe(5)
  })
  test("respects concurrency 1", async () => {
    let active = 0
    let max = 0
    await work(1, [1, 2, 3, 4], async () => {
      active++
      max = Math.max(max, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    expect(max).toBe(1)
  })
  test("respects concurrency 3", async () => {
    let active = 0
    let max = 0
    await work(3, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], async () => {
      active++
      max = Math.max(max, active)
      await new Promise((r) => setTimeout(r, 1))
      active--
    })
    expect(max).toBeLessThanOrEqual(3)
  })
  test("empty items resolves immediately", async () => {
    let calls = 0
    await work(2, [], async () => {
      calls++
    })
    expect(calls).toBe(0)
  })
  for (let i = 1; i <= 20; i++) {
    test(`bulk processes ${i} items`, async () => {
      let counted = 0
      // Array.from({length: n}) creates an array of n undefined values; pop()
      // returns undefined which the worker treats as "done", so use real values.
      await work(2, Array.from({ length: i }, (_, idx) => idx + 1), async () => {
        counted++
      })
      expect(counted).toBe(i)
    })
  }
})
