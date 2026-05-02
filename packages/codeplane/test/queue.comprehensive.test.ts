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
    expect((await q.next()).id).toBe(1)
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
