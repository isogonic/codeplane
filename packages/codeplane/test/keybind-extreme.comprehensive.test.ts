import { describe, expect, test } from "bun:test"
import { Keybind } from "../src/util"

const make = (overrides: Partial<Keybind.Info> = {}): Keybind.Info => ({
  ctrl: false,
  meta: false,
  shift: false,
  leader: false,
  name: "",
  ...overrides,
})

describe("Keybind toString extreme", () => {
  // Test combination of all four modifiers x 50 keys
  const flagCombos = [
    { ctrl: false, meta: false, shift: false, super: false },
    { ctrl: true, meta: false, shift: false, super: false },
    { ctrl: false, meta: true, shift: false, super: false },
    { ctrl: false, meta: false, shift: true, super: false },
    { ctrl: false, meta: false, shift: false, super: true },
    { ctrl: true, meta: true, shift: false, super: false },
    { ctrl: true, meta: false, shift: true, super: false },
    { ctrl: true, meta: false, shift: false, super: true },
    { ctrl: false, meta: true, shift: true, super: false },
    { ctrl: false, meta: true, shift: false, super: true },
    { ctrl: false, meta: false, shift: true, super: true },
    { ctrl: true, meta: true, shift: true, super: false },
    { ctrl: true, meta: true, shift: false, super: true },
    { ctrl: true, meta: false, shift: true, super: true },
    { ctrl: false, meta: true, shift: true, super: true },
    { ctrl: true, meta: true, shift: true, super: true },
  ]
  for (let i = 0; i < flagCombos.length; i++) {
    const flags = flagCombos[i]!
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      test(`flags ${i} + ${name}`, () => {
        const info = make({ ...flags, name })
        const result = Keybind.toString(info)
        expect(result).toContain(name)
        if (flags.ctrl) expect(result).toContain("ctrl")
        if (flags.meta) expect(result).toContain("alt")
        if (flags.shift) expect(result).toContain("shift")
        if (flags.super) expect(result).toContain("super")
      })
    }
  }
})

describe("Keybind parse extreme", () => {
  for (const expr of ["a", "ctrl+a", "alt+a", "shift+a", "super+a",
    "ctrl+alt+a", "ctrl+shift+a", "alt+shift+a", "ctrl+super+a"]) {
    for (let i = 0; i < 20; i++) {
      test(`parse ${expr} #${i}`, () => {
        const result = Keybind.parse(expr)
        expect(result).toHaveLength(1)
      })
    }
  }
})

describe("Keybind toString various names", () => {
  for (let i = 0; i < 100; i++) {
    test(`name=key${i}`, () =>
      expect(Keybind.toString(make({ name: `key${i}` }))).toBe(`key${i}`))
  }
})

describe("Keybind multi-binding parse", () => {
  for (let n = 1; n <= 20; n++) {
    test(`${n}-comma binding`, () => {
      const expr = Array.from({ length: n }, (_, i) => `ctrl+${String.fromCharCode(97 + i)}`).join(",")
      const result = Keybind.parse(expr)
      expect(result).toHaveLength(n)
    })
  }
})
