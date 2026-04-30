import { describe, expect, test } from "bun:test"
import { splitQuestionText } from "./question-text"

describe("splitQuestionText", () => {
  test("returns a single text segment when there's no URL", () => {
    const out = splitQuestionText("What's your favorite color?")
    expect(out).toEqual([{ kind: "text", value: "What's your favorite color?" }])
  })

  test("extracts a single bare URL", () => {
    const out = splitQuestionText("Open https://example.com to authenticate")
    expect(out).toEqual([
      { kind: "text", value: "Open " },
      { kind: "link", href: "https://example.com", value: "https://example.com" },
      { kind: "text", value: " to authenticate" },
    ])
  })

  test("strips trailing sentence punctuation off the end of a URL so the dot stays in the text", () => {
    const out = splitQuestionText("Visit https://example.com/auth.")
    expect(out).toEqual([
      { kind: "text", value: "Visit " },
      { kind: "link", href: "https://example.com/auth", value: "https://example.com/auth" },
      { kind: "text", value: "." },
    ])
  })

  test("handles a long OAuth URL with query params, ampersands, percent-encodes, dashes, etc.", () => {
    const url =
      "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=hvKD5mxdLO0zuUQFOcqaK0oQwohefdM13JWL6FcYarI&code_challenge_method=S256&state=-kJ9H6yjUxQfyDCj4KsVT186cxSQU45mw-gPh-jOKqk"
    const out = splitQuestionText(`Browser didn't open? Use ${url}\n\nPaste code here if prompted >`)
    // The URL must be captured verbatim — don't lose any query-string chars.
    expect(out.find((s) => s.kind === "link")).toEqual({ kind: "link", href: url, value: url })
    // And the trailing newline + prompt must remain plain text.
    expect(out[out.length - 1]).toEqual({ kind: "text", value: "\n\nPaste code here if prompted >" })
  })

  test("supports multiple URLs in the same prompt", () => {
    const out = splitQuestionText("Try https://a.example then https://b.example")
    expect(out.filter((s) => s.kind === "link").length).toBe(2)
    expect(out.filter((s) => s.kind === "link").map((s) => s.href)).toEqual([
      "https://a.example",
      "https://b.example",
    ])
  })

  test("does not match plain http://-less domains (avoid false positives in shell paths)", () => {
    const out = splitQuestionText("Run cp /etc/hosts /tmp/backup")
    expect(out).toEqual([{ kind: "text", value: "Run cp /etc/hosts /tmp/backup" }])
  })

  test("does not crash on undefined / empty input", () => {
    expect(splitQuestionText(undefined)).toEqual([])
    expect(splitQuestionText("")).toEqual([])
  })
})
