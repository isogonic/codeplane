import { describe, expect, test } from "bun:test"
import { decodeDataUrl } from "../src/util/data-url"

describe("decodeDataUrl mega - plain", () => {
  for (let i = 0; i < 100; i++) {
    test(`plain value-${i}`, () => {
      expect(decodeDataUrl(`data:text/plain,value-${i}`)).toBe(`value-${i}`)
    })
  }
})

describe("decodeDataUrl mega - base64", () => {
  for (let i = 0; i < 50; i++) {
    test(`base64 value-${i}`, () => {
      const original = `value-${i}`
      const enc = Buffer.from(original).toString("base64")
      expect(decodeDataUrl(`data:text/plain;base64,${enc}`)).toBe(original)
    })
  }
})

describe("decodeDataUrl mega - url-encoded", () => {
  for (let i = 0; i < 50; i++) {
    test(`encoded space ${i}`, () =>
      expect(decodeDataUrl(`data:text/plain,hello%20${i}`)).toBe(`hello ${i}`))
  }
})

describe("decodeDataUrl mega - mime types", () => {
  const mimes = [
    "text/plain", "text/html", "application/json", "application/xml",
    "image/png", "image/jpeg", "image/svg+xml", "video/mp4",
  ]
  for (const mime of mimes) {
    for (let i = 0; i < 10; i++) {
      test(`mime ${mime} #${i}`, () =>
        expect(decodeDataUrl(`data:${mime},content-${i}`)).toBe(`content-${i}`))
    }
  }
})
