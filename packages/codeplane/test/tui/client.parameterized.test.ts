import { describe, expect, test } from "bun:test"
import { headersForInstance, normalizeInstanceUrl, wsUrlForInstance } from "../../src/tui/client"

describe("normalizeInstanceUrl - bulk hostnames", () => {
  for (let i = 0; i < 100; i++) {
    test(`bulk hostname ${i}`, () => {
      expect(normalizeInstanceUrl(`host-${i}.example.com`)).toBe(`http://host-${i}.example.com`)
    })
  }
})

describe("normalizeInstanceUrl - bulk ports", () => {
  const ports = [1, 80, 443, 1024, 3000, 5000, 8080, 30000, 50000, 65535]
  for (const port of ports) {
    test(`port ${port}`, () => {
      expect(normalizeInstanceUrl(`localhost:${port}`)).toBe(`http://localhost:${port}`)
    })
    test(`port ${port} with trailing slash`, () => {
      expect(normalizeInstanceUrl(`localhost:${port}/`)).toBe(`http://localhost:${port}`)
    })
    test(`port ${port} with multi trailing slash`, () => {
      expect(normalizeInstanceUrl(`localhost:${port}////`)).toBe(`http://localhost:${port}`)
    })
  }
})

describe("normalizeInstanceUrl - bulk subpaths", () => {
  const segs = ["a", "api", "v1", "instances", "user/profile", "deeply/nested/path/structure"]
  for (const seg of segs) {
    test(`subpath ${seg}`, () => {
      expect(normalizeInstanceUrl(`example.com/${seg}`)).toBe(`http://example.com/${seg}`)
    })
    test(`subpath ${seg} with trailing slash`, () => {
      expect(normalizeInstanceUrl(`example.com/${seg}/`)).toBe(`http://example.com/${seg}`)
    })
  }
})

describe("normalizeInstanceUrl - bulk protocols (alpha-only)", () => {
  // Only alpha protocols match the regex; all others get http:// prepended.
  const protocols = ["http", "https", "ws", "wss", "ftp", "ftps", "local", "ssh"]
  for (const proto of protocols) {
    test(`protocol ${proto}`, () => {
      expect(normalizeInstanceUrl(`${proto}://example.com`)).toBe(`${proto}://example.com`)
    })
    test(`protocol ${proto} with trailing slash`, () => {
      expect(normalizeInstanceUrl(`${proto}://example.com/`)).toBe(`${proto}://example.com`)
    })
  }
})

describe("normalizeInstanceUrl - case preservation", () => {
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i) // A-Z
    test(`uppercase letter ${ch} preserved`, () => {
      expect(normalizeInstanceUrl(`Host${ch}.example.com`)).toBe(`http://Host${ch}.example.com`)
    })
  }
})

describe("headersForInstance - parameterized", () => {
  for (let n = 1; n <= 25; n++) {
    test(`returns ${n} headers as a fresh object`, () => {
      const headers: Record<string, string> = {}
      for (let i = 0; i < n; i++) headers[`X-Header-${i}`] = `value-${i}`
      const result = headersForInstance({ id: "x", url: "http://x", headers })
      expect(Object.keys(result)).toHaveLength(n)
      for (let i = 0; i < n; i++) {
        expect(result[`X-Header-${i}`]).toBe(`value-${i}`)
      }
    })
  }

  test("100 unique header keys", () => {
    const headers: Record<string, string> = {}
    for (let i = 0; i < 100; i++) headers[`X-Header-${i}`] = `value-${i}`
    const result = headersForInstance({ id: "x", url: "http://x", headers })
    expect(Object.keys(result)).toHaveLength(100)
  })
})

describe("wsUrlForInstance - bulk path-shapes", () => {
  for (let i = 0; i < 50; i++) {
    test(`bulk path /api/route-${i}`, () => {
      expect(wsUrlForInstance({ id: "x", url: "https://example.com" }, `/api/route-${i}`))
        .toBe(`wss://example.com/api/route-${i}`)
    })
  }
})

describe("wsUrlForInstance - bulk ports preserved (non-default)", () => {
  // Default ports (80 for http/ws, 443 for https/wss) are stripped by the URL constructor.
  const ports = [1024, 3000, 8080, 9090, 65535]
  for (const port of ports) {
    test(`port ${port} preserved (https → wss)`, () => {
      expect(wsUrlForInstance({ id: "x", url: `https://example.com:${port}` }, "/x"))
        .toBe(`wss://example.com:${port}/x`)
    })
    test(`port ${port} preserved (http → ws)`, () => {
      expect(wsUrlForInstance({ id: "x", url: `http://example.com:${port}` }, "/x"))
        .toBe(`ws://example.com:${port}/x`)
    })
  }

  test("default port 80 stripped from http→ws", () => {
    expect(wsUrlForInstance({ id: "x", url: "http://example.com:80" }, "/x"))
      .toBe("ws://example.com/x")
  })

  test("default port 443 stripped from https→wss", () => {
    expect(wsUrlForInstance({ id: "x", url: "https://example.com:443" }, "/x"))
      .toBe("wss://example.com/x")
  })
})

describe("normalizeInstanceUrl - whitespace handling", () => {
  for (const ws of [" ", "\t", "\n", "\r", " \t", " \n ", "\r\n"]) {
    test(`leading/trailing whitespace ${JSON.stringify(ws)} stripped`, () => {
      expect(normalizeInstanceUrl(`${ws}http://x${ws}`)).toBe("http://x")
    })
  }
})
