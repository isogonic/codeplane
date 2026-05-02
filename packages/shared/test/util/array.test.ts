import { describe, expect, test } from "bun:test"
import { findLast } from "../../src/util/array"

describe("findLast", () => {
  test("finds the last matching element", () => {
    expect(findLast([1, 2, 3, 4, 5], (x) => x % 2 === 0)).toBe(4)
  })

  test("returns undefined when no match", () => {
    expect(findLast([1, 3, 5], (x) => x % 2 === 0)).toBeUndefined()
  })

  test("returns undefined for empty array", () => {
    expect(findLast([], () => true)).toBeUndefined()
  })

  test("works with single element matching", () => {
    expect(findLast([42], (x) => x === 42)).toBe(42)
  })

  test("works with single element not matching", () => {
    expect(findLast([42], (x) => x === 43)).toBeUndefined()
  })

  test("works with strings", () => {
    expect(findLast(["a", "b", "c", "ab"], (x) => x.length === 2)).toBe("ab")
  })

  test("works with objects", () => {
    const arr = [{ id: 1, ok: true }, { id: 2, ok: false }, { id: 3, ok: true }]
    expect(findLast(arr, (x) => x.ok)).toEqual({ id: 3, ok: true })
  })

  test("predicate gets correct index", () => {
    const indices: number[] = []
    findLast([10, 20, 30], (_, i) => {
      indices.push(i)
      return false
    })
    expect(indices).toEqual([2, 1, 0])
  })

  test("predicate gets the array reference", () => {
    const arr = [1, 2, 3]
    let received: readonly number[] | undefined
    findLast(arr, (_, __, all) => {
      received = all
      return false
    })
    expect(received).toBe(arr)
  })

  test("returns first matching from end", () => {
    expect(findLast([1, 2, 2, 3, 2], (x) => x === 2)).toBe(2)
  })

  test("works with all elements matching", () => {
    expect(findLast([1, 2, 3], () => true)).toBe(3)
  })

  test("works with no elements matching", () => {
    expect(findLast([1, 2, 3], () => false)).toBeUndefined()
  })

  test("supports null/undefined elements", () => {
    expect(findLast([1, null, 2, null], (x) => x === null)).toBeNull()
  })

  test("undefined is returned for empty match", () => {
    expect(findLast([undefined], (x) => x === undefined)).toBeUndefined()
  })

  test("works with booleans", () => {
    expect(findLast([true, false, true, false], (x) => x === true)).toBe(true)
  })

  test("works with mixed types", () => {
    const arr: any[] = [1, "a", true, null, { x: 1 }]
    expect(findLast(arr, (x) => typeof x === "number")).toBe(1)
  })

  test("very large arrays", () => {
    const arr = Array.from({ length: 10000 }, (_, i) => i)
    expect(findLast(arr, (x) => x === 5000)).toBe(5000)
  })

  test("predicate called with all 3 args", () => {
    const calls: any[] = []
    findLast([10, 20], (item, idx, all) => {
      calls.push([item, idx, all])
      return false
    })
    expect(calls.length).toBe(2)
    expect(calls[0][0]).toBe(20)
    expect(calls[0][1]).toBe(1)
    expect(calls[1][0]).toBe(10)
    expect(calls[1][1]).toBe(0)
  })

  test("returns undefined and not null for no match", () => {
    const result = findLast([1, 2, 3], () => false)
    expect(result).toBeUndefined()
    expect(result === null).toBe(false)
  })

  test("does not mutate input array", () => {
    const arr = [1, 2, 3]
    findLast(arr, () => true)
    expect(arr).toEqual([1, 2, 3])
  })

  test("handles arrays with NaN", () => {
    const arr = [1, NaN, 2]
    expect(findLast(arr, (x) => Number.isNaN(x))).toBeNaN()
  })

  test("handles sparse-like values", () => {
    expect(findLast([0, 0, 0, 1], (x) => x === 0)).toBe(0)
  })

  test("respects readonly arrays", () => {
    const arr: readonly number[] = [1, 2, 3]
    expect(findLast(arr, (x) => x === 2)).toBe(2)
  })

  test("predicate exception propagates", () => {
    expect(() =>
      findLast([1, 2, 3], () => {
        throw new Error("boom")
      }),
    ).toThrow("boom")
  })

  test("only iterates until match", () => {
    let count = 0
    findLast([1, 2, 3, 4, 5], (x) => {
      count++
      return x === 4
    })
    expect(count).toBe(2)
  })

  test("symbol predicates", () => {
    const s = Symbol("k")
    expect(findLast([Symbol("a"), s, Symbol("b")], (x) => x === s)).toBe(s)
  })

  test("date predicates", () => {
    const target = new Date(2020, 0, 1)
    const arr = [new Date(2019, 0, 1), target, new Date(2021, 0, 1)]
    expect(findLast(arr, (x) => x.getFullYear() === 2020)).toBe(target)
  })
})
