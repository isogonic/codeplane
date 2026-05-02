import { afterEach, describe, expect, test, beforeEach } from "bun:test"
import { online, proxied } from "../../src/util/network"

describe("online", () => {
  test("returns true when no navigator", () => {
    const original = (globalThis as any).navigator
    delete (globalThis as any).navigator
    expect(online()).toBe(true)
    if (original) (globalThis as any).navigator = original
  })

  test("returns navigator.onLine when present and boolean", () => {
    const original = (globalThis as any).navigator
    ;(globalThis as any).navigator = { onLine: true }
    expect(online()).toBe(true)
    ;(globalThis as any).navigator = { onLine: false }
    expect(online()).toBe(false)
    if (original) (globalThis as any).navigator = original
    else delete (globalThis as any).navigator
  })

  test("returns true when navigator.onLine isn't boolean", () => {
    const original = (globalThis as any).navigator
    ;(globalThis as any).navigator = { onLine: "yes" }
    expect(online()).toBe(true)
    if (original) (globalThis as any).navigator = original
    else delete (globalThis as any).navigator
  })
})

describe("proxied", () => {
  let saved: NodeJS.ProcessEnv

  beforeEach(() => {
    saved = { ...process.env }
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.http_proxy
    delete process.env.https_proxy
  })

  afterEach(() => {
    process.env = saved
  })

  test("returns false when no proxy env vars", () => {
    expect(proxied()).toBe(false)
  })

  test("returns true with HTTP_PROXY", () => {
    process.env.HTTP_PROXY = "http://proxy"
    expect(proxied()).toBe(true)
  })

  test("returns true with HTTPS_PROXY", () => {
    process.env.HTTPS_PROXY = "http://proxy"
    expect(proxied()).toBe(true)
  })

  test("returns true with lowercase http_proxy", () => {
    process.env.http_proxy = "http://proxy"
    expect(proxied()).toBe(true)
  })

  test("returns true with lowercase https_proxy", () => {
    process.env.https_proxy = "http://proxy"
    expect(proxied()).toBe(true)
  })

  test("returns false for empty string proxy", () => {
    process.env.HTTP_PROXY = ""
    expect(proxied()).toBe(false)
  })
})
