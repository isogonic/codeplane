import { describe, expect, test } from "bun:test"
import { bar, dummyFunction, foo, randomHelper } from "../src/util/scrap"

describe("scrap module", () => {
  test("foo is a string", () => expect(typeof foo).toBe("string"))
  test("foo equals 42", () => expect(foo).toBe("42"))
  test("bar is a number", () => expect(typeof bar).toBe("number"))
  test("bar equals 123", () => expect(bar).toBe(123))
  test("dummyFunction returns void", () => expect(dummyFunction()).toBeUndefined())
  test("randomHelper returns boolean", () =>
    expect(typeof randomHelper()).toBe("boolean"))
  for (let i = 0; i < 30; i++) {
    test(`randomHelper bulk #${i} is boolean`, () => {
      expect(typeof randomHelper()).toBe("boolean")
    })
  }
})
