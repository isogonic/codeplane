import open from "open"

// Open a URL in the user's default browser. Returns true on best-effort
// success — `open` resolves once the browser process is spawned, which is as
// close to a guarantee as we get without polling for window focus.
export async function openSystemBrowser(url: string): Promise<boolean> {
  try {
    await open(url)
    return true
  } catch {
    return false
  }
}

// Heuristically convert whatever the user pasted into one or more
// `Name: Value` header lines that the existing instance store already
// understands. Accepts:
//   • "name: value" / "name=value"           → as-is (or wrapped in Cookie)
//   • "Cookie: a=1; b=2"                     → kept as one Cookie line
//   • "Bearer eyJ..." / "Authorization: ..." → Authorization header
//   • bare cookie pairs like "CF_Authorization=eyJ..."
//   • a raw JWT (`eyJ...`)                   → wrapped as Bearer
// We never round-trip through `parseHeaders`/`formatHeaders` here because
// cookie values legitimately contain `=` and `;` and we don't want to mangle
// them. The output is plain text we hand back to the form's `headers` field.
export function normalizeAuthInput(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined

  // Already a header line (or several) — keep as-is. Detect by looking for a
  // `:` that comes before any `=`, since cookie values contain `=` but not
  // typically a leading `:` before the value separator.
  const colonIdx = trimmed.indexOf(":")
  const equalsIdx = trimmed.indexOf("=")
  const looksLikeHeaderLine = colonIdx > 0 && (equalsIdx === -1 || colonIdx < equalsIdx)
  if (looksLikeHeaderLine) {
    const name = trimmed.slice(0, colonIdx).trim()
    if (/^[a-z][a-z0-9-]*$/i.test(name)) return trimmed
  }

  // Bearer / Basic / Token prefixes → Authorization header
  if (/^(bearer|basic|token)\s+\S/i.test(trimmed)) {
    return `Authorization: ${trimmed}`
  }

  // A raw JWT (3 dot-separated base64url segments) → Authorization Bearer
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
    return `Authorization: Bearer ${trimmed}`
  }

  // `name=value` (or several `;`-separated pairs) → Cookie header
  if (equalsIdx > 0) return `Cookie: ${trimmed}`

  // Last resort: assume it's the value of a Cookie header
  return `Cookie: ${trimmed}`
}
