// Shared header parsing/serialization for the TUI and Desktop instance forms.
// Accepts both newline-separated and `;`-separated input so existing data
// from either UI keeps working. Each entry is `Name: Value`.

export function parseHeaders(raw: string): Record<string, string> {
  if (!raw) return {}
  const out: Record<string, string> = {}
  // Split on line boundaries first.
  const lines = raw.split(/[\r\n]+/g)
  for (const rawLine of lines) {
    // Within a line, split on `;` ONLY when the next segment looks like
    // the start of another header (`name:`). Without this guard, values
    // that legitimately contain `;` get silently truncated — most
    // painfully `Cookie: CF_Authorization=...; CF_AppSession=...`, where
    // every form save (or SSO sign-in round-trip through parse → format)
    // dropped every cookie pair after the first and the user's saved
    // auth "disappeared". Same shape protects Content-Type's
    // `; charset=...`, User-Agent's `(Windows NT 10.0; Win64)`, etc.
    const segments = rawLine.split(/;\s*(?=[A-Za-z][A-Za-z0-9_-]*\s*:)/g)
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
