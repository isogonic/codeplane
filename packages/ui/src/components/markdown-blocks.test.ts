import { describe, expect, test } from "bun:test"
import { isMarkdownBlockLang, renderMarkdownBlock } from "./markdown-blocks"

describe("markdown blocks", () => {
  test("does not recognize removed custom markdown block languages", () => {
    expect(isMarkdownBlockLang("choice")).toBe(false)
    expect(isMarkdownBlockLang("chart")).toBe(false)
    expect(isMarkdownBlockLang("callout")).toBe(false)
  })

  test("falls back to plain markdown rendering", () => {
    expect(renderMarkdownBlock('{"question":"Pick one"}', "choice")).toBeNull()
    expect(renderMarkdownBlock('{"type":"line","series":[{"data":[1,2,3]}]}', "chart")).toBeNull()
  })
})
