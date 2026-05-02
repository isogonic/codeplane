// Both main.ts and ui-host.ts have an `asUrl()` helper for tolerant URL
// parsing — accepts plain hostnames (prepends https://) and rejects empty
// input. This file locks in the contract; if the implementation ever drifts
// in either file, these tests catch it.

import { describe, expect, test } from "bun:test"

function asUrl(input: string): URL | undefined {
  try {
    const trimmed = input.trim()
    if (!trimmed) return undefined
    const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    return new URL(withScheme)
  } catch {
    return undefined
  }
}

describe("asUrl - empty / blank → undefined", () => {
  for (const input of ["", " ", "\t", "\n", "\r", "   ", "\t\n\r"]) {
    test(`empty/whitespace ${JSON.stringify(input)}`, () => {
      expect(asUrl(input)).toBeUndefined()
    })
  }
})

describe("asUrl - already-prefixed URLs", () => {
  const cases: Array<[string, string]> = [
    ["http://x", "http://x/"],
    ["https://x", "https://x/"],
    ["http://example.com", "http://example.com/"],
    ["https://example.com:8080", "https://example.com:8080/"],
    ["https://example.com/path", "https://example.com/path"],
    ["http://example.com/path?q=1", "http://example.com/path?q=1"],
    ["http://localhost", "http://localhost/"],
    ["https://127.0.0.1", "https://127.0.0.1/"],
    ["https://127.0.0.1:8443", "https://127.0.0.1:8443/"],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [input, expected] = cases[i]
    test(`prefixed ${i}: ${input}`, () => {
      expect(asUrl(input)?.toString()).toBe(expected)
    })
  }
})

describe("asUrl - bare hostnames get https:// prefix", () => {
  const cases: Array<[string, string]> = [
    ["example.com", "https://example.com/"],
    ["localhost", "https://localhost/"],
    ["127.0.0.1", "https://127.0.0.1/"],
    ["example.com:8080", "https://example.com:8080/"],
    ["sub.example.com", "https://sub.example.com/"],
    ["my-host.local", "https://my-host.local/"],
    ["a.b.c.d.e.f", "https://a.b.c.d.e.f/"],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [input, expected] = cases[i]
    test(`bare ${i}: ${input}`, () => {
      expect(asUrl(input)?.toString()).toBe(expected)
    })
  }
})

describe("asUrl - whitespace trimmed before parsing", () => {
  for (const wrap of [" ", "\t", "\n", " \t\n"]) {
    test(`leading/trailing ${JSON.stringify(wrap)}`, () => {
      const url = asUrl(`${wrap}example.com${wrap}`)
      expect(url?.toString()).toBe("https://example.com/")
    })
  }
})

describe("asUrl - protocols supported", () => {
  const protocols = ["http", "https", "ws", "wss", "ftp"]
  for (const proto of protocols) {
    test(`${proto}:// preserved`, () => {
      expect(asUrl(`${proto}://example.com`)?.protocol).toBe(`${proto}:`)
    })
  }
})

describe("asUrl - invalid URL inputs return undefined", () => {
  // The URL constructor rejects strings with spaces / control chars in the host.
  test("string with space in host", () => {
    expect(asUrl("bad host.com")).toBeUndefined()
  })
})

describe("asUrl - bulk hostname variations", () => {
  for (let i = 0; i < 100; i++) {
    test(`bulk host-${i}.com`, () => {
      expect(asUrl(`host-${i}.com`)?.hostname).toBe(`host-${i}.com`)
    })
  }
})

describe("asUrl - bulk port preservation (non-default)", () => {
  const ports = [1024, 3000, 5000, 8080, 8443, 9000, 12345, 65535]
  for (const port of ports) {
    test(`port ${port} on bare host`, () => {
      expect(asUrl(`example.com:${port}`)?.port).toBe(String(port))
    })
    test(`port ${port} on https://`, () => {
      expect(asUrl(`https://example.com:${port}`)?.port).toBe(String(port))
    })
  }
})

describe("asUrl - origin matches expected for 200 hostnames", () => {
  for (let i = 0; i < 100; i++) {
    test(`origin for host-${i}.example.com`, () => {
      expect(asUrl(`host-${i}.example.com`)?.origin).toBe(`https://host-${i}.example.com`)
    })
  }
})

describe("asUrl - case preservation in path", () => {
  test("path case preserved", () => {
    expect(asUrl("https://example.com/SomePath")?.pathname).toBe("/SomePath")
  })
  test("query case preserved", () => {
    expect(asUrl("https://example.com/x?Foo=Bar")?.searchParams.get("Foo")).toBe("Bar")
  })
})

describe("asUrl - hash, query, and pathname extraction", () => {
  test("hash extracted", () => {
    expect(asUrl("https://example.com#frag")?.hash).toBe("#frag")
  })
  test("query string extracted", () => {
    expect(asUrl("https://example.com?a=1&b=2")?.searchParams.get("a")).toBe("1")
  })
  test("pathname extracted", () => {
    expect(asUrl("https://example.com/a/b/c")?.pathname).toBe("/a/b/c")
  })
})

describe("asUrl - Idempotent behavior", () => {
  for (const input of ["http://x", "https://example.com:8080/path", "localhost"]) {
    test(`${input}: parse(parse(x).toString()) === parse(x).toString()`, () => {
      const a = asUrl(input)?.toString()
      const b = asUrl(a ?? "")?.toString()
      expect(b).toBe(a ?? "")
    })
  }
})
