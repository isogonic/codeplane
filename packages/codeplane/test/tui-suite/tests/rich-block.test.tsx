import { describe, expect, test } from "bun:test"
import { splitMarkdownBlocks } from "@/tui/component/rich-block"

describe("tui rich-block removal", () => {
  test("returns single markdown segment for plain text", () => {
    expect(splitMarkdownBlocks("Just some text.")).toEqual([{ kind: "markdown", text: "Just some text." }])
  })

  test("keeps recognised fenced blocks as markdown", () => {
    const md = ['```callout warning', "Heads up.", "```"].join("\n")
    expect(splitMarkdownBlocks(md)).toEqual([{ kind: "markdown", text: md }])
  })

  test("keeps mixed content in one markdown segment", () => {
    const md = [
      "Intro paragraph.",
      "",
      "```chart",
      JSON.stringify({ data: [1, 2, 3] }),
      "```",
      "",
      "Middle paragraph.",
      "",
      "```callout success",
      "Done!",
      "```",
      "",
      "Outro.",
    ].join("\n")
    const segs = splitMarkdownBlocks(md)
    expect(segs).toEqual([{ kind: "markdown", text: md }])
  })

  test("leaves unknown languages as markdown (so they syntax-highlight as code)", () => {
    const md = ["```python", "print('hello')", "```"].join("\n")
    expect(splitMarkdownBlocks(md)).toEqual([{ kind: "markdown", text: md }])
  })

  test("treats every former rich block language as plain markdown", () => {
    const langs = [
      "chart",
      "stock",
      "tabs",
      "choice",
      "select",
      "callout",
      "info",
      "tip",
      "warning",
      "danger",
      "success",
      "preview",
      "kpi",
      "video",
      "timeline",
      "progress",
      "badge",
      "quote",
      "file-tree",
      "tree",
      "image-grid",
      "gallery",
      "comparison",
      "diff",
    ]
    for (const lang of langs) {
      const md = `\`\`\`${lang}\n{}\n\`\`\``
      const segs = splitMarkdownBlocks(md)
      expect(segs).toEqual([{ kind: "markdown", text: md }])
    }
  })

  test("keeps tilde fences as markdown", () => {
    const md = ["~~~callout warning", "tilde-style", "~~~"].join("\n")
    const segs = splitMarkdownBlocks(md)
    expect(segs).toEqual([{ kind: "markdown", text: md }])
  })

  test("does not split when fence is unterminated", () => {
    const md = "Some text\n```chart\n{ unterminated"
    expect(splitMarkdownBlocks(md)).toEqual([{ kind: "markdown", text: md }])
  })
})
