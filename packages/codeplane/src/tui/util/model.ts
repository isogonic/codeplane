import type { Provider } from "@/tui/_compat/sdk-v2"

// Strip emoji and other grapheme-clustered pictographs from a string meant to
// render on a single TUI text row.
//
// The OpenTUI cell grid measures text by code point, but the terminal renders
// emoji (regional-indicator flags like 🇹🇭, ZWJ sequences, variation-selector
// glyphs, and pictographs) with widths that don't match — a flag is two
// regional-indicator code points the layout counts as width 2, yet many
// terminals draw it as a single wide cell. That mismatch shifts every cell
// after it and bleeds the row into the column to its right (e.g. the session
// sidebar). Provider model display names can carry such emoji (e.g.
// "🇹🇭Step 3.7 Flash"), so we drop them before rendering inline metadata.
export function sanitizeInline(input: string): string {
  return (
    input
      // Regional indicator pairs (flags), pictographs / symbols / dingbats.
      .replace(/[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, "")
      // Skin-tone modifiers, the ZWJ that glues emoji sequences together, and
      // variation selectors (e.g. U+FE0F forcing emoji presentation). Kept in
      // their own replace so the ranges above stay a plain, lint-clean class.
      .replace(/\u{200D}/gu, "")
      .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
      .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
      // Collapse whitespace left behind and trim.
      .replace(/\s{2,}/g, " ")
      .trim()
  )
}

export function index(list: Provider[] | undefined) {
  return new Map((list ?? []).map((item) => [item.id, item] as const))
}

export function get(list: Provider[] | ReadonlyMap<string, Provider> | undefined, providerID: string, modelID: string) {
  const provider =
    list instanceof Map
      ? list.get(providerID)
      : Array.isArray(list)
        ? list.find((item) => item.id === providerID)
        : undefined
  return provider?.models[modelID]
}

export function name(
  list: Provider[] | ReadonlyMap<string, Provider> | undefined,
  providerID: string,
  modelID: string,
) {
  return get(list, providerID, modelID)?.name ?? modelID
}

// Like `name`, but stripped of emoji for safe single-row TUI rendering. Use
// this for inline metadata (e.g. the assistant turn footer); use `name` for
// plain-text exports where emoji should be preserved.
export function displayName(
  list: Provider[] | ReadonlyMap<string, Provider> | undefined,
  providerID: string,
  modelID: string,
) {
  return sanitizeInline(name(list, providerID, modelID))
}
