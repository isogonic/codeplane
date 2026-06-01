import { describe, expect, test } from "bun:test"
import { textValue } from "@/tui/util/text-value"

// Regression coverage for the TUI crash where switching into a session that
// contained a tool part with a non-string `state.input` / `state.metadata`
// field threw, in opentui's `TextNodeRenderable.add()`:
//   "TextNodeRenderable only accepts strings, TextNodeRenderable instances, or
//    StyledText instances"
// `textValue` is the guard the session renderer uses to coerce those `unknown`
// values before they are mounted as a `<text>` child. The invariant is simple:
// it must ALWAYS return a string, regardless of input shape.
describe("textValue", () => {
  test("passes strings through unchanged", () => {
    expect(textValue("")).toBe("")
    expect(textValue("ls -la")).toBe("ls -la")
    expect(textValue("multi\nline")).toBe("multi\nline")
  })

  test("renders nullish as empty string (no-op child)", () => {
    expect(textValue(null)).toBe("")
    expect(textValue(undefined)).toBe("")
  })

  test("coerces scalar non-strings", () => {
    expect(textValue(42)).toBe("42")
    expect(textValue(0)).toBe("0")
    expect(textValue(true)).toBe("true")
    expect(textValue(false)).toBe("false")
    expect(textValue(10n)).toBe("10")
  })

  test("serializes objects and arrays instead of throwing (the crash case)", () => {
    // The exact class of value that used to crash the TUI: a tool input field
    // arriving as a partial/streamed object or array rather than a string.
    expect(textValue({ command: "ls" })).toBe('{"command":"ls"}')
    expect(textValue(["a", "b"])).toBe('["a","b"]')
    expect(textValue({ nested: { a: 1 } })).toBe('{"nested":{"a":1}}')
  })

  test("never throws and always returns a string for hostile inputs", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const cases: unknown[] = [
      circular,
      Symbol("x"),
      () => {},
      new Map([["a", 1]]),
      { toJSON() { throw new Error("boom") } },
    ]
    for (const value of cases) {
      const result = textValue(value)
      expect(typeof result).toBe("string")
    }
  })
})
