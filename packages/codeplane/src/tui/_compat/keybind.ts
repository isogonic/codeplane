// TUI-local namespace barrel for keybind. Lives here so we don't have to
// modify the core util/keybind.ts to expose a `Keybind` namespace.
import * as KeybindImpl from "@/util/keybind"

export const Keybind = {
  match: KeybindImpl.match,
  fromParsedKey: KeybindImpl.fromParsedKey,
  toString: KeybindImpl.toString,
  parse: KeybindImpl.parse,
} as const

export namespace Keybind {
  export type Info = KeybindImpl.Info
}
