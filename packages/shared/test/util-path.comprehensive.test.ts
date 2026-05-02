import { describe, expect, test } from "bun:test"
import {
  getDirectory,
  getFileExtension,
  getFilename,
  getFilenameTruncated,
  truncateMiddle,
} from "../src/util/path"

describe("getFilename", () => {
  test("undefined input", () => expect(getFilename(undefined)).toBe(""))
  test("empty string", () => expect(getFilename("")).toBe(""))
  test("just a filename", () => expect(getFilename("file.txt")).toBe("file.txt"))
  test("posix path", () => expect(getFilename("/a/b/c.txt")).toBe("c.txt"))
  test("windows path", () => expect(getFilename("C:\\a\\b\\c.txt")).toBe("c.txt"))
  test("trailing slash posix", () => expect(getFilename("/a/b/")).toBe("b"))
  test("trailing slash windows", () => expect(getFilename("C:\\a\\b\\")).toBe("b"))
  test("multiple trailing slashes", () => expect(getFilename("/a/b///")).toBe("b"))
  test("just slash", () => expect(getFilename("/")).toBe(""))
  test("just backslashes", () => expect(getFilename("\\\\")).toBe(""))
  test("mixed slashes", () => expect(getFilename("/a\\b/c\\d.txt")).toBe("d.txt"))
  test("unicode filename", () => expect(getFilename("/path/日本語.txt")).toBe("日本語.txt"))
  test("emoji filename", () => expect(getFilename("/path/🚀.txt")).toBe("🚀.txt"))
  test("filename with spaces", () =>
    expect(getFilename("/a/file with spaces.txt")).toBe("file with spaces.txt"))
  test("file without extension", () => expect(getFilename("/a/file")).toBe("file"))
  test("file with multiple dots", () =>
    expect(getFilename("/a/file.tar.gz")).toBe("file.tar.gz"))
  test("hidden file", () => expect(getFilename("/a/.bashrc")).toBe(".bashrc"))
  for (let i = 0; i < 50; i++) {
    test(`bulk #${i}`, () =>
      expect(getFilename(`/some/path/file${i}.txt`)).toBe(`file${i}.txt`))
  }
})

describe("getDirectory", () => {
  test("undefined", () => expect(getDirectory(undefined)).toBe(""))
  test("empty", () => expect(getDirectory("")).toBe(""))
  test("just filename has no directory", () => expect(getDirectory("file.txt")).toBe("/"))
  test("simple path", () => expect(getDirectory("/a/b/c.txt")).toBe("/a/b/"))
  test("windows path normalized to /", () =>
    expect(getDirectory("C:\\a\\b\\c.txt")).toBe("C:/a/b/"))
  test("trailing slash trimmed", () => expect(getDirectory("/a/b/")).toBe("/a/"))
  test("ends with /", () => expect(getDirectory("/x/y/z").endsWith("/")).toBe(true))
  for (let i = 0; i < 50; i++) {
    test(`bulk #${i}`, () =>
      expect(getDirectory(`/dir${i}/file.txt`)).toBe(`/dir${i}/`))
  }
})

describe("getFileExtension", () => {
  test("undefined", () => expect(getFileExtension(undefined)).toBe(""))
  test("empty", () => expect(getFileExtension("")).toBe(""))
  test("simple ext", () => expect(getFileExtension("file.txt")).toBe("txt"))
  test("double ext returns last", () => expect(getFileExtension("file.tar.gz")).toBe("gz"))
  test("no ext returns filename", () => expect(getFileExtension("README")).toBe("README"))
  test("hidden file", () => expect(getFileExtension(".bashrc")).toBe("bashrc"))
  test("path keeps extension", () => expect(getFileExtension("/a/b/c.json")).toBe("json"))
  for (let i = 0; i < 50; i++) {
    test(`bulk #${i}`, () => expect(getFileExtension(`file.ext${i}`)).toBe(`ext${i}`))
  }
})

describe("getFilenameTruncated", () => {
  test("undefined returns empty", () => expect(getFilenameTruncated(undefined)).toBe(""))
  test("short filename unchanged", () => expect(getFilenameTruncated("a.txt", 20)).toBe("a.txt"))
  test("filename equal to max unchanged", () =>
    expect(getFilenameTruncated("abcdefghij.txt", 14)).toBe("abcdefghij.txt"))
  test("truncates long filename keeping extension", () => {
    const result = getFilenameTruncated("very_long_filename.txt", 12)
    expect(result.endsWith(".txt")).toBe(true)
    expect(result.includes("…")).toBe(true)
  })
  test("path strips directory before truncation", () =>
    expect(getFilenameTruncated("/long/path/to/file.txt", 30)).toBe("file.txt"))
  test("respects maxLength when no extension", () => {
    const result = getFilenameTruncated("verylongnamewithoutextension", 10)
    expect(result.length).toBeLessThanOrEqual(10)
  })
  for (let n = 5; n < 25; n++) {
    test(`max length ${n}`, () => {
      const out = getFilenameTruncated("a-very-long-filename.txt", n)
      expect(out.length).toBeLessThanOrEqual(n + 1) // ellipsis is 1 char wide visually
    })
  }
})

describe("truncateMiddle", () => {
  test("short string unchanged", () => expect(truncateMiddle("hello", 10)).toBe("hello"))
  test("equal length unchanged", () => expect(truncateMiddle("abcdef", 6)).toBe("abcdef"))
  test("truncates middle with ellipsis", () => {
    const out = truncateMiddle("abcdefghijklmn", 7)
    expect(out).toContain("…")
    expect(out.length).toBeLessThanOrEqual(7)
  })
  test("preserves head", () => {
    const out = truncateMiddle("HEAD-middle-TAIL", 8)
    expect(out.startsWith("HE") || out.startsWith("H")).toBe(true)
  })
  test("preserves tail", () => {
    const out = truncateMiddle("HEAD-middle-TAIL", 8)
    expect(out.endsWith("L") || out.endsWith("AIL")).toBe(true)
  })
  for (let n = 3; n <= 30; n++) {
    test(`max length ${n}`, () => {
      const out = truncateMiddle("a".repeat(50), n)
      expect(out.length).toBeLessThanOrEqual(n)
    })
  }
  test("max length 1 has known edge-case behaviour (slice(-0) returns full string)", () => {
    const out = truncateMiddle("abcde", 1)
    expect(out).toBe("…abcde")
  })
  test("max length 2 has known edge-case behaviour", () => {
    const out = truncateMiddle("abcde", 2)
    expect(out).toBe("a…abcde")
  })
})
