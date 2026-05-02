import { describe, expect, test } from "bun:test"
import { decodeDataUrl } from "../src/util/data-url"

describe("decodeDataUrl - basic", () => {
  test("empty url returns empty", () => expect(decodeDataUrl("")).toBe(""))
  test("no comma returns empty", () => expect(decodeDataUrl("data:")).toBe(""))
  test("simple text", () => expect(decodeDataUrl("data:text/plain,hello")).toBe("hello"))
  test("url-encoded space", () =>
    expect(decodeDataUrl("data:text/plain,hello%20world")).toBe("hello world"))
  test("url-encoded special", () =>
    expect(decodeDataUrl("data:text/plain,a%26b")).toBe("a&b"))
  test("base64", () => expect(decodeDataUrl("data:text/plain;base64,aGVsbG8=")).toBe("hello"))
  test("base64 utf-8", () =>
    expect(decodeDataUrl("data:text/plain;base64,5pel5pys6Kqe")).toBe("日本語"))
  test("multiple commas keeps first as separator", () =>
    expect(decodeDataUrl("data:text/plain,a,b,c")).toBe("a,b,c"))
  test("no colon in head still works", () =>
    expect(decodeDataUrl("foo,bar")).toBe("bar"))
  for (let i = 0; i < 30; i++) {
    test(`bulk plain #${i}`, () => {
      expect(decodeDataUrl(`data:text/plain,value${i}`)).toBe(`value${i}`)
    })
  }
})

describe("decodeDataUrl - encoded characters", () => {
  test("plus sign encoded", () =>
    expect(decodeDataUrl("data:text/plain,a%2Bb")).toBe("a+b"))
  test("equals encoded", () =>
    expect(decodeDataUrl("data:text/plain,x%3D5")).toBe("x=5"))
  test("hash encoded", () =>
    expect(decodeDataUrl("data:text/plain,x%23y")).toBe("x#y"))
})

describe("decodeDataUrl - base64 details", () => {
  test("empty base64 returns empty string", () =>
    expect(decodeDataUrl("data:text/plain;base64,")).toBe(""))
  test("base64 with no padding works", () =>
    expect(decodeDataUrl("data:text/plain;base64,YQ")).toBe("a"))
  test("base64 of binary-like content", () => {
    const original = "test 123 456"
    const enc = Buffer.from(original).toString("base64")
    expect(decodeDataUrl(`data:application/octet-stream;base64,${enc}`)).toBe(original)
  })
  test("base64 with special chars", () => {
    const original = "{ \"a\": 1 }"
    const enc = Buffer.from(original).toString("base64")
    expect(decodeDataUrl(`data:application/json;base64,${enc}`)).toBe(original)
  })
})
