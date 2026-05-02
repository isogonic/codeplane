import { describe, expect, test } from "bun:test"
import { getFilename, getDirectory, getFileExtension, getFilenameTruncated, truncateMiddle } from "../../src/util/path"

describe("getFilename", () => {
  test("returns filename from unix path", () => {
    expect(getFilename("/a/b/c.txt")).toBe("c.txt")
  })

  test("returns filename from windows path", () => {
    expect(getFilename("C:\\a\\b\\c.txt")).toBe("c.txt")
  })

  test("returns last segment from mixed slashes", () => {
    expect(getFilename("/a\\b/c.txt")).toBe("c.txt")
  })

  test("strips trailing slash", () => {
    expect(getFilename("/a/b/")).toBe("b")
  })

  test("strips multiple trailing slashes", () => {
    expect(getFilename("/a/b///")).toBe("b")
  })

  test("strips trailing backslashes", () => {
    expect(getFilename("/a/b\\\\")).toBe("b")
  })

  test("returns empty for empty input", () => {
    expect(getFilename("")).toBe("")
  })

  test("returns empty for undefined", () => {
    expect(getFilename(undefined)).toBe("")
  })

  test("returns single name as-is", () => {
    expect(getFilename("file.txt")).toBe("file.txt")
  })

  test("works with hidden files", () => {
    expect(getFilename("/path/to/.hidden")).toBe(".hidden")
  })

  test("works with files no extension", () => {
    expect(getFilename("/path/to/README")).toBe("README")
  })

  test("works with relative paths", () => {
    expect(getFilename("./file.txt")).toBe("file.txt")
  })

  test("works with parent reference", () => {
    expect(getFilename("../file.txt")).toBe("file.txt")
  })

  test("very deep path", () => {
    expect(getFilename("/a/b/c/d/e/f/g/h.txt")).toBe("h.txt")
  })

  test("path with spaces", () => {
    expect(getFilename("/path with space/my file.txt")).toBe("my file.txt")
  })
})

describe("getDirectory", () => {
  test("returns directory from unix path", () => {
    expect(getDirectory("/a/b/c.txt")).toBe("/a/b/")
  })

  test("returns empty / for top-level file", () => {
    expect(getDirectory("file.txt")).toBe("/")
  })

  test("returns empty for empty input", () => {
    expect(getDirectory("")).toBe("")
  })

  test("returns empty for undefined", () => {
    expect(getDirectory(undefined)).toBe("")
  })

  test("trailing slash is normalized away first", () => {
    expect(getDirectory("/a/b/")).toBe("/a/")
  })

  test("works with windows backslashes", () => {
    expect(getDirectory("C:\\a\\b\\c.txt")).toBe("C:/a/b/")
  })

  test("ends with /", () => {
    expect(getDirectory("/x/y.txt").endsWith("/")).toBe(true)
  })
})

describe("getFileExtension", () => {
  test("extracts simple extension", () => {
    expect(getFileExtension("/a/b.txt")).toBe("txt")
  })

  test("extracts last extension when multiple dots", () => {
    expect(getFileExtension("/a/b.tar.gz")).toBe("gz")
  })

  test("returns empty for undefined", () => {
    expect(getFileExtension(undefined)).toBe("")
  })

  test("returns whole filename when no extension", () => {
    expect(getFileExtension("README")).toBe("README")
  })

  test("dot file with no extension", () => {
    expect(getFileExtension(".hidden")).toBe("hidden")
  })

  test("works with no path prefix", () => {
    expect(getFileExtension("a.json")).toBe("json")
  })
})

describe("getFilenameTruncated", () => {
  test("returns filename when within limit", () => {
    expect(getFilenameTruncated("/a/b.txt", 20)).toBe("b.txt")
  })

  test("truncates long name preserving extension", () => {
    const result = getFilenameTruncated("/a/very-long-name-here.txt", 10)
    expect(result.endsWith(".txt")).toBe(true)
    expect(result).toContain("…")
  })

  test("respects max length", () => {
    const result = getFilenameTruncated("/a/very-long-name-here.txt", 10)
    expect(result.length).toBeLessThanOrEqual(10)
  })

  test("default max length is 20", () => {
    expect(getFilenameTruncated("/a/short.txt")).toBe("short.txt")
  })

  test("very small max length", () => {
    const r = getFilenameTruncated("/a/abcdefghijklmnop.txt", 3)
    expect(r.length).toBeLessThanOrEqual(3)
  })

  test("filename without extension", () => {
    const r = getFilenameTruncated("/a/abcdefghijklmnop", 10)
    expect(r).toContain("…")
  })

  test("undefined input", () => {
    expect(getFilenameTruncated(undefined)).toBe("")
  })

  test("empty input", () => {
    expect(getFilenameTruncated("")).toBe("")
  })

  test("filename exactly at limit", () => {
    const filename = "abcdef.txt"
    expect(getFilenameTruncated(filename, filename.length)).toBe(filename)
  })

  test("hidden file truncation", () => {
    const r = getFilenameTruncated("/a/.long-hidden-file-name", 10)
    expect(typeof r).toBe("string")
  })
})

describe("truncateMiddle", () => {
  test("returns text when within limit", () => {
    expect(truncateMiddle("hello", 10)).toBe("hello")
  })

  test("truncates with ellipsis", () => {
    const r = truncateMiddle("abcdefghijk", 5)
    expect(r).toContain("…")
    expect(r.length).toBe(5)
  })

  test("default max length 20", () => {
    expect(truncateMiddle("abc")).toBe("abc")
  })

  test("preserves start and end", () => {
    const r = truncateMiddle("abcdefghijklmnop", 7)
    expect(r.startsWith("a")).toBe(true)
    expect(r.endsWith("p")).toBe(true)
    expect(r).toContain("…")
  })

  test("handles odd lengths", () => {
    const r = truncateMiddle("abcdefghi", 5)
    expect(r.length).toBe(5)
  })

  test("handles even lengths", () => {
    const r = truncateMiddle("abcdefghi", 6)
    expect(r.length).toBe(6)
  })

  test("text length exactly equals max", () => {
    expect(truncateMiddle("hello", 5)).toBe("hello")
  })

  test("text length one less than max", () => {
    expect(truncateMiddle("hell", 5)).toBe("hell")
  })

  test("text length one more than max", () => {
    const r = truncateMiddle("hello!", 5)
    expect(r.length).toBe(5)
    expect(r).toContain("…")
  })

  test("very long text", () => {
    const long = "x".repeat(1000)
    const r = truncateMiddle(long, 20)
    expect(r.length).toBe(20)
  })

  test("max length 1 returns ellipsis followed by full text (slice(-0) quirk)", () => {
    const r = truncateMiddle("abcde", 1)
    expect(r.startsWith("…")).toBe(true)
    expect(r.includes("abcde")).toBe(true)
  })

  test("max length 2 starts with first char + ellipsis", () => {
    const r = truncateMiddle("abcde", 2)
    expect(r.startsWith("a")).toBe(true)
    expect(r.includes("…")).toBe(true)
  })

  test("max length 3 produces start char + ellipsis + end char", () => {
    const r = truncateMiddle("abcde", 3)
    expect(r.length).toBe(3)
    expect(r).toContain("…")
  })
})
