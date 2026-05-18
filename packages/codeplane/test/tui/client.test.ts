import { describe, expect, test } from "bun:test"
import { headersForInstance, normalizeInstanceUrl, wsUrlForInstance } from "../../src/tui/client"
import type { SavedInstance } from "@codeplane-ai/shared/instance"

describe("normalizeInstanceUrl", () => {
  const cases: Array<[string, string | undefined]> = [
    ["", undefined],
    ["   ", undefined],
    ["\t\n", undefined],
    ["http://example.com", "http://example.com"],
    ["http://example.com/", "http://example.com"],
    ["http://example.com//", "http://example.com"],
    ["http://example.com///", "http://example.com"],
    ["https://example.com", "https://example.com"],
    ["https://example.com:443", "https://example.com:443"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://localhost:3000/", "http://localhost:3000"],
    ["example.com", "http://example.com"],
    ["example.com/", "http://example.com"],
    ["example.com/path", "http://example.com/path"],
    ["example.com:8080", "http://example.com:8080"],
    ["sub.example.com", "http://sub.example.com"],
    ["my-host.local", "http://my-host.local"],
    ["my_host.local", "http://my_host.local"],
    ["127.0.0.1", "http://127.0.0.1"],
    ["127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["[::1]:8080", "http://[::1]:8080"],
    ["http://example.com/path/", "http://example.com/path"],
    ["http://example.com/path//", "http://example.com/path"],
    ["http://example.com/path/sub/", "http://example.com/path/sub"],
    ["  http://example.com  ", "http://example.com"],
    ["\thttp://example.com\n", "http://example.com"],
    ["wss://example.com", "wss://example.com"],
    ["ws://localhost", "ws://localhost"],
    ["ftp://example.com", "ftp://example.com"],
    ["custom-protocol://example", "http://custom-protocol://example"],
    ["HTTP://example.com", "HTTP://example.com"],
    ["HTTPS://example.com/", "HTTPS://example.com"],
    ["Http://example.com", "Http://example.com"],
    ["http://user:pass@example.com", "http://user:pass@example.com"],
    ["http://user:pass@example.com/", "http://user:pass@example.com"],
    ["http://user@example.com", "http://user@example.com"],
    ["http://user:pass@example.com:8080/path", "http://user:pass@example.com:8080/path"],
    ["http://example.com?q=1", "http://example.com?q=1"],
    ["http://example.com/path?q=1", "http://example.com/path?q=1"],
    ["http://example.com#frag", "http://example.com#frag"],
    ["local://abc123", "local://abc123"],
    ["xn--n3h.com", "http://xn--n3h.com"],
    ["xn--n3h.com/", "http://xn--n3h.com"],
    ["192.168.1.1:8080", "http://192.168.1.1:8080"],
    ["10.0.0.1", "http://10.0.0.1"],
    ["my.test.server.example.com:5000", "http://my.test.server.example.com:5000"],
    ["http+sso://example.com", "http://http+sso://example.com"],
    ["a.b.c", "http://a.b.c"],
    ["a.b.c/", "http://a.b.c"],
    ["a.b.c//", "http://a.b.c"],
    ["a.b.c/p1/p2/", "http://a.b.c/p1/p2"],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [input, expected] = cases[i]
    test(`normalizeInstanceUrl ${i}: ${JSON.stringify(input)}`, () => {
      expect(normalizeInstanceUrl(input)).toBe(expected)
    })
  }
})

describe("headersForInstance", () => {
  const cases: Array<[string, SavedInstance, Record<string, string>]> = [
    ["empty headers", { id: "a", url: "http://x" }, {}],
    ["undefined headers", { id: "a", url: "http://x", headers: undefined }, {}],
    ["single header", { id: "a", url: "http://x", headers: { A: "1" } }, { A: "1" }],
    ["two headers", { id: "a", url: "http://x", headers: { A: "1", B: "2" } }, { A: "1", B: "2" }],
    [
      "many headers",
      { id: "a", url: "http://x", headers: { A: "1", B: "2", C: "3", D: "4", E: "5" } },
      { A: "1", B: "2", C: "3", D: "4", E: "5" },
    ],
    [
      "Authorization bearer",
      { id: "a", url: "http://x", headers: { Authorization: "Bearer abc" } },
      { Authorization: "Bearer abc" },
    ],
    [
      "CF Access service token",
      {
        id: "a",
        url: "http://x",
        headers: { "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "secret" },
      },
      { "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "secret" },
    ],
    [
      "Token with whitespace value",
      { id: "a", url: "http://x", headers: { "X-Custom": "  spaced  " } },
      { "X-Custom": "  spaced  " },
    ],
    [
      "Header with colon in value",
      { id: "a", url: "http://x", headers: { "X-Time": "2026-01-01T00:00:00Z" } },
      { "X-Time": "2026-01-01T00:00:00Z" },
    ],
    [
      "Header with semicolon in value",
      { id: "a", url: "http://x", headers: { "X-Mix": "a; b; c" } },
      { "X-Mix": "a; b; c" },
    ],
    [
      "lowercase keys preserved",
      { id: "a", url: "http://x", headers: { authorization: "Bearer x" } },
      { authorization: "Bearer x" },
    ],
    [
      "mixed-case keys preserved",
      { id: "a", url: "http://x", headers: { "x-Custom-Key": "v" } },
      { "x-Custom-Key": "v" },
    ],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [name, instance, expected] = cases[i]
    test(`headersForInstance ${i}: ${name}`, () => {
      expect(headersForInstance(instance)).toEqual(expected)
    })
  }

  test("returns a fresh object each call (no shared mutation)", () => {
    const instance: SavedInstance = { id: "a", url: "http://x", headers: { A: "1" } }
    const a = headersForInstance(instance)
    const b = headersForInstance(instance)
    expect(a).not.toBe(b)
    a.B = "2"
    expect(b).toEqual({ A: "1" })
  })

  test("does not include id/url/label/local fields", () => {
    const instance: SavedInstance = {
      id: "abc",
      url: "http://example.com",
      label: "Test",
      headers: { Authorization: "Bearer x" },
      ignoreCertificateErrors: true,
      clientCertSubject: "CN=Client",
      iconDataUrl: "data:image/png;base64,xxx",
      local: { binaryVersion: "27.4.0" },
    }
    expect(headersForInstance(instance)).toEqual({ Authorization: "Bearer x" })
  })

  test("undefined header value never appears", () => {
    const instance: SavedInstance = { id: "a", url: "http://x" }
    expect(Object.keys(headersForInstance(instance))).toEqual([])
  })
})

describe("wsUrlForInstance", () => {
  const cases: Array<[string, SavedInstance, string, string]> = [
    [
      "https → wss with leading slash path",
      { id: "a", url: "https://example.com" },
      "/api/stream",
      "wss://example.com/api/stream",
    ],
    [
      "http → ws with leading slash path",
      { id: "a", url: "http://localhost:3000" },
      "/api/stream",
      "ws://localhost:3000/api/stream",
    ],
    [
      "http → ws path without leading slash",
      { id: "a", url: "http://localhost:3000" },
      "api/stream",
      "ws://localhost:3000/api/stream",
    ],
    [
      "double leading slash collapsed",
      { id: "a", url: "http://localhost:3000" },
      "//api",
      "ws://localhost:3000/api",
    ],
    [
      "trailing slash on instance preserved as base",
      { id: "a", url: "https://example.com/" },
      "events",
      "wss://example.com/events",
    ],
    [
      "https with custom port",
      { id: "a", url: "https://example.com:8443" },
      "/ws",
      "wss://example.com:8443/ws",
    ],
    [
      "ipv4 base",
      { id: "a", url: "http://127.0.0.1" },
      "/x",
      "ws://127.0.0.1/x",
    ],
    [
      "ipv4 port base",
      { id: "a", url: "http://127.0.0.1:5000" },
      "/x",
      "ws://127.0.0.1:5000/x",
    ],
    [
      "subpath with multiple segments",
      { id: "a", url: "http://h" },
      "/a/b/c/d",
      "ws://h/a/b/c/d",
    ],
    [
      "query string preserved",
      { id: "a", url: "http://h" },
      "/x?a=1&b=2",
      "ws://h/x?a=1&b=2",
    ],
    [
      "fragment preserved",
      { id: "a", url: "http://h" },
      "/x#frag",
      "ws://h/x#frag",
    ],
    [
      "uppercase HTTPS",
      { id: "a", url: "HTTPS://example.com" },
      "/api",
      "wss://example.com/api",
    ],
    [
      "uppercase HTTP",
      { id: "a", url: "HTTP://example.com" },
      "/api",
      "ws://example.com/api",
    ],
    [
      "no protocol input becomes http→ws",
      { id: "a", url: "example.com" },
      "/api",
      "ws://example.com/api",
    ],
    [
      "no protocol with port becomes http→ws",
      { id: "a", url: "example.com:8080" },
      "/api",
      "ws://example.com:8080/api",
    ],
    [
      "instance base path is preserved when joining the pathname",
      { id: "a", url: "http://h/instance/path" },
      "/api",
      "ws://h/instance/path/api",
    ],
    [
      "instance base path joins pathname query strings",
      { id: "a", url: "https://h/base" },
      "/api/events?since=1",
      "wss://h/base/api/events?since=1",
    ],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [name, instance, pathname, expected] = cases[i]
    test(`wsUrlForInstance ${i}: ${name}`, () => {
      expect(wsUrlForInstance(instance, pathname)).toBe(expected)
    })
  }

  test("throws on empty url", () => {
    expect(() => wsUrlForInstance({ id: "x", url: "" }, "/p")).toThrow(/Invalid instance URL/)
  })

  test("throws on whitespace-only url", () => {
    expect(() => wsUrlForInstance({ id: "x", url: "   " }, "/p")).toThrow(/Invalid instance URL/)
  })

  test("throws on unsupported protocols", () => {
    expect(() => wsUrlForInstance({ id: "x", url: "ftp://example.com" }, "/p")).toThrow(/websocket-compatible/)
  })
})
