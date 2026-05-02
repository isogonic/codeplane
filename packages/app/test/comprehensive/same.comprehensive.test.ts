import { describe, expect, test } from "bun:test"
import { same } from "../../src/utils/same"

describe("same", () => {
  test("undefined a returns false", () => expect(same(undefined, [])).toBe(false))
  test("undefined b returns false", () => expect(same([], undefined)).toBe(false))
  test("both undefined returns true", () => expect(same(undefined, undefined)).toBe(true))
  test("same reference returns true", () => {
    const arr = [1, 2, 3]
    expect(same(arr, arr)).toBe(true)
  })
  test("equal arrays return true", () =>
    expect(same([1, 2, 3], [1, 2, 3])).toBe(true))
  test("different lengths return false", () =>
    expect(same([1, 2], [1, 2, 3])).toBe(false))
  test("different values return false", () =>
    expect(same([1, 2, 3], [1, 2, 4])).toBe(false))
  test("empty arrays equal", () => expect(same([], [])).toBe(true))
  test("strings", () => expect(same(["a", "b"], ["a", "b"])).toBe(true))
  test("strings differ", () => expect(same(["a", "b"], ["a", "c"])).toBe(false))
  for (let n = 0; n < 30; n++) {
    test(`bulk equal at length ${n}`, () => {
      const a = Array.from({ length: n }, (_, i) => i)
      const b = Array.from({ length: n }, (_, i) => i)
      expect(same(a, b)).toBe(true)
    })
  }
  for (let n = 1; n < 30; n++) {
    test(`bulk inequal at length ${n}`, () => {
      const a = Array.from({ length: n }, (_, i) => i)
      const b = Array.from({ length: n }, (_, i) => i + 1)
      expect(same(a, b)).toBe(false)
    })
  }
})
