import { describe, expect, test } from "bun:test"
import { looksConnectable, parseConnectTarget } from "./connect-target"

describe("parseConnectTarget", () => {
  test("'local' aliases map to the default local server", () => {
    for (const alias of ["local", "Local", "localhost", "loopback", "this"]) {
      expect(parseConnectTarget(alias)?.url).toBe("http://127.0.0.1:4096")
    }
  })

  test("localhost with a port keeps the port", () => {
    expect(parseConnectTarget("localhost:5000")?.url).toBe("http://localhost:5000")
  })

  test("bare 'localhost' resolves to the default local server", () => {
    // "localhost" is a local alias, so it maps to the canonical local URL.
    expect(parseConnectTarget("localhost")?.url).toBe("http://127.0.0.1:4096")
  })

  test("127.0.0.1 with a port keeps the port", () => {
    expect(parseConnectTarget("127.0.0.1:5000")?.url).toBe("http://127.0.0.1:5000")
  })

  test("bare IPv4 → http, no forced port", () => {
    expect(parseConnectTarget("192.168.1.5")?.url).toBe("http://192.168.1.5")
    expect(parseConnectTarget("192.168.1.5:4096")?.url).toBe("http://192.168.1.5:4096")
  })

  test("private/LAN hosts use http", () => {
    expect(parseConnectTarget("10.0.0.2")?.url).toBe("http://10.0.0.2")
    expect(parseConnectTarget("box.local")?.url).toBe("http://box.local")
  })

  test("public domain defaults to https", () => {
    expect(parseConnectTarget("box.example.com")?.url).toBe("https://box.example.com")
  })

  test("explicit protocol is respected", () => {
    expect(parseConnectTarget("http://box.example.com")?.url).toBe("http://box.example.com")
    expect(parseConnectTarget("https://192.168.1.5:8080")?.url).toBe("https://192.168.1.5:8080")
  })

  test("trailing slashes are trimmed; paths preserved", () => {
    expect(parseConnectTarget("box.example.com/")?.url).toBe("https://box.example.com")
    expect(parseConnectTarget("box.example.com/codeplane")?.url).toBe("https://box.example.com/codeplane")
  })

  test("empty / whitespace → undefined", () => {
    expect(parseConnectTarget("")).toBeUndefined()
    expect(parseConnectTarget("   ")).toBeUndefined()
  })

  test("label is the host[:port]", () => {
    expect(parseConnectTarget("box.example.com")?.label).toBe("box.example.com")
    expect(parseConnectTarget("local")?.label).toBe("localhost:4096")
  })
})

describe("looksConnectable", () => {
  test("accepts local, IPs, domains, and host:port", () => {
    expect(looksConnectable("local")).toBe(true)
    expect(looksConnectable("192.168.1.5")).toBe(true)
    expect(looksConnectable("box.example.com")).toBe(true)
    expect(looksConnectable("myhost:4096")).toBe(true)
  })

  test("rejects empty and bare single-word non-aliases", () => {
    expect(looksConnectable("")).toBe(false)
    expect(looksConnectable("myhost")).toBe(false) // no dot, no port, not a local alias
  })
})
