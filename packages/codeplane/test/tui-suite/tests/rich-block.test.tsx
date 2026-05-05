import { describe, expect, test } from "bun:test"
import { splitMarkdownBlocks, _internalsForTesting } from "@/tui/component/rich-block"

const { sparklineString, formatNumber, formatCurrency, stripInline } = _internalsForTesting()

describe("tui rich-block splitter", () => {
  test("returns single markdown segment for plain text", () => {
    const segs = splitMarkdownBlocks("Just some text.")
    expect(segs.length).toBe(1)
    expect(segs[0]!.kind).toBe("markdown")
    if (segs[0]!.kind === "markdown") expect(segs[0]!.text).toContain("Just some text")
  })

  test("extracts a recognised fenced block", () => {
    const md = ['```callout warning', "Heads up.", "```"].join("\n")
    const segs = splitMarkdownBlocks(md)
    expect(segs.length).toBe(1)
    expect(segs[0]!.kind).toBe("block")
    if (segs[0]!.kind === "block") {
      expect(segs[0]!.lang).toBe("callout")
      expect(segs[0]!.code).toBe("Heads up.")
    }
  })

  test("interleaves markdown and recognised blocks in order", () => {
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
    expect(segs.length).toBe(5)
    expect(segs.map((s) => s.kind)).toEqual(["markdown", "block", "markdown", "block", "markdown"])
    if (segs[1]!.kind === "block") expect(segs[1]!.lang).toBe("chart")
    if (segs[3]!.kind === "block") expect(segs[3]!.lang).toBe("callout")
  })

  test("leaves unknown languages as markdown (so they syntax-highlight as code)", () => {
    const md = ["```python", "print('hello')", "```"].join("\n")
    const segs = splitMarkdownBlocks(md)
    expect(segs.length).toBe(1)
    expect(segs[0]!.kind).toBe("markdown")
  })

  test("recognises every supported language", () => {
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
      "table",
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
      expect(segs.length).toBe(1)
      expect(segs[0]!.kind).toBe("block")
      if (segs[0]!.kind === "block") expect(segs[0]!.lang).toBe(lang)
    }
  })

  test("handles tilde fences", () => {
    const md = ["~~~callout warning", "tilde-style", "~~~"].join("\n")
    const segs = splitMarkdownBlocks(md)
    expect(segs.length).toBe(1)
    expect(segs[0]!.kind).toBe("block")
    if (segs[0]!.kind === "block") {
      expect(segs[0]!.lang).toBe("callout")
      expect(segs[0]!.code).toBe("tilde-style")
    }
  })

  test("does not split when fence is unterminated", () => {
    const md = "Some text\n```chart\n{ unterminated"
    const segs = splitMarkdownBlocks(md)
    expect(segs.length).toBe(1)
    expect(segs[0]!.kind).toBe("markdown")
  })
})

describe("tui rich-block sparkline", () => {
  test("uses block characters", () => {
    const out = sparklineString([1, 2, 3, 4, 5, 6, 7, 8], 16)
    expect(out.length).toBeGreaterThan(0)
    for (const ch of out) expect("▁▂▃▄▅▆▇█".includes(ch)).toBe(true)
  })

  test("returns empty for empty data", () => {
    expect(sparklineString([], 16)).toBe("")
  })

  test("produces ascending sequence for ascending input", () => {
    const out = sparklineString([1, 2, 3, 4], 8)
    // First char should be the lowest, last should be the highest.
    expect("▁▂".includes(out[0]!)).toBe(true)
    expect("▇█".includes(out[out.length - 1]!)).toBe(true)
  })
})

describe("tui rich-block formatters", () => {
  test("formatNumber", () => {
    expect(formatNumber(1)).toBe("1")
    expect(formatNumber(1234)).toBe("1,234")
    expect(formatNumber(12345)).toBe("12.3k")
    expect(formatNumber(1234567)).toBe("1.2M")
    expect(formatNumber(NaN)).toBe("—")
  })

  test("formatCurrency", () => {
    const out = formatCurrency(184.92, "USD")
    expect(out).toMatch(/184/)
    expect(out).toMatch(/92/)
  })

  test("stripInline removes markdown emphasis", () => {
    expect(stripInline("**bold** and *italic* and `code`")).toBe("bold and italic and code")
    expect(stripInline("plain")).toBe("plain")
  })
})
