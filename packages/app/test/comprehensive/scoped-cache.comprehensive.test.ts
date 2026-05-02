import { describe, expect, test } from "bun:test"
import { createScopedCache } from "../../src/utils/scoped-cache"

describe("scoped-cache basic", () => {
  test("get creates value on miss", () => {
    const cache = createScopedCache((key) => key.toUpperCase())
    expect(cache.get("a")).toBe("A")
  })
  test("get returns cached value on hit", () => {
    let calls = 0
    const cache = createScopedCache(() => {
      calls++
      return calls
    })
    expect(cache.get("a")).toBe(1)
    expect(cache.get("a")).toBe(1)
  })
  test("delete removes entry", () => {
    const cache = createScopedCache(() => "v")
    cache.get("a")
    expect(cache.delete("a")).toBe("v")
    expect(cache.peek("a")).toBeUndefined()
  })
  test("clear removes all", () => {
    const cache = createScopedCache(() => "v")
    cache.get("a")
    cache.get("b")
    cache.clear()
    expect(cache.peek("a")).toBeUndefined()
    expect(cache.peek("b")).toBeUndefined()
  })
  test("peek does not create entry", () => {
    let calls = 0
    const cache = createScopedCache(() => {
      calls++
      return "v"
    })
    cache.peek("a")
    expect(calls).toBe(0)
  })
  test("respects maxEntries", () => {
    const cache = createScopedCache((k) => k, { maxEntries: 2 })
    cache.get("a")
    cache.get("b")
    cache.get("c")
    expect(cache.peek("a")).toBeUndefined()
    expect(cache.peek("b")).toBe("b")
    expect(cache.peek("c")).toBe("c")
  })
  test("dispose called on eviction", () => {
    const disposed: string[] = []
    const cache = createScopedCache((k) => k, {
      maxEntries: 1,
      dispose: (v) => disposed.push(v),
    })
    cache.get("a")
    cache.get("b")
    expect(disposed).toEqual(["a"])
  })
  test("ttl expires entries", () => {
    let clock = 0
    const cache = createScopedCache((k) => k, { ttlMs: 100, now: () => clock })
    cache.get("a")
    clock = 50
    expect(cache.peek("a")).toBe("a")
    clock = 200
    expect(cache.peek("a")).toBeUndefined()
  })
  test("get on expired creates new value", () => {
    let clock = 0
    let count = 0
    const cache = createScopedCache(
      () => ++count,
      { ttlMs: 100, now: () => clock },
    )
    expect(cache.get("a")).toBe(1)
    clock = 200
    expect(cache.get("a")).toBe(2)
  })
  for (let i = 0; i < 50; i++) {
    test(`bulk get/peek #${i}`, () => {
      const cache = createScopedCache((k) => `v-${k}`)
      cache.get(`key-${i}`)
      expect(cache.peek(`key-${i}`)).toBe(`v-key-${i}`)
    })
  }
})

describe("scoped-cache LRU touches", () => {
  test("touching prevents eviction", () => {
    const cache = createScopedCache((k) => k, { maxEntries: 2 })
    cache.get("a")
    cache.get("b")
    cache.get("a") // touch a
    cache.get("c") // should evict b
    expect(cache.peek("a")).toBe("a")
    expect(cache.peek("b")).toBeUndefined()
    expect(cache.peek("c")).toBe("c")
  })
  test("delete returns previous value", () => {
    const cache = createScopedCache(() => "v")
    cache.get("a")
    expect(cache.delete("a")).toBe("v")
  })
  test("delete on missing returns undefined", () => {
    const cache = createScopedCache(() => "v")
    expect(cache.delete("missing")).toBeUndefined()
  })
  test("delete dispose called", () => {
    const disposed: string[] = []
    const cache = createScopedCache((k) => k, {
      dispose: (v) => disposed.push(v),
    })
    cache.get("a")
    cache.delete("a")
    expect(disposed).toEqual(["a"])
  })
  for (let i = 0; i < 50; i++) {
    test(`maxEntries bulk #${i}`, () => {
      const cache = createScopedCache((k) => k, { maxEntries: 1 })
      cache.get(`a-${i}`)
      cache.get(`b-${i}`)
      expect(cache.peek(`a-${i}`)).toBeUndefined()
      expect(cache.peek(`b-${i}`)).toBe(`b-${i}`)
    })
  }
})
