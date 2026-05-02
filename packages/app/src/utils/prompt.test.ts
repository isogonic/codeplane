import { describe, expect, test } from "bun:test"
import type { Part } from "@codeplane-ai/sdk/v2"
import { extractPromptFromParts } from "./prompt"

describe("extractPromptFromParts", () => {
  test("restores multiple uploaded attachments", () => {
    const parts = [
      {
        id: "text_1",
        type: "text",
        text: "check these",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,AAA",
        filename: "a.png",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_2",
        type: "file",
        mime: "application/pdf",
        url: "data:application/pdf;base64,BBB",
        filename: "b.pdf",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ type: "text", content: "check these" })
    expect(result.slice(1)).toMatchObject([
      { type: "image", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
      { type: "image", filename: "b.pdf", mime: "application/pdf", dataUrl: "data:application/pdf;base64,BBB" },
    ])
  })

  test("returns a single empty text part when no parts have text", () => {
    const result = extractPromptFromParts([])
    expect(result).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
  })

  test("inlines a file mention with @-prefix value", () => {
    const text = "look at @src/foo.ts please"
    const parts = [
      {
        id: "text_1",
        type: "text",
        text,
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "text/plain",
        url: "file:///abs/src/foo.ts",
        filename: "foo.ts",
        sessionID: "ses_1",
        messageID: "msg_1",
        source: {
          type: "file",
          path: "/abs/src/foo.ts",
          text: { value: "@src/foo.ts", start: text.indexOf("@src/foo.ts"), end: text.indexOf("@src/foo.ts") + "@src/foo.ts".length },
        },
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ type: "text", content: "look at " })
    expect(result[1]).toMatchObject({ type: "file", path: "src/foo.ts", content: "@src/foo.ts" })
    expect(result[2]).toMatchObject({ type: "text", content: " please" })
  })

  test("uses source.path when value does not start with @", () => {
    const text = "see foo.ts here"
    const parts = [
      {
        id: "text_1",
        type: "text",
        text,
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "text/plain",
        url: "file:///abs/foo.ts",
        filename: "foo.ts",
        sessionID: "ses_1",
        messageID: "msg_1",
        source: {
          type: "file",
          path: "/abs/foo.ts",
          text: { value: "foo.ts", start: 4, end: 10 },
        },
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)

    const fileNode = result.find((p) => p.type === "file") as { type: "file"; path: string; content: string }
    expect(fileNode).toBeDefined()
    expect(fileNode.path).toBe("/abs/foo.ts")
    expect(fileNode.content).toBe("foo.ts")
  })

  test("strips a directory prefix from absolute file paths", () => {
    const text = "@src/foo.ts"
    const parts = [
      { id: "text_1", type: "text", text, sessionID: "ses_1", messageID: "msg_1" },
      {
        id: "file_1",
        type: "file",
        mime: "text/plain",
        url: "file:///proj/src/foo.ts",
        filename: "foo.ts",
        sessionID: "ses_1",
        messageID: "msg_1",
        source: {
          type: "file",
          path: "/proj/src/foo.ts",
          text: { value: "@src/foo.ts", start: 0, end: 11 },
        },
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts, { directory: "/proj" })
    const fileNode = result.find((p) => p.type === "file") as { type: "file"; path: string }
    expect(fileNode.path).toBe("src/foo.ts")
  })

  test("preserves an absolute source.path when directory does not match", () => {
    const text = "see foo.ts here"
    const parts = [
      { id: "text_1", type: "text", text, sessionID: "ses_1", messageID: "msg_1" },
      {
        id: "file_1",
        type: "file",
        mime: "text/plain",
        url: "file:///elsewhere/src/foo.ts",
        filename: "foo.ts",
        sessionID: "ses_1",
        messageID: "msg_1",
        source: {
          type: "file",
          path: "/elsewhere/src/foo.ts",
          text: { value: "foo.ts", start: 4, end: 10 },
        },
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts, { directory: "/proj" })
    const fileNode = result.find((p) => p.type === "file") as { type: "file"; path: string }
    expect(fileNode.path).toBe("/elsewhere/src/foo.ts")
  })

  test("strips a directory prefix that does not have a trailing slash", () => {
    const text = "see foo.ts"
    const parts = [
      { id: "text_1", type: "text", text, sessionID: "ses_1", messageID: "msg_1" },
      {
        id: "file_1",
        type: "file",
        mime: "text/plain",
        url: "file:///proj/foo.ts",
        filename: "foo.ts",
        sessionID: "ses_1",
        messageID: "msg_1",
        source: {
          type: "file",
          path: "/proj/foo.ts",
          text: { value: "foo.ts", start: 4, end: 10 },
        },
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts, { directory: "/proj/" })
    const fileNode = result.find((p) => p.type === "file") as { type: "file"; path: string }
    expect(fileNode.path).toBe("foo.ts")
  })

  test("parses a line selection from the file URL query string", () => {
    const text = "@src/foo.ts"
    const parts = [
      { id: "text_1", type: "text", text, sessionID: "ses_1", messageID: "msg_1" },
      {
        id: "file_1",
        type: "file",
        mime: "text/plain",
        url: "file:///abs/src/foo.ts?start=5&end=10",
        filename: "foo.ts",
        sessionID: "ses_1",
        messageID: "msg_1",
        source: {
          type: "file",
          path: "/abs/src/foo.ts",
          text: { value: "@src/foo.ts", start: 0, end: 11 },
        },
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)
    const fileNode = result.find((p) => p.type === "file") as {
      type: "file"
      selection?: { startLine: number; endLine: number; startChar?: number; endChar?: number }
    }
    expect(fileNode.selection).toEqual({ startLine: 5, endLine: 10, startChar: 0, endChar: 0 })
  })

  test("ignores non-numeric selection params", () => {
    const text = "@src/foo.ts"
    const parts = [
      { id: "text_1", type: "text", text, sessionID: "ses_1", messageID: "msg_1" },
      {
        id: "file_1",
        type: "file",
        mime: "text/plain",
        url: "file:///abs/src/foo.ts?start=foo&end=bar",
        filename: "foo.ts",
        sessionID: "ses_1",
        messageID: "msg_1",
        source: {
          type: "file",
          path: "/abs/src/foo.ts",
          text: { value: "@src/foo.ts", start: 0, end: 11 },
        },
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)
    const fileNode = result.find((p) => p.type === "file") as { selection?: unknown }
    expect(fileNode.selection).toBeUndefined()
  })

  test("inlines an agent mention", () => {
    const text = "ask @bob about it"
    const parts = [
      { id: "text_1", type: "text", text, sessionID: "ses_1", messageID: "msg_1" },
      {
        id: "agent_1",
        type: "agent",
        name: "bob",
        sessionID: "ses_1",
        messageID: "msg_1",
        source: { value: "@bob", start: 4, end: 8 },
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ type: "text", content: "ask " })
    expect(result[1]).toMatchObject({ type: "agent", name: "bob", content: "@bob" })
    expect(result[2]).toMatchObject({ type: "text", content: " about it" })
  })

  test("recovers when source offsets are wrong by searching the text", () => {
    const text = "look at @src/foo.ts please"
    const parts = [
      { id: "text_1", type: "text", text, sessionID: "ses_1", messageID: "msg_1" },
      {
        id: "file_1",
        type: "file",
        mime: "text/plain",
        url: "file:///abs/src/foo.ts",
        filename: "foo.ts",
        sessionID: "ses_1",
        messageID: "msg_1",
        // start/end deliberately wrong
        source: {
          type: "file",
          path: "/abs/src/foo.ts",
          text: { value: "@src/foo.ts", start: 999, end: 1010 },
        },
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)
    const fileNode = result.find((p) => p.type === "file") as { type: "file"; content: string }
    expect(fileNode.content).toBe("@src/foo.ts")
  })

  test("picks the longest non-synthetic, non-ignored text part", () => {
    const parts = [
      { id: "text_short", type: "text", text: "hi", sessionID: "ses_1", messageID: "msg_1" },
      { id: "text_long", type: "text", text: "this is the longer one", sessionID: "ses_1", messageID: "msg_1" },
      { id: "text_synth", type: "text", text: "synthetic noise that is even longer", synthetic: true, sessionID: "ses_1", messageID: "msg_1" },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)
    expect(result).toEqual([{ type: "text", content: "this is the longer one", start: 0, end: 22 }])
  })
})
