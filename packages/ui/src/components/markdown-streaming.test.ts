import { describe, expect, test } from "bun:test"
import { selectMarkdownContent, shouldParseMarkdown } from "./markdown-streaming"

describe("markdown streaming helpers", () => {
  test("parses markdown on every delta — including while streaming — when cache misses", () => {
    expect(shouldParseMarkdown(undefined, true)).toBe(true)
    expect(shouldParseMarkdown(undefined, false)).toBe(true)
    expect(shouldParseMarkdown("<p>cached</p>", true)).toBe(false)
    expect(shouldParseMarkdown("<p>cached</p>", false)).toBe(false)
  })

  test("keeps live content visible while the final parse is still pending", () => {
    expect(
      selectMarkdownContent({
        text: "hello",
        live: "<span>hello</span>",
        parsed: "",
        streaming: false,
      }),
    ).toBe("<span>hello</span>")
  })

  test("prefers parsed markdown after streaming completes", () => {
    expect(
      selectMarkdownContent({
        text: "hello",
        live: "<span>hello</span>",
        parsed: "<p>hello</p>",
        streaming: false,
      }),
    ).toBe("<p>hello</p>")
  })

  test("always prefers the cached canonical parse for the current text", () => {
    expect(
      selectMarkdownContent({
        text: "**hi**",
        cached: "<p><strong>hi</strong></p>",
        live: "<span>**hi**</span>",
        parsed: "<p>stale</p>",
        streaming: true,
      }),
    ).toBe("<p><strong>hi</strong></p>")
    expect(
      selectMarkdownContent({
        text: "**hi**",
        cached: "<p><strong>hi</strong></p>",
        live: "<span>**hi**</span>",
        parsed: "<p>stale</p>",
        streaming: false,
      }),
    ).toBe("<p><strong>hi</strong></p>")
  })

  test("prefers live (current-text) over parsed (potentially stale) DURING streaming", () => {
    // While streaming, cached missing means the async parse hasn't completed
    // for the latest delta. `parsed` is therefore from an earlier text and
    // would visibly drop characters that the user can see being typed in.
    // `live` reflects the current text (cached head + wrapped tail), so it
    // wins.
    expect(
      selectMarkdownContent({
        text: "**hi** world",
        live: "<p><strong>hi</strong></p><span>world</span>",
        parsed: "<p><strong>hi</strong></p>",
        streaming: true,
      }),
    ).toBe("<p><strong>hi</strong></p><span>world</span>")
  })

  test("falls back to parsed during streaming when there's no live representation yet", () => {
    expect(
      selectMarkdownContent({
        text: "**hi**",
        live: undefined,
        parsed: "<p><strong>hi</strong></p>",
        streaming: true,
      }),
    ).toBe("<p><strong>hi</strong></p>")
  })

  test("falls back to live wrapped words during streaming when no parse has completed yet", () => {
    expect(
      selectMarkdownContent({
        text: "**hi**",
        live: "<span>**hi**</span>",
        parsed: "",
        streaming: true,
      }),
    ).toBe("<span>**hi**</span>")
  })
})
