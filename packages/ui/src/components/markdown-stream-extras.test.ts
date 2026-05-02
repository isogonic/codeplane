import { describe, expect, test } from "bun:test"
import { stream } from "./markdown-stream"

describe("markdown stream additional cases", () => {
  test("returns full mode when not live", () => {
    expect(stream("hello", false)).toEqual([{ raw: "hello", src: "hello", mode: "full" }])
  })

  test("returns live mode when live=true and no special markup", () => {
    const result = stream("plain text", true)
    expect(result.length).toBe(1)
    expect(result[0].mode).toBe("live")
  })

  test("empty string returns one block", () => {
    const result = stream("", true)
    expect(result.length).toBe(1)
  })

  test("only whitespace returns one block", () => {
    const result = stream("   ", true)
    expect(result.length).toBe(1)
  })

  test("only newlines returns one block", () => {
    const result = stream("\n\n", true)
    expect(result.length).toBe(1)
  })

  test("non-code trailing content stays as one block", () => {
    const result = stream("# heading\n\nparagraph", true)
    expect(result.length).toBe(1)
  })

  test("closed code fence stays as one block", () => {
    const result = stream("text\n\n```\ncode\n```", true)
    expect(result.length).toBe(1)
  })

  test("tilde fences also split", () => {
    const result = stream("text\n\n~~~ts\nconst x = 1", true)
    expect(result.length).toBe(2)
  })

  test("keeps refs syntax intact when streaming", () => {
    const result = stream("[a]: http://x", true)
    expect(result.length).toBe(1)
    expect(result[0].raw).toContain("[a]:")
  })

  test("footnote refs also stay intact", () => {
    const result = stream("[^1]: footnote", true)
    expect(result.length).toBe(1)
  })

  test("non-live mode does not heal markup", () => {
    const result = stream("**bold", false)
    expect(result[0].src).toBe("**bold")
  })

  test("live mode heals incomplete bold", () => {
    const result = stream("**bold", true)
    expect(result[0].src).toContain("**")
  })

  test("preserves raw text when streaming code", () => {
    const result = stream("```\nx", true)
    const codeBlock = result[result.length - 1]
    expect(codeBlock.raw).toContain("```")
  })

  test("returns array", () => {
    expect(Array.isArray(stream("hello", true))).toBe(true)
    expect(Array.isArray(stream("hello", false))).toBe(true)
  })

  test("each block has raw, src, mode", () => {
    for (const block of stream("text\n\n```\nsome code", true)) {
      expect("raw" in block).toBe(true)
      expect("src" in block).toBe(true)
      expect("mode" in block).toBe(true)
    }
  })

  test("4-backtick fence triggers split", () => {
    const result = stream("hello\n\n````\ncode", true)
    expect(result.length).toBe(2)
  })
})
