import { marked, type Token } from "marked"

// Incremental markdown lexing for streaming render paths.
//
// During streaming a message's text grows by an append on every delta.
// Re-lexing the whole message each time is O(n^2): measured ~15s of cumulative
// CPU for a single ~18KB streamed reply, which saturates the event loop and
// produces the lag / freezes users see on long answers. Instead we cache the
// tokens of the stable prefix (everything up to the last blank-line block
// boundary that is NOT inside an open code fence) and only re-lex the growing
// tail. A blank line outside a fence is a true block boundary, so
// `lexer(prefix) ++ lexer(tail)` is identical to `lexer(prefix ++ tail)` for
// block-level tokens — the rendered output is unchanged (verified token-exact
// at every streaming step across prose, headings, tables, nested lists, and
// open/closed ``` and ~~~ fences).

// Reference-style link/footnote definitions can change how *later* blocks
// render, so splitting is unsafe when present — fall back to a full lex (rare
// in streamed assistant output). Mirrors the web client's `markdown-stream`
// `refs()` bail-out.
function hasLinkReferenceDefinitions(text: string): boolean {
  return /^\[[^\]]+\]:\s+\S+/m.test(text) || /^\[\^[^\]]+\]:\s+/m.test(text)
}

// A line that unambiguously begins a fresh top-level block we can safely split
// before. Excludes the continuations that a blank line does NOT terminate:
// indented lines (indented code, or list-item content — which can be < 4
// spaces), list markers (a blank line inside a loose list keeps the list), and
// block quotes. Splitting before any of those would fragment one rendered block
// into several.
function startsFreshBlock(line: string): boolean {
  if (line === "" || line[0] === " " || line[0] === "\t") return false
  if (/^[-*+](\s|$)/.test(line)) return false
  if (/^\d+[.)](\s|$)/.test(line)) return false
  if (line.startsWith(">")) return false
  return true
}

// Byte index just after the last blank-line separator that is a TRUE,
// stream-stable block boundary. A blank line qualifies only when, outside any
// open code fence, the next non-blank line is already COMPLETE (newline-
// terminated, so its type is settled — not a still-streaming partial like "2"
// before "2." arrives) AND `startsFreshBlock` says it begins a fresh top-level
// block. This keeps loose lists, indented code, block quotes and tables intact.
// Verified token-exact against a full `marked.lexer` at every streaming step
// (trimmed and raw) across all those constructs.
//
// Fence tracking follows CommonMark: a ``` block is only closed by a ``` line
// (>= the opening length, nothing after it) and a ~~~ block only by ~~~ — so a
// ``` block may legitimately contain ~~~ content lines and vice versa.
export function lastStableBoundary(text: string): number {
  let boundary = 0
  // Line-start offsets, so we can inspect the line AFTER a blank line.
  const offsets: number[] = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") offsets.push(i + 1)
  const lineAt = (li: number) => text.slice(offsets[li], li + 1 < offsets.length ? offsets[li + 1] - 1 : text.length)

  let fence: { char: string; len: number } | undefined
  for (let li = 0; li < offsets.length; li++) {
    const line = lineAt(li)
    const trimmed = line.trimStart()
    const marker = trimmed.match(/^(`{3,}|~{3,})/)
    if (marker) {
      const char = marker[1][0]
      const len = marker[1].length
      if (!fence) fence = { char, len }
      else if (char === fence.char && len >= fence.len && trimmed.slice(marker[1].length).trim() === "") fence = undefined
    }
    if (line.trim().length === 0 && !fence && offsets[li] > 0) {
      let nj = li + 1
      while (nj < offsets.length && lineAt(nj).trim() === "") nj++
      // nj + 1 < offsets.length ⇒ line nj is newline-terminated (complete).
      if (nj < offsets.length && nj + 1 < offsets.length && startsFreshBlock(lineAt(nj))) {
        boundary = offsets[li + 1]
      }
    }
  }
  return boundary
}

// Returns a stateful lexer. Call it with the current (growing) text on each
// render; it returns the full token list but only re-lexes the unstable tail.
// Safe under non-append changes (message switch, snapshot reconcile, edit):
// the cache is dropped whenever the new text doesn't extend the cached prefix.
export function createIncrementalLexer() {
  let prefix = ""
  let prefixTokens: Token[] = []
  const lex = (s: string) => marked.lexer(s, { gfm: true })
  return (text: string): Token[] => {
    if (hasLinkReferenceDefinitions(text)) return lex(text)
    if (!text.startsWith(prefix)) {
      prefix = ""
      prefixTokens = []
    }
    const boundary = lastStableBoundary(text)
    if (boundary > prefix.length) {
      // Lex only the newly-stabilised segment and append once, so every block
      // is lexed exactly once across the whole stream.
      prefixTokens = prefixTokens.concat(lex(text.slice(prefix.length, boundary)))
      prefix = text.slice(0, boundary)
    }
    const tail = text.slice(prefix.length)
    return tail.length ? prefixTokens.concat(lex(tail)) : prefixTokens.slice()
  }
}
