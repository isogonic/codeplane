import { describe, expect, test } from "bun:test"
import {
  createCommentMetadata,
  formatCommentNote,
  parseCommentNote,
  readCommentMetadata,
} from "../../src/utils/comment-note"

describe("createCommentMetadata", () => {
  test("returns wrapped object", () => {
    const out = createCommentMetadata({ path: "a.ts", comment: "hi" })
    expect(out.codeplaneComment.path).toBe("a.ts")
  })
  test("includes selection when given", () => {
    const out = createCommentMetadata({
      path: "a.ts",
      comment: "hi",
      selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 5 },
    })
    expect(out.codeplaneComment.selection?.startLine).toBe(1)
  })
  test("includes preview when given", () => {
    const out = createCommentMetadata({
      path: "a.ts",
      comment: "hi",
      preview: "preview text",
    })
    expect(out.codeplaneComment.preview).toBe("preview text")
  })
  test("includes origin when given", () => {
    const out = createCommentMetadata({ path: "a.ts", comment: "hi", origin: "review" })
    expect(out.codeplaneComment.origin).toBe("review")
  })
})

describe("readCommentMetadata", () => {
  test("returns undefined for null/undefined", () => {
    expect(readCommentMetadata(null)).toBeUndefined()
    expect(readCommentMetadata(undefined)).toBeUndefined()
  })
  test("returns undefined for non-object", () => {
    expect(readCommentMetadata("hi")).toBeUndefined()
    expect(readCommentMetadata(42)).toBeUndefined()
  })
  test("returns undefined for empty object", () => {
    expect(readCommentMetadata({})).toBeUndefined()
  })
  test("returns undefined when meta is missing path", () => {
    expect(readCommentMetadata({ codeplaneComment: { comment: "hi" } })).toBeUndefined()
  })
  test("returns undefined when meta is missing comment", () => {
    expect(readCommentMetadata({ codeplaneComment: { path: "a.ts" } })).toBeUndefined()
  })
  test("reads valid metadata", () => {
    const result = readCommentMetadata({
      codeplaneComment: { path: "a.ts", comment: "hi" },
    })
    expect(result?.path).toBe("a.ts")
    expect(result?.comment).toBe("hi")
  })
  test("invalid origin becomes undefined", () => {
    const result = readCommentMetadata({
      codeplaneComment: { path: "a.ts", comment: "hi", origin: "invalid" },
    })
    expect(result?.origin).toBeUndefined()
  })
  test("review origin preserved", () => {
    const result = readCommentMetadata({
      codeplaneComment: { path: "a.ts", comment: "hi", origin: "review" },
    })
    expect(result?.origin).toBe("review")
  })
  test("invalid selection numbers become undefined", () => {
    const result = readCommentMetadata({
      codeplaneComment: {
        path: "a.ts",
        comment: "hi",
        selection: { startLine: "x", startChar: 0, endLine: 2, endChar: 5 },
      },
    })
    expect(result?.selection).toBeUndefined()
  })
})

describe("formatCommentNote and parseCommentNote round-trip", () => {
  for (let i = 0; i < 30; i++) {
    test(`single-line comment #${i}`, () => {
      const original = {
        path: `file-${i}.ts`,
        selection: { startLine: i, startChar: 0, endLine: i, endChar: 0 },
        comment: `comment-${i}`,
      }
      const note = formatCommentNote(original)
      const parsed = parseCommentNote(note)
      expect(parsed?.path).toBe(original.path)
      expect(parsed?.comment).toBe(original.comment)
    })
  }
  for (let i = 1; i < 30; i++) {
    test(`multi-line comment #${i}`, () => {
      const original = {
        path: `file-${i}.ts`,
        selection: { startLine: 1, startChar: 0, endLine: i + 1, endChar: 0 },
        comment: `multi-${i}`,
      }
      const note = formatCommentNote(original)
      const parsed = parseCommentNote(note)
      expect(parsed?.path).toBe(original.path)
      expect(parsed?.selection?.startLine).toBe(1)
      expect(parsed?.selection?.endLine).toBe(i + 1)
    })
  }
  for (let i = 0; i < 20; i++) {
    test(`whole-file comment #${i}`, () => {
      const note = formatCommentNote({ path: `f${i}.ts`, comment: `whole-${i}` })
      expect(note).toContain("this file")
      const parsed = parseCommentNote(note)
      expect(parsed?.path).toBe(`f${i}.ts`)
      expect(parsed?.selection).toBeUndefined()
    })
  }
})

describe("formatCommentNote variations", () => {
  test("single line range", () => {
    const note = formatCommentNote({
      path: "a.ts",
      selection: { startLine: 5, startChar: 0, endLine: 5, endChar: 10 },
      comment: "x",
    })
    expect(note).toContain("line 5")
  })
  test("multi-line range", () => {
    const note = formatCommentNote({
      path: "a.ts",
      selection: { startLine: 5, startChar: 0, endLine: 10, endChar: 0 },
      comment: "x",
    })
    expect(note).toContain("lines 5 through 10")
  })
  test("whole file when no selection", () => {
    expect(formatCommentNote({ path: "a.ts", comment: "x" })).toContain("this file")
  })
})

describe("parseCommentNote rejection", () => {
  test("rejects malformed text", () => {
    expect(parseCommentNote("not a valid note")).toBeUndefined()
  })
  test("rejects empty string", () => {
    expect(parseCommentNote("")).toBeUndefined()
  })
})
