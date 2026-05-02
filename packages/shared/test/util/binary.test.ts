import { describe, expect, test } from "bun:test"
import { Binary } from "../../src/util/binary"

const id = (x: { id: string }) => x.id

describe("Binary.search", () => {
  test("finds element in sorted array", () => {
    const arr = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(Binary.search(arr, "b", id)).toEqual({ found: true, index: 1 })
  })

  test("finds first element", () => {
    const arr = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(Binary.search(arr, "a", id)).toEqual({ found: true, index: 0 })
  })

  test("finds last element", () => {
    const arr = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(Binary.search(arr, "c", id)).toEqual({ found: true, index: 2 })
  })

  test("returns insertion point when not found", () => {
    const arr = [{ id: "a" }, { id: "c" }, { id: "e" }]
    const r = Binary.search(arr, "b", id)
    expect(r.found).toBe(false)
    expect(r.index).toBe(1)
  })

  test("returns insertion point at start", () => {
    const arr = [{ id: "b" }, { id: "c" }]
    expect(Binary.search(arr, "a", id)).toEqual({ found: false, index: 0 })
  })

  test("returns insertion point at end", () => {
    const arr = [{ id: "a" }, { id: "b" }]
    expect(Binary.search(arr, "z", id)).toEqual({ found: false, index: 2 })
  })

  test("empty array", () => {
    expect(Binary.search([] as { id: string }[], "x", id)).toEqual({ found: false, index: 0 })
  })

  test("single element matching", () => {
    expect(Binary.search([{ id: "x" }], "x", id)).toEqual({ found: true, index: 0 })
  })

  test("single element not matching (smaller)", () => {
    expect(Binary.search([{ id: "x" }], "a", id)).toEqual({ found: false, index: 0 })
  })

  test("single element not matching (greater)", () => {
    expect(Binary.search([{ id: "x" }], "z", id)).toEqual({ found: false, index: 1 })
  })

  test("two elements with first match", () => {
    expect(Binary.search([{ id: "a" }, { id: "b" }], "a", id)).toEqual({ found: true, index: 0 })
  })

  test("two elements with second match", () => {
    expect(Binary.search([{ id: "a" }, { id: "b" }], "b", id)).toEqual({ found: true, index: 1 })
  })

  test("works with numeric strings", () => {
    const arr = [{ id: "01" }, { id: "02" }, { id: "03" }]
    expect(Binary.search(arr, "02", id)).toEqual({ found: true, index: 1 })
  })

  test("large array search", () => {
    const arr = Array.from({ length: 1000 }, (_, i) => ({ id: String(i).padStart(4, "0") }))
    const r = Binary.search(arr, "0500", id)
    expect(r.found).toBe(true)
    expect(r.index).toBe(500)
  })

  test("large array missing element", () => {
    const arr = Array.from({ length: 100 }, (_, i) => ({ id: String(i * 2).padStart(4, "0") }))
    expect(Binary.search(arr, "0001", id)).toEqual({ found: false, index: 1 })
  })

  test("custom compare function", () => {
    const arr = [{ key: "a" }, { key: "b" }]
    expect(Binary.search(arr, "b", (x) => x.key)).toEqual({ found: true, index: 1 })
  })

  test("multiple identical ids returns one of them", () => {
    const arr = [{ id: "a" }, { id: "a" }, { id: "a" }]
    const r = Binary.search(arr, "a", id)
    expect(r.found).toBe(true)
    expect([0, 1, 2]).toContain(r.index)
  })

  test("uppercase vs lowercase", () => {
    const arr = [{ id: "A" }, { id: "B" }, { id: "a" }]
    expect(Binary.search(arr, "a", id)).toEqual({ found: true, index: 2 })
  })
})

describe("Binary.insert", () => {
  test("inserts into empty array", () => {
    const arr: { id: string }[] = []
    Binary.insert(arr, { id: "a" }, id)
    expect(arr).toEqual([{ id: "a" }])
  })

  test("inserts at start", () => {
    const arr = [{ id: "b" }, { id: "c" }]
    Binary.insert(arr, { id: "a" }, id)
    expect(arr.map(id)).toEqual(["a", "b", "c"])
  })

  test("inserts in middle", () => {
    const arr = [{ id: "a" }, { id: "c" }]
    Binary.insert(arr, { id: "b" }, id)
    expect(arr.map(id)).toEqual(["a", "b", "c"])
  })

  test("inserts at end", () => {
    const arr = [{ id: "a" }, { id: "b" }]
    Binary.insert(arr, { id: "c" }, id)
    expect(arr.map(id)).toEqual(["a", "b", "c"])
  })

  test("inserts duplicate before existing", () => {
    const arr = [{ id: "a" }, { id: "c" }]
    Binary.insert(arr, { id: "a" }, id)
    expect(arr.length).toBe(3)
    expect(arr.map(id)).toEqual(["a", "a", "c"])
  })

  test("returns same array reference", () => {
    const arr: { id: string }[] = [{ id: "b" }]
    const result = Binary.insert(arr, { id: "a" }, id)
    expect(result).toBe(arr)
  })

  test("multiple inserts maintain order", () => {
    const arr: { id: string }[] = []
    Binary.insert(arr, { id: "c" }, id)
    Binary.insert(arr, { id: "a" }, id)
    Binary.insert(arr, { id: "b" }, id)
    expect(arr.map(id)).toEqual(["a", "b", "c"])
  })

  test("insert preserves element references", () => {
    const item = { id: "x", extra: 1 }
    const arr: any[] = []
    Binary.insert(arr, item, id)
    expect(arr[0]).toBe(item)
  })

  test("inserts at correct position with many elements", () => {
    const arr = Array.from({ length: 100 }, (_, i) => ({ id: String(i * 2).padStart(4, "0") }))
    Binary.insert(arr, { id: "0011" }, id)
    expect(arr[6].id).toBe("0011")
  })

  test("inserting smallest element", () => {
    const arr = [{ id: "y" }, { id: "z" }]
    Binary.insert(arr, { id: "a" }, id)
    expect(arr[0].id).toBe("a")
  })

  test("inserting largest element", () => {
    const arr = [{ id: "a" }, { id: "b" }]
    Binary.insert(arr, { id: "z" }, id)
    expect(arr[2].id).toBe("z")
  })

  test("inserting many duplicates", () => {
    const arr: { id: string }[] = []
    for (let i = 0; i < 5; i++) Binary.insert(arr, { id: "x" }, id)
    expect(arr.length).toBe(5)
    expect(arr.every((x) => x.id === "x")).toBe(true)
  })

  test("custom compare function", () => {
    const arr = [{ k: "a" }, { k: "c" }]
    Binary.insert(arr, { k: "b" }, (x) => x.k)
    expect(arr.map((x) => x.k)).toEqual(["a", "b", "c"])
  })

  test("works with numeric ids", () => {
    const arr = [{ id: "001" }, { id: "003" }]
    Binary.insert(arr, { id: "002" }, id)
    expect(arr.map(id)).toEqual(["001", "002", "003"])
  })

  test("inserts equal items in sequence preserves later additions placed before", () => {
    const arr: { id: string; n: number }[] = [{ id: "b", n: 1 }]
    Binary.insert(arr, { id: "b", n: 2 }, (x) => x.id)
    expect(arr.length).toBe(2)
  })
})
