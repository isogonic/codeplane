import { describe, expect, test } from "bun:test"
import { Glob } from "../src/util/glob"

describe("Glob.match", () => {
  test("exact match", () => expect(Glob.match("*.ts", "file.ts")).toBe(true))
  test("no match", () => expect(Glob.match("*.ts", "file.js")).toBe(false))
  test("matches with directory", () =>
    expect(Glob.match("**/*.ts", "src/foo.ts")).toBe(true))
  test("does not match with file in non-deep glob", () =>
    expect(Glob.match("*.ts", "src/foo.ts")).toBe(false))
  test("matches dotfile when dot enabled", () =>
    expect(Glob.match(".env*", ".envrc")).toBe(true))
  test("question mark matches single char", () =>
    expect(Glob.match("file?.ts", "file1.ts")).toBe(true))
  test("question mark requires single char", () =>
    expect(Glob.match("file?.ts", "file12.ts")).toBe(false))
  test("braces alternative", () =>
    expect(Glob.match("file.{ts,js}", "file.ts")).toBe(true))
  test("braces alternative second option", () =>
    expect(Glob.match("file.{ts,js}", "file.js")).toBe(true))
  test("braces alternative no match", () =>
    expect(Glob.match("file.{ts,js}", "file.css")).toBe(false))
  test("character class", () =>
    expect(Glob.match("file[12].ts", "file1.ts")).toBe(true))
  test("character class no match", () =>
    expect(Glob.match("file[12].ts", "file3.ts")).toBe(false))
  test("globstar matches multiple dirs", () =>
    expect(Glob.match("a/**/b.ts", "a/x/y/z/b.ts")).toBe(true))
  test("globstar matches zero dirs", () =>
    expect(Glob.match("a/**/b.ts", "a/b.ts")).toBe(true))
  for (let i = 0; i < 50; i++) {
    test(`bulk pattern *.${i} matches file.${i}`, () =>
      expect(Glob.match(`*.${i}`, `file.${i}`)).toBe(true))
  }
})

describe("Glob.scan and Glob.scanSync", () => {
  test("scanSync returns array", () => {
    const result = Glob.scanSync("*", { cwd: "/" })
    expect(Array.isArray(result)).toBe(true)
  })
  test("scan returns promise of array", async () => {
    const result = await Glob.scan("*", { cwd: "/" })
    expect(Array.isArray(result)).toBe(true)
  })
})

describe("Glob.match - edge", () => {
  test("empty pattern matches empty path", () => {
    // glob library convention: empty pattern matches empty string only
    expect(Glob.match("", "")).toBe(true)
  })
  test("pattern matches itself when no special chars", () =>
    expect(Glob.match("plain.txt", "plain.txt")).toBe(true))
  test("case-sensitive", () =>
    expect(Glob.match("File.ts", "file.ts")).toBe(false))
})
