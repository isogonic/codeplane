// Shared header parsing/serialization for the TUI and Desktop instance forms.
// Accepts both newline-separated and `;`-separated input so existing data
// from either UI keeps working. Each entry is `Name: Value`.

export function parseHeaders(raw: string): Record<string, string> {
  if (!raw) return {}
  const out: Record<string, string> = {}
  // Split on either newline or semicolon — common cross-UI formats.
  const lines = raw.split(/[\r\n;]+/g)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(":")
    if (idx === -1) continue
    const name = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (!name || !value) continue
    out[name] = value
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
