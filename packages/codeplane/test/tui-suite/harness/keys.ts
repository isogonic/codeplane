import { KeyCodes, type KeyInput } from "@opentui/core/testing"

export { KeyCodes }
export type { KeyInput }

/**
 * Parse a chord string like "ctrl+a", "shift+tab", "cmd+enter" into key + modifiers.
 * Returns the raw bytes/key plus a modifier bag the renderer's mockInput accepts.
 */
export interface ParsedChord {
  key: KeyInput
  modifiers: { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean; hyper?: boolean }
}

const NAMED: Record<string, KeyInput> = {
  enter: "RETURN",
  return: "RETURN",
  tab: "TAB",
  esc: "ESCAPE",
  escape: "ESCAPE",
  backspace: "BACKSPACE",
  delete: "DELETE",
  del: "DELETE",
  home: "HOME",
  end: "END",
  up: "ARROW_UP",
  down: "ARROW_DOWN",
  left: "ARROW_LEFT",
  right: "ARROW_RIGHT",
  space: " ",
  pageup: "[5~",
  pagedown: "[6~",
  "page-up": "[5~",
  "page-down": "[6~",
}

export function parseChord(chord: string): ParsedChord {
  const parts = chord.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) throw new Error("empty chord")
  const last = parts[parts.length - 1]!
  const mods = new Set(parts.slice(0, -1))
  const modifiers: ParsedChord["modifiers"] = {}
  if (mods.has("shift")) modifiers.shift = true
  if (mods.has("ctrl") || mods.has("control")) modifiers.ctrl = true
  if (mods.has("alt") || mods.has("meta") || mods.has("opt") || mods.has("option")) modifiers.meta = true
  if (mods.has("cmd") || mods.has("super") || mods.has("win")) modifiers.super = true
  if (mods.has("hyper")) modifiers.hyper = true
  const fnKey = last.match(/^f([1-9]|1[0-2])$/)
  if (fnKey) return { key: ("F" + fnKey[1]) as KeyInput, modifiers }
  if (last in NAMED) return { key: NAMED[last] as KeyInput, modifiers }
  if (last.length === 1) return { key: last, modifiers }
  // Allow already-canonical names like "RETURN", "ARROW_UP"
  if (last.toUpperCase() in KeyCodes) return { key: last.toUpperCase() as KeyInput, modifiers }
  throw new Error(`unknown chord segment: ${last}`)
}
