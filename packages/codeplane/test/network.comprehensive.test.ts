import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { online, proxied } from "../src/util/network"

describe("online", () => {
  test("returns boolean", () => expect(typeof online()).toBe("boolean"))
  test("defaults to true when navigator missing", () => expect(online()).toBe(true))
})

describe("proxied", () => {
  const originalEnv = { ...process.env }
  beforeEach(() => {
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.http_proxy
    delete process.env.https_proxy
  })
  afterEach(() => {
    process.env = { ...originalEnv }
  })
  test("returns false when no proxy env", () => expect(proxied()).toBe(false))
  test("true when HTTP_PROXY set", () => {
    process.env.HTTP_PROXY = "http://proxy:8080"
    expect(proxied()).toBe(true)
  })
  test("true when HTTPS_PROXY set", () => {
    process.env.HTTPS_PROXY = "http://proxy:8080"
    expect(proxied()).toBe(true)
  })
  test("true when http_proxy set", () => {
    process.env.http_proxy = "http://proxy:8080"
    expect(proxied()).toBe(true)
  })
  test("true when https_proxy set", () => {
    process.env.https_proxy = "http://proxy:8080"
    expect(proxied()).toBe(true)
  })
  for (let i = 0; i < 10; i++) {
    test(`bulk no proxy #${i}`, () => {
      delete process.env.HTTP_PROXY
      delete process.env.HTTPS_PROXY
      delete process.env.http_proxy
      delete process.env.https_proxy
      expect(proxied()).toBe(false)
    })
  }
})
