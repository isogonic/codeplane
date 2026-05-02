import { describe, expect, test } from "bun:test"
import { findLast } from "../src/util/array"

describe("findLast - basics", () => {
  test("empty array returns undefined", () => {
    expect(findLast([], () => true)).toBeUndefined()
  })
  test("returns last matching", () => {
    expect(findLast([1, 2, 3, 4], (n) => n > 2)).toBe(4)
  })
  test("returns last matching with multiple equal", () => {
    expect(findLast([1, 2, 2, 3, 2], (n) => n === 2)).toBe(2)
  })
  test("predicate never true returns undefined", () => {
    expect(findLast([1, 2, 3], () => false)).toBeUndefined()
  })
  test("predicate always true returns last item", () => {
    expect(findLast([1, 2, 3], () => true)).toBe(3)
  })
  test("works on single-element arrays", () => {
    expect(findLast([42], (n) => n === 42)).toBe(42)
    expect(findLast([42], (n) => n === 0)).toBeUndefined()
  })
  test("predicate receives index", () => {
    const indices: number[] = []
    findLast([10, 20, 30], (_value, idx) => {
      indices.push(idx)
      return false
    })
    expect(indices).toEqual([2, 1, 0])
  })
  test("predicate receives original array", () => {
    const arr = [1, 2, 3]
    let seen: readonly number[] | undefined
    findLast(arr, (_v, _i, list) => {
      seen = list
      return true
    })
    expect(seen).toBe(arr)
  })
})

describe("findLast - types", () => {
  test("works with strings", () => {
    expect(findLast(["alpha", "beta", "gamma"], (s) => s.startsWith("g"))).toBe("gamma")
  })
  test("works with objects", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(findLast(items, (o) => o.id > 1)?.id).toBe(3)
  })
  test("works with null and undefined items", () => {
    expect(findLast([null, undefined, 1, null, 2], (v) => v === null)).toBeNull()
    expect(findLast([null, undefined, 1, undefined], (v) => v === undefined)).toBeUndefined()
  })
  test("works with booleans", () => {
    expect(findLast([true, false, true, false], (v) => v)).toBe(true)
  })
  test("works with mixed types", () => {
    expect(findLast([1, "x", true, null, undefined], (v) => typeof v === "string")).toBe("x")
  })
})

describe("findLast - bulk parameterized", () => {
  for (let length = 1; length <= 50; length++) {
    test(`length=${length} finds last odd number`, () => {
      const arr = Array.from({ length }, (_, i) => i + 1)
      const lastOdd = arr[arr.length - 1] % 2 === 1 ? arr[arr.length - 1] : arr[arr.length - 2]
      expect(findLast(arr, (n) => n % 2 === 1)).toBe(lastOdd)
    })
  }
  for (let length = 1; length <= 50; length++) {
    test(`length=${length} finds last value greater than 0`, () => {
      const arr = Array.from({ length }, (_, i) => i + 1)
      expect(findLast(arr, (n) => n > 0)).toBe(length)
    })
  }
  for (let length = 1; length <= 50; length++) {
    test(`length=${length} finds none for predicate that's always false`, () => {
      const arr = Array.from({ length }, (_, i) => i)
      expect(findLast(arr, () => false)).toBeUndefined()
    })
  }
})

describe("findLast - edge", () => {
  test("works with sparse-like arrays", () => {
    const arr = new Array(5)
    arr[0] = "a"
    arr[3] = "b"
    expect(findLast(arr, (v) => v === "b")).toBe("b")
  })
  test("respects readonly array semantics", () => {
    const ro: ReadonlyArray<number> = [1, 2, 3]
    expect(findLast(ro, (n) => n === 2)).toBe(2)
  })
  test("does not mutate input", () => {
    const arr = [1, 2, 3]
    findLast(arr, (n) => n === 2)
    expect(arr).toEqual([1, 2, 3])
  })
  test("works on 1000-element array", () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i)
    expect(findLast(arr, (n) => n < 5)).toBe(4)
  })
  test("works when predicate is async-like", () => {
    const arr = [1, 2, 3]
    expect(findLast(arr, (n) => n + 1 > 3)).toBe(3)
  })
})
