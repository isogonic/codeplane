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

describe("Keybind.toString - mega name variations", () => {
  const keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
    "k", "l", "m", "n", "o", "p", "q", "r", "s", "t",
    "u", "v", "w", "x", "y", "z",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
    "return", "tab", "escape", "space", "home", "end", "pgup", "pgdown",
    "up", "down", "left", "right", "backspace"]
  for (const key of keys) {
    test(`plain key "${key}"`, () =>
      expect(Keybind.toString(make({ name: key }))).toBe(key))
    test(`ctrl + "${key}"`, () =>
      expect(Keybind.toString(make({ ctrl: true, name: key }))).toBe(`ctrl+${key}`))
    test(`alt + "${key}"`, () =>
      expect(Keybind.toString(make({ meta: true, name: key }))).toBe(`alt+${key}`))
    test(`shift + "${key}"`, () =>
      expect(Keybind.toString(make({ shift: true, name: key }))).toBe(`shift+${key}`))
    test(`ctrl+shift + "${key}"`, () =>
      expect(Keybind.toString(make({ ctrl: true, shift: true, name: key }))).toBe(
        `ctrl+shift+${key}`,
      ))
    test(`leader prefix on "${key}"`, () =>
      expect(Keybind.toString(make({ leader: true, name: key }))).toBe(`<leader> ${key}`))
  }
})

describe("Keybind.parse - mega name variations", () => {
  const keys = ["a", "b", "c", "f1", "f2", "f12", "esc", "return", "tab", "space"]
  for (const key of keys) {
    test(`plain "${key}"`, () => {
      const result = Keybind.parse(key)[0]!
      expect(result.name).toBe(key === "esc" ? "escape" : key)
    })
    test(`ctrl+${key}`, () => {
      const result = Keybind.parse(`ctrl+${key}`)[0]!
      expect(result.ctrl).toBe(true)
    })
    test(`alt+${key}`, () => {
      const result = Keybind.parse(`alt+${key}`)[0]!
      expect(result.meta).toBe(true)
    })
    test(`shift+${key}`, () => {
      const result = Keybind.parse(`shift+${key}`)[0]!
      expect(result.shift).toBe(true)
    })
    test(`leader+ctrl+${key}`, () => {
      const result = Keybind.parse(`<leader>ctrl+${key}`)[0]!
      expect(result.leader).toBe(true)
      expect(result.ctrl).toBe(true)
    })
  }
})

describe("Keybind.match - mega case combinations", () => {
  const flagSets = [
    { ctrl: false, meta: false, shift: false, leader: false },
    { ctrl: true, meta: false, shift: false, leader: false },
    { ctrl: false, meta: true, shift: false, leader: false },
    { ctrl: false, meta: false, shift: true, leader: false },
    { ctrl: false, meta: false, shift: false, leader: true },
    { ctrl: true, meta: true, shift: false, leader: false },
    { ctrl: true, meta: false, shift: true, leader: false },
    { ctrl: false, meta: true, shift: true, leader: false },
    { ctrl: true, meta: true, shift: true, leader: false },
    { ctrl: true, meta: true, shift: true, leader: true },
  ]
  for (let i = 0; i < flagSets.length; i++) {
    const flags = flagSets[i]!
    for (const name of ["a", "f1", "tab", "space"]) {
      test(`flags ${i} + ${name} matches itself`, () => {
        const info = make({ ...flags, name })
        expect(Keybind.match(info, info)).toBe(true)
      })
      test(`flags ${i} + ${name} does not match different name`, () => {
        const info = make({ ...flags, name })
        const other = make({ ...flags, name: name + "x" })
        expect(Keybind.match(info, other)).toBe(false)
      })
    }
  }
})

describe("Keybind round-trip mega", () => {
  // Note: "delete" formats to "del" then parses back as "del" (one-way conversion).
  // "esc" formats as "escape" then parses back as "escape" (also one-way).
  // We exclude those and test them separately below.
  const exprs = [
    "a", "b", "c", "ctrl+a", "ctrl+b", "alt+x", "shift+a",
    "ctrl+shift+a", "ctrl+alt+a", "alt+shift+a", "ctrl+alt+shift+a",
    "f1", "f5", "f12", "tab", "space", "return",
  ]
  for (const expr of exprs) {
    for (let i = 0; i < 5; i++) {
      test(`roundtrip "${expr}" iteration ${i}`, () => {
        const parsed = Keybind.parse(expr)[0]!
        const formatted = Keybind.toString(parsed)
        const reparsed = Keybind.parse(formatted)[0]!
        expect(reparsed).toEqual(parsed)
      })
    }
  }
  test("delete formats to del", () => {
    expect(Keybind.toString(Keybind.parse("delete")[0]!)).toBe("del")
  })
  test("esc parses to escape and stays as escape", () => {
    expect(Keybind.parse("esc")[0]?.name).toBe("escape")
    expect(Keybind.toString(Keybind.parse("esc")[0]!)).toBe("escape")
  })
})
