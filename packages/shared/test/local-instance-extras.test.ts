import { describe, expect, test } from "bun:test"
import { findListeningPort } from "../src/local-instance"

describe("findListeningPort additional cases", () => {
  test("matches HTTP listening on", () => {
    expect(findListeningPort("listening on http://127.0.0.1:8080")).toBe(8080)
  })

  test("matches HTTPS listening on", () => {
    expect(findListeningPort("listening on https://127.0.0.1:443")).toBe(443)
  })

  test("matches uppercase Listening", () => {
    expect(findListeningPort("Listening on http://127.0.0.1:9000")).toBe(9000)
  })

  test("matches at instead of on", () => {
    expect(findListeningPort("listening at http://localhost:7777")).toBe(7777)
  })

  test("matches server started on", () => {
    expect(findListeningPort("server started on http://0.0.0.0:5000")).toBe(5000)
  })

  test("matches server ready at", () => {
    expect(findListeningPort("server ready at https://localhost:9876")).toBe(9876)
  })

  test("returns undefined for no port", () => {
    expect(findListeningPort("hello world")).toBeUndefined()
  })

  test("returns undefined for empty string", () => {
    expect(findListeningPort("")).toBeUndefined()
  })

  test("returns undefined when port is 0", () => {
    expect(findListeningPort("listening on http://127.0.0.1:0")).toBeUndefined()
  })

  test("returns first match in multi-line input", () => {
    expect(findListeningPort("listening on http://127.0.0.1:1111\nlistening on http://127.0.0.1:2222")).toBe(1111)
  })

  test("handles port 65535", () => {
    expect(findListeningPort("listening on http://127.0.0.1:65535")).toBe(65535)
  })

  test("handles port 1", () => {
    expect(findListeningPort("listening on http://127.0.0.1:1")).toBe(1)
  })

  test("returns undefined for malformed urls", () => {
    expect(findListeningPort("listening on http://:8080")).toBeUndefined()
  })

  test("ignores text without 'listening'", () => {
    expect(findListeningPort("port: 8080")).toBeUndefined()
  })

  test("matches full server message", () => {
    const text = "[INFO] codeplane server: listening on http://127.0.0.1:3000 ready"
    expect(findListeningPort(text)).toBe(3000)
  })

  test("works with mixed case modes", () => {
    expect(findListeningPort("LISTENING ON HTTP://127.0.0.1:80")).toBe(80)
  })

  test("does not match without scheme", () => {
    expect(findListeningPort("listening on 127.0.0.1:8080")).toBeUndefined()
  })

  test("does not match if port part missing", () => {
    expect(findListeningPort("listening on http://127.0.0.1")).toBeUndefined()
  })
})
