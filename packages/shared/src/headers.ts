// Shared header parsing/serialization for the TUI and Desktop instance forms.
// Accepts both newline-separated and `;`-separated input so existing data
// from either UI keeps working. Each entry is `Name: Value`.

function hasControlCharacter(value: string) {
  return /[\r\n\0]/.test(value)
}

const HEADER_BOUNDARY = /^\s*[A-Za-z][A-Za-z0-9_-]*\s*:/

// Split a line on `;` that begins another `Name:` header. Two guards:
//   1. Only split when the next segment looks like `name:` — so values that
//      legitimately contain `;` (e.g. `Cookie: a=...; b=...`) aren't truncated.
//   2. Only split at parenthesis depth 0 — version tokens inside a value such
//      as a User-Agent's `(X11; Linux x86_64; rv:109.0)` contain `; rv:` that
//      must NOT be treated as a header boundary (doing so truncated the UA and
//      invented a bogus `rv` header).
function splitOnHeaderBoundaries(line: string): string[] {
  const segments: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === "(") depth++
    else if (ch === ")") {
      if (depth > 0) depth--
    } else if (ch === ";" && depth === 0 && HEADER_BOUNDARY.test(line.slice(i + 1))) {
      segments.push(line.slice(start, i))
      start = i + 1
    }
  }
  segments.push(line.slice(start))
  return segments
}

export function parseHeaders(raw: string): Record<string, string> {
  if (!raw) return {}
  const out: Record<string, string> = {}
  // Split on line boundaries first.
  const lines = raw.split(/[\r\n]+/g)
  for (const rawLine of lines) {
    const segments = splitOnHeaderBoundaries(rawLine)
    for (const seg of segments) {
      // Tolerate stray leading/trailing `;` so common shapes like
      // "A: 1;" or ";A: 1" don't keep the dangling delimiter.
      const trimmed = seg.trim().replace(/^;+|;+$/g, "").trim()
      if (!trimmed) continue
      const idx = trimmed.indexOf(":")
      if (idx === -1) continue
      const name = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim()
      if (!name || !value) continue
      if (hasControlCharacter(name) || hasControlCharacter(value)) continue
      out[name] = value
    }
  }
  return out
}

export function formatHeaders(
  headers: Record<string, string> | undefined,
  separator: "newline" | "semicolon" = "newline",
): string {
  if (!headers) return ""
  const join = separator === "newline" ? "\n" : "; "
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join(join)
}
