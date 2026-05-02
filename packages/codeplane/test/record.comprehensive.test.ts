import { describe, expect, test } from "bun:test"
import { isRecord } from "../src/util/record"

describe("isRecord", () => {
  test("plain object", () => expect(isRecord({})).toBe(true))
  test("object with keys", () => expect(isRecord({ a: 1 })).toBe(true))
  test("nested object", () => expect(isRecord({ a: { b: 1 } })).toBe(true))
  test("array is not a record", () => expect(isRecord([])).toBe(false))
  test("array with values is not a record", () => expect(isRecord([1, 2])).toBe(false))
  test("null is not a record", () => expect(isRecord(null)).toBe(false))
  test("undefined is not a record", () => expect(isRecord(undefined)).toBe(false))
  test("string is not a record", () => expect(isRecord("hello")).toBe(false))
  test("number is not a record", () => expect(isRecord(42)).toBe(false))
  test("boolean is not a record", () => expect(isRecord(true)).toBe(false))
  test("function is not a record", () => expect(isRecord(() => {})).toBe(false))
  test("Date object is a record", () => expect(isRecord(new Date())).toBe(true))
  test("Error instance is a record", () => expect(isRecord(new Error())).toBe(true))
  test("Map is a record", () => expect(isRecord(new Map())).toBe(true))
  test("Set is a record", () => expect(isRecord(new Set())).toBe(true))
  test("class instance", () => {
    class A {}
    expect(isRecord(new A())).toBe(true)
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk record #${i}`, () => expect(isRecord({ a: i })).toBe(true))
  }
  for (let i = 0; i < 30; i++) {
    test(`bulk non-record #${i}`, () => expect(isRecord(i)).toBe(false))
  }
})
