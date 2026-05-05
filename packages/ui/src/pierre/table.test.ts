import { describe, expect, test } from "bun:test"
import { detectDelimiter, parseDelimited } from "./table"

describe("detectDelimiter", () => {
  test("uses path extension for .tsv", () => {
    expect(detectDelimiter("data.tsv", "a,b,c")).toBe("\t")
  })

  test("uses path extension for .csv", () => {
    expect(detectDelimiter("data.csv", "a\tb\tc")).toBe(",")
  })

  test("falls back to detection without extension", () => {
    expect(detectDelimiter(undefined, "a\tb\tc")).toBe("\t")
    expect(detectDelimiter(undefined, "a;b;c")).toBe(";")
    expect(detectDelimiter(undefined, "a,b,c")).toBe(",")
  })

  test("defaults to comma when ambiguous", () => {
    expect(detectDelimiter(undefined, "")).toBe(",")
  })
})

describe("parseDelimited", () => {
  test("parses simple csv", () => {
    const result = parseDelimited("a,b,c\n1,2,3\n4,5,6", ",")
    expect(result.headers).toEqual(["a", "b", "c"])
    expect(result.rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ])
  })

  test("handles quoted fields with commas", () => {
    const result = parseDelimited('a,b\n"hello, world",2', ",")
    expect(result.rows[0]).toEqual(["hello, world", "2"])
  })

  test("handles escaped quotes", () => {
    const result = parseDelimited('a\n"he said ""hi"""', ",")
    expect(result.rows[0]).toEqual(['he said "hi"'])
  })

  test("handles tab delimited", () => {
    const result = parseDelimited("a\tb\n1\t2", "\t")
    expect(result.headers).toEqual(["a", "b"])
    expect(result.rows).toEqual([["1", "2"]])
  })

  test("handles CRLF line endings", () => {
    const result = parseDelimited("a,b\r\n1,2\r\n3,4", ",")
    expect(result.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ])
  })

  test("returns empty for empty input", () => {
    expect(parseDelimited("", ",")).toEqual({ headers: [], rows: [], truncated: false })
  })

  test("handles trailing newline", () => {
    const result = parseDelimited("a,b\n1,2\n", ",")
    expect(result.rows).toEqual([["1", "2"]])
  })
})
