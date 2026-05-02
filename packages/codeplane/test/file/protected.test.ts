import { describe, expect, test } from "bun:test"
import { Protected } from "../../src/file/protected"

describe("Protected.names", () => {
  test("returns a ReadonlySet", () => {
    const result = Protected.names()
    expect(result instanceof Set).toBe(true)
  })

  test("on darwin returns Music/Documents/Library", () => {
    if (process.platform === "darwin") {
      const names = Protected.names()
      expect(names.has("Music")).toBe(true)
      expect(names.has("Documents")).toBe(true)
      expect(names.has("Library")).toBe(true)
    }
  })

  test("on win32 returns AppData/Documents", () => {
    if (process.platform === "win32") {
      const names = Protected.names()
      expect(names.has("AppData")).toBe(true)
      expect(names.has("Documents")).toBe(true)
    }
  })

  test("on linux returns empty set", () => {
    if (process.platform !== "darwin" && process.platform !== "win32") {
      expect(Protected.names().size).toBe(0)
    }
  })
})

describe("Protected.paths", () => {
  test("returns an array", () => {
    expect(Array.isArray(Protected.paths())).toBe(true)
  })

  test("returns absolute paths", () => {
    for (const p of Protected.paths()) {
      expect(p.startsWith("/") || /^[a-zA-Z]:/.test(p)).toBe(true)
    }
  })

  test("on darwin includes Library subpaths", () => {
    if (process.platform === "darwin") {
      const paths = Protected.paths()
      expect(paths.some((p) => p.includes("Mail"))).toBe(true)
      expect(paths.some((p) => p.includes("Calendars"))).toBe(true)
    }
  })

  test("on darwin includes home media folders", () => {
    if (process.platform === "darwin") {
      const paths = Protected.paths()
      expect(paths.some((p) => p.endsWith("Music"))).toBe(true)
      expect(paths.some((p) => p.endsWith("Pictures"))).toBe(true)
      expect(paths.some((p) => p.endsWith("Movies"))).toBe(true)
    }
  })

  test("on darwin includes Spotlight/Trashes", () => {
    if (process.platform === "darwin") {
      const paths = Protected.paths()
      expect(paths.some((p) => p.includes("Spotlight"))).toBe(true)
      expect(paths.some((p) => p.includes("Trashes"))).toBe(true)
    }
  })

  test("on linux returns empty array", () => {
    if (process.platform !== "darwin" && process.platform !== "win32") {
      expect(Protected.paths()).toEqual([])
    }
  })

  test("paths are unique on darwin", () => {
    if (process.platform === "darwin") {
      const paths = Protected.paths()
      expect(new Set(paths).size).toBe(paths.length)
    }
  })
})
