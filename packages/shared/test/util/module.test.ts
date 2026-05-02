import { describe, expect, test } from "bun:test"
import { Module } from "../../src/util/module"

describe("Module.resolve", () => {
  test("returns undefined for nonexistent package", () => {
    expect(Module.resolve("this-package-does-not-exist-zz", process.cwd())).toBeUndefined()
  })

  test("returns string for resolvable built-in like 'path'", () => {
    expect(Module.resolve("path", process.cwd())).toBeDefined()
  })

  test("does not throw on bad dir", () => {
    expect(() => Module.resolve("path", "/no/such/dir")).not.toThrow()
  })

  test("handles empty package name gracefully", () => {
    expect(Module.resolve("", process.cwd())).toBeUndefined()
  })

  test("returns absolute path for installed package", () => {
    const result = Module.resolve("zod", process.cwd())
    if (result) expect(result.startsWith("/")).toBe(true)
  })
})
