// Coerce an arbitrary value into a string that is safe to render as a child of
// an opentui `<text>` element.
//
// Tool `state.input` / `state.metadata` and message `error.data` are typed
// `unknown` and can hold raw, partially-streamed, or model-supplied JSON whose
// fields are objects/arrays — not always the strings the renderer assumes. When
// a non-string / non-StyledText child is mounted into a `<text>`, opentui's
// `TextNodeRenderable.add()` throws:
//
//   "TextNodeRenderable only accepts strings, TextNodeRenderable instances, or
//    StyledText instances"
//
// which crashed the entire TUI when switching into a session that contained
// such a part. `textValue` guarantees a string is always returned.
export function textValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

export * as TextValue from "./text-value"
