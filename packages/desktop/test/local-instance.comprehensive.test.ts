import { describe, expect, test } from "bun:test"
import { findListeningPort, resolveLocalTarget } from "../src/main/local-instance"

describe("desktop re-exports - findListeningPort", () => {
  test("matches simple http", () =>
    expect(findListeningPort("listening on http://127.0.0.1:1234")).toBe(1234))
  test("matches https", () =>
    expect(findListeningPort("listening on https://0.0.0.0:65535")).toBe(65535))
  test("matches alt phrasing", () =>
    expect(findListeningPort("server started on http://localhost:8080")).toBe(8080))
  test("matches another phrasing", () =>
    expect(findListeningPort("listening at http://0.0.0.0:9000")).toBe(9000))
  test("returns undefined when no port", () =>
    expect(findListeningPort("just a normal log")).toBeUndefined())
  test("returns undefined when malformed", () =>
    expect(findListeningPort("listening on http://localhost:abc")).toBeUndefined())
  for (let port = 1024; port < 1124; port++) {
    test(`matches port ${port}`, () =>
      expect(findListeningPort(`listening on http://127.0.0.1:${port}`)).toBe(port))
  }
})

describe("desktop re-exports - resolveLocalTarget", () => {
  test("returns object with archiveName, archiveExt, binaryName, os, arch, packageName", () => {
    const target = resolveLocalTarget()
    expect(typeof target.archiveName).toBe("string")
    expect(typeof target.binaryName).toBe("string")
    expect(["darwin", "linux", "windows"]).toContain(target.os)
    expect(["x64", "arm64"]).toContain(target.arch)
  })
  test("packageName starts with codeplane", () => {
    expect(resolveLocalTarget().packageName).toMatch(/^codeplane/)
  })
  test("archiveName matches packageName", () => {
    const target = resolveLocalTarget()
    expect(target.archiveName).toContain(target.packageName)
  })
  test("archiveExt is tgz", () => {
    expect(resolveLocalTarget().archiveExt).toBe(".tgz")
  })
  test("binaryName has correct extension on each platform", () => {
    const target = resolveLocalTarget()
    if (target.os === "windows") {
      expect(target.binaryName).toBe("codeplane.exe")
    } else {
      expect(target.binaryName).toBe("codeplane")
    }
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk resolveLocalTarget #${i} returns same target`, () => {
      const a = resolveLocalTarget()
      const b = resolveLocalTarget()
      expect(a.os).toBe(b.os)
      expect(a.arch).toBe(b.arch)
      expect(a.packageName).toBe(b.packageName)
    })
  }
})
