import { describe, expect, test } from "bun:test"
import { marked, type Token } from "marked"
import { createIncrementalLexer, lastStableBoundary } from "../../src/tui/util/markdown-incremental"

// Rendered output only cares about non-space block tokens and their text, so
// compare a signature of those rather than full token identity.
function sig(tokens: Token[]): string {
  return tokens
    .filter((t) => t.type !== "space")
    .map((t) => `${t.type}#${((t as { text?: string }).text ?? (t as { raw?: string }).raw ?? "").length}`)
    .join("|")
}

function fullLex(text: string): Token[] {
  return marked.lexer(text, { gfm: true })
}

const shapes: Record<string, string> = {
  prose: "First paragraph here.\n\nSecond with **bold** and *italic* and `inline`.\n\nThird one.\n",
  headings: "# Title\n\nIntro.\n\n## Section\n\nText.\n\n### Sub\n\n- a\n- b\n- c\n",
  codeMix:
    "Explanation.\n\n```ts\nconst x = 1\nfunction f(){ return x }\n```\n\nAfter code.\n\n```py\nprint('hi')\n```\n\nEnd.\n",
  table: "Here:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nDone.\n",
  nestedList: "List:\n\n1. one\n   - nested\n   - nested2\n2. two\n\n> a blockquote\n> line two\n\nfin.\n",
  unclosedFenceTail: "Intro.\n\n```ts\nconst y = 2\nconst z = 3\n",
  blankInsideFence: "Pre.\n\n```ts\nline1\n\nline2 after blank inside fence\n```\n\nPost.\n",
  tildeFence: "Pre.\n\n~~~js\nconsole.log(1)\n~~~\n\nPost.\n",
  // A ~~~ block whose CONTENT contains ``` lines and a blank line — must not be
  // split at the inner blank line (the ``` is content, the ~~~ is still open).
  tildeBlockWithBacktickContent: "Doc:\n\n~~~md\n```ts\nconst x = 1\n```\n\nmore inside\n~~~\n\nAfter.\n",
  // A ``` block whose content contains ~~~ lines and a blank line.
  backtickBlockWithTildeContent: "Doc:\n\n```md\n~~~ts\nconst y = 2\n~~~\n\nmore inside\n```\n\nAfter.\n",
  // Loose lists, indented code, blockquotes, nested lists — blank lines INSIDE
  // these are continuations, not block boundaries, so must not be split.
  looseList: "List:\n\n- item one\n\n- item two\n\n- item three\n\nAfter.\n",
  indentedCode: "Code:\n\n    line1\n\n    line2\n\n    line3\n\nAfter.\n",
  blockquoteMultiline: "Q:\n\n> line one\n\n> line two\n\nAfter.\n",
  nestedLooseList: "X:\n\n1. first\n\n   nested para in item\n\n2. second\n\nDone.\n",
  nestedBulletList: "- top\n\n  - sub a\n\n  - sub b\n\nafter\n",
  orderedParenList: "a\n\n1) one\n2) two\n\nb\n",
  listThenIndentedCode: "- a\n- b\n\n    indented code\n\npara\n",
  thematicBreak: "a\n\n---\n\nb\n",
  realisticAnswer:
    "Here's the plan:\n\n## Steps\n\n1. Read the file\n2. Edit it\n\nThen run:\n\n```bash\nbun test\n```\n\nThat verifies it. **bold** and `code` and [link](http://x).\n\n- alpha\n- beta\n\nDone.\n",
}

describe("incremental markdown lexer", () => {
  for (const [name, full] of Object.entries(shapes)) {
    test(`matches full lex at every streaming step: ${name}`, () => {
      const lex = createIncrementalLexer()
      for (let i = 1; i <= full.length; i++) {
        const partial = full.slice(0, i).trim()
        expect(sig(lex(partial))).toBe(sig(fullLex(partial)))
      }
    })
  }

  test("falls back to full lex when link-reference definitions are present", () => {
    const text = "See [the docs][d] for details.\n\n[d]: https://example.com\n"
    const lex = createIncrementalLexer()
    expect(sig(lex(text))).toBe(sig(fullLex(text)))
  })

  test("drops cache and stays correct when text is replaced (message switch)", () => {
    const lex = createIncrementalLexer()
    const a = "# Message A\n\nAlpha paragraph.\n\nMore alpha.\n"
    const b = "Totally different **B** content.\n\n```ts\nconst z = 9\n```\n"
    // stream A fully to populate the prefix cache
    for (let i = 1; i <= a.length; i++) lex(a.slice(0, i).trim())
    // now the same component renders an unrelated message B
    for (let i = 1; i <= b.length; i++) {
      const partial = b.slice(0, i).trim()
      expect(sig(lex(partial))).toBe(sig(fullLex(partial)))
    }
  })

  // The util must be correct even without the caller's `.trim()` — a trailing
  // newline must never freeze the growing tail as a stable block.
  for (const [name, full] of Object.entries(shapes)) {
    test(`matches full lex at every RAW (untrimmed) streaming step: ${name}`, () => {
      const lex = createIncrementalLexer()
      for (let i = 1; i <= full.length; i++) {
        const partial = full.slice(0, i)
        expect(sig(lex(partial))).toBe(sig(fullLex(partial)))
      }
    })
  }

  test("trailing newline is not treated as a block boundary", () => {
    // "A line.\n" then "A line.\nA" must stay one paragraph, not split.
    const lex = createIncrementalLexer()
    expect(sig(lex("A line.\n"))).toBe(sig(fullLex("A line.\n")))
    expect(sig(lex("A line.\nA"))).toBe(sig(fullLex("A line.\nA")))
    expect(lastStableBoundary("A line.\n")).toBe(0)
  })

  test("lastStableBoundary never lands inside an open code fence", () => {
    const text = "Intro.\n\n```ts\nconst y = 2\n\nconst z = 3\n"
    const b = lastStableBoundary(text)
    // boundary must be at or before the fence opener, never inside it
    expect(b).toBeLessThanOrEqual(text.indexOf("```"))
  })
})
