import { describe, expect, test } from "bun:test"
import { isRecord } from "../../src/util/record"

describe("isRecord", () => {
  test("returns true for plain object", () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
  })

  test("returns false for array", () => {
    expect(isRecord([])).toBe(false)
    expect(isRecord([1, 2])).toBe(false)
  })

  test("returns false for null", () => {
    expect(isRecord(null)).toBe(false)
  })

  test("returns false for undefined", () => {
    expect(isRecord(undefined)).toBe(false)
  })

  test("returns false for primitives", () => {
    expect(isRecord(1)).toBe(false)
    expect(isRecord("string")).toBe(false)
    expect(isRecord(true)).toBe(false)
    expect(isRecord(false)).toBe(false)
  })

  test("returns true for objects with prototypes (currently)", () => {
    expect(isRecord(new Date())).toBe(true)
  })

  test("acts as type guard", () => {
    const v: unknown = { x: 1 }
    if (isRecord(v)) {
      expect(typeof v.x).toBe("number")
    }
  })

  test("returns false for symbol", () => {
    expect(isRecord(Symbol())).toBe(false)
  })

  test("returns false for function", () => {
    expect(isRecord(() => {})).toBe(false)
  })

  test("returns true for object created via Object.create(null)", () => {
    expect(isRecord(Object.create(null))).toBe(true)
  })

  test("returns false for NaN", () => {
    expect(isRecord(NaN)).toBe(false)
  })
})
