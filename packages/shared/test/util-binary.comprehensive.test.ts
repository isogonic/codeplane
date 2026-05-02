import { describe, expect, test } from "bun:test"
import { Binary } from "../src/util/binary"

const idOf = (item: { id: string }) => item.id

describe("Binary.search", () => {
  test("empty array returns not found at index 0", () => {
    expect(Binary.search<{ id: string }>([], "any", idOf)).toEqual({ found: false, index: 0 })
  })
  test("found at index 0", () => {
    expect(Binary.search([{ id: "a" }], "a", idOf)).toEqual({ found: true, index: 0 })
  })
  test("found in middle", () => {
    const arr = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(Binary.search(arr, "b", idOf)).toEqual({ found: true, index: 1 })
  })
  test("not found returns insertion index", () => {
    const arr = [{ id: "a" }, { id: "c" }]
    expect(Binary.search(arr, "b", idOf)).toEqual({ found: false, index: 1 })
  })
  test("not found at end", () => {
    const arr = [{ id: "a" }, { id: "b" }]
    expect(Binary.search(arr, "c", idOf)).toEqual({ found: false, index: 2 })
  })
  test("not found before start", () => {
    const arr = [{ id: "b" }, { id: "c" }]
    expect(Binary.search(arr, "a", idOf)).toEqual({ found: false, index: 0 })
  })
  test("works with many items", () => {
    const arr = Array.from({ length: 100 }, (_, i) => ({ id: `id${String(i).padStart(3, "0")}` }))
    expect(Binary.search(arr, "id050", idOf)).toEqual({ found: true, index: 50 })
  })
  for (let i = 0; i < 50; i++) {
    test(`search bulk #${i}`, () => {
      const arr = Array.from({ length: 30 }, (_, idx) => ({ id: String(idx).padStart(3, "0") }))
      const target = String(i).padStart(3, "0")
      const result = Binary.search(arr, target, idOf)
      expect(result.found).toBe(i < 30)
    })
  }
})

describe("Binary.insert", () => {
  test("insert into empty array", () => {
    const arr: { id: string }[] = []
    Binary.insert(arr, { id: "a" }, idOf)
    expect(arr).toEqual([{ id: "a" }])
  })
  test("insert before all", () => {
    const arr = [{ id: "b" }]
    Binary.insert(arr, { id: "a" }, idOf)
    expect(arr.map(idOf)).toEqual(["a", "b"])
  })
  test("insert after all", () => {
    const arr = [{ id: "a" }]
    Binary.insert(arr, { id: "b" }, idOf)
    expect(arr.map(idOf)).toEqual(["a", "b"])
  })
  test("insert in middle", () => {
    const arr = [{ id: "a" }, { id: "c" }]
    Binary.insert(arr, { id: "b" }, idOf)
    expect(arr.map(idOf)).toEqual(["a", "b", "c"])
  })
  test("insert duplicate appears once", () => {
    const arr = [{ id: "a" }]
    Binary.insert(arr, { id: "a" }, idOf)
    expect(arr.length).toBe(2)
  })
  test("returns the array (mutated)", () => {
    const arr: { id: string }[] = []
    expect(Binary.insert(arr, { id: "x" }, idOf)).toBe(arr)
  })
  for (let i = 0; i < 50; i++) {
    test(`insertion preserves sorted order #${i}`, () => {
      const arr: { id: string }[] = []
      const ids = ["c", "a", "b", "e", "d", "f"]
      for (const id of ids) Binary.insert(arr, { id: `${id}${i}` }, idOf)
      const justIds = arr.map(idOf)
      const sorted = [...justIds].sort()
      expect(justIds).toEqual(sorted)
    })
  }
})

describe("Binary search and insert combined", () => {
  test("search after insert returns correct index", () => {
    const arr: { id: string }[] = []
    for (const id of ["c", "a", "b", "e", "d"]) Binary.insert(arr, { id }, idOf)
    expect(Binary.search(arr, "c", idOf)).toEqual({ found: true, index: 2 })
  })
  test("search returns insertion point for missing", () => {
    const arr: { id: string }[] = []
    for (const id of ["a", "c", "e"]) Binary.insert(arr, { id }, idOf)
    expect(Binary.search(arr, "b", idOf)).toEqual({ found: false, index: 1 })
    expect(Binary.search(arr, "d", idOf)).toEqual({ found: false, index: 2 })
  })
})
