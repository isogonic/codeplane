import { describe, expect, test } from "bun:test"
import { Glob } from "../../src/util/glob"

describe("Glob.match", () => {
  test("exact filename matches", () => {
    expect(Glob.match("file.txt", "file.txt")).toBe(true)
  })

  test("star wildcard matches", () => {
    expect(Glob.match("*.txt", "file.txt")).toBe(true)
  })

  test("star wildcard does not match different extension", () => {
    expect(Glob.match("*.txt", "file.md")).toBe(false)
  })

  test("question mark wildcard matches single char", () => {
    expect(Glob.match("file.???", "file.txt")).toBe(true)
  })

  test("globstar matches deep paths", () => {
    expect(Glob.match("**/*.ts", "a/b/c/file.ts")).toBe(true)
  })

  test("dotfile matched when dot:true", () => {
    expect(Glob.match("*", ".hidden")).toBe(true)
  })

  test("non-matching pattern returns false", () => {
    expect(Glob.match("foo/*", "bar/file.txt")).toBe(false)
  })

  test("nested directory pattern", () => {
    expect(Glob.match("src/**/*.ts", "src/a/b/file.ts")).toBe(true)
  })

  test("trailing slash in directory matching", () => {
    expect(Glob.match("dir/", "dir/")).toBe(true)
  })

  test("character class", () => {
    expect(Glob.match("file.[tj]s", "file.ts")).toBe(true)
    expect(Glob.match("file.[tj]s", "file.js")).toBe(true)
    expect(Glob.match("file.[tj]s", "file.cs")).toBe(false)
  })

  test("brace expansion", () => {
    expect(Glob.match("file.{ts,js}", "file.ts")).toBe(true)
    expect(Glob.match("file.{ts,js}", "file.js")).toBe(true)
    expect(Glob.match("file.{ts,js}", "file.md")).toBe(false)
  })

  test("globstar at root", () => {
    expect(Glob.match("**", "file.txt")).toBe(true)
  })

  test("empty filepath does not match arbitrary pattern", () => {
    expect(Glob.match("*.ts", "")).toBe(false)
  })
})

describe("Glob.scan", () => {
  test("returns a promise of strings", async () => {
    const result = await Glob.scan("nonexistent-dir/*.foo")
    expect(Array.isArray(result)).toBe(true)
  })

  test("returns empty for nonexistent pattern", async () => {
    const result = await Glob.scan("zzz-nonexistent-zzz/*.x")
    expect(result).toEqual([])
  })
})

describe("Glob.scanSync", () => {
  test("returns strings synchronously", () => {
    const result = Glob.scanSync("zzz-nonexistent-zzz/*.x")
    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual([])
  })
})
