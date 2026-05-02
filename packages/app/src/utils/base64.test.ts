import { describe, expect, test } from "bun:test"
import { decode64 } from "./base64"

describe("decode64", () => {
  test("returns undefined when input is undefined", () => {
    expect(decode64(undefined)).toBeUndefined()
  })

  test("decodes a valid base64 string", () => {
    const decoded = decode64("aGVsbG8=")
    expect(decoded).toBe("hello")
  })

  test("returns undefined for invalid base64", () => {
    expect(decode64("not%%%base64!!!")).toBeUndefined()
  })

  test("decodes an empty string to an empty string", () => {
    expect(decode64("")).toBe("")
  })
})
