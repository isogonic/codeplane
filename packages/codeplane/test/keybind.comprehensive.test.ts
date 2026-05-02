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

describe("Keybind.toString - basic", () => {
  test("undefined returns empty", () => expect(Keybind.toString(undefined)).toBe(""))
  test("name only", () => expect(Keybind.toString(make({ name: "a" }))).toBe("a"))
  test("ctrl modifier", () =>
    expect(Keybind.toString(make({ ctrl: true, name: "x" }))).toBe("ctrl+x"))
  test("alt modifier", () =>
    expect(Keybind.toString(make({ meta: true, name: "x" }))).toBe("alt+x"))
  test("shift modifier", () =>
    expect(Keybind.toString(make({ shift: true, name: "x" }))).toBe("shift+x"))
  test("super modifier", () =>
    expect(Keybind.toString(make({ super: true, name: "x" }))).toBe("super+x"))
  test("leader prefix", () =>
    expect(Keybind.toString(make({ leader: true, name: "f" }))).toBe("<leader> f"))
  test("ctrl + alt", () =>
    expect(Keybind.toString(make({ ctrl: true, meta: true, name: "x" }))).toBe("ctrl+alt+x"))
  test("ctrl + shift", () =>
    expect(Keybind.toString(make({ ctrl: true, shift: true, name: "x" }))).toBe("ctrl+shift+x"))
  test("alt + shift", () =>
    expect(Keybind.toString(make({ meta: true, shift: true, name: "x" }))).toBe("alt+shift+x"))
  test("ctrl + alt + shift", () =>
    expect(Keybind.toString(make({ ctrl: true, meta: true, shift: true, name: "x" }))).toBe(
      "ctrl+alt+shift+x",
    ))
  test("leader + ctrl", () =>
    expect(Keybind.toString(make({ leader: true, ctrl: true, name: "x" }))).toBe(
      "<leader> ctrl+x",
    ))
  test("delete becomes del", () =>
    expect(Keybind.toString(make({ name: "delete" }))).toBe("del"))
  test("function keys passed through", () =>
    expect(Keybind.toString(make({ name: "f5" }))).toBe("f5"))
  test("only leader (no key)", () =>
    expect(Keybind.toString(make({ leader: true }))).toBe("<leader>"))
  test("only ctrl (no key)", () =>
    expect(Keybind.toString(make({ ctrl: true }))).toBe("ctrl"))
  test("space character", () =>
    expect(Keybind.toString(make({ name: "space" }))).toBe("space"))
  test("special key escape", () =>
    expect(Keybind.toString(make({ name: "escape" }))).toBe("escape"))
  test("page up", () => expect(Keybind.toString(make({ name: "pgup" }))).toBe("pgup"))
  test("page down", () => expect(Keybind.toString(make({ name: "pgdown" }))).toBe("pgdown"))
  test("home key", () => expect(Keybind.toString(make({ name: "home" }))).toBe("home"))
  test("end key", () => expect(Keybind.toString(make({ name: "end" }))).toBe("end"))
  test("tab key", () => expect(Keybind.toString(make({ name: "tab" }))).toBe("tab"))
  test("return key", () => expect(Keybind.toString(make({ name: "return" }))).toBe("return"))
  test("backspace", () =>
    expect(Keybind.toString(make({ name: "backspace" }))).toBe("backspace"))
})

describe("Keybind.parse - basic", () => {
  test("none returns empty array", () => expect(Keybind.parse("none")).toEqual([]))
  test("plain key", () =>
    expect(Keybind.parse("a")).toEqual([
      { ctrl: false, meta: false, shift: false, leader: false, name: "a" },
    ]))
  test("ctrl modifier", () =>
    expect(Keybind.parse("ctrl+x")).toEqual([
      { ctrl: true, meta: false, shift: false, leader: false, name: "x" },
    ]))
  test("alt modifier", () =>
    expect(Keybind.parse("alt+x")).toEqual([
      { ctrl: false, meta: true, shift: false, leader: false, name: "x" },
    ]))
  test("option modifier maps to meta", () =>
    expect(Keybind.parse("option+x")).toEqual([
      { ctrl: false, meta: true, shift: false, leader: false, name: "x" },
    ]))
  test("meta literal maps to meta", () =>
    expect(Keybind.parse("meta+x")).toEqual([
      { ctrl: false, meta: true, shift: false, leader: false, name: "x" },
    ]))
  test("super modifier", () =>
    expect(Keybind.parse("super+x")).toEqual([
      { ctrl: false, meta: false, shift: false, leader: false, super: true, name: "x" },
    ]))
  test("shift modifier", () =>
    expect(Keybind.parse("shift+x")).toEqual([
      { ctrl: false, meta: false, shift: true, leader: false, name: "x" },
    ]))
  test("esc maps to escape", () =>
    expect(Keybind.parse("esc")[0]?.name).toBe("escape"))
  test("leader prefix syntax", () =>
    expect(Keybind.parse("<leader>f")[0]?.leader).toBe(true))
  test("multi binding by comma", () => {
    const result = Keybind.parse("a,b,c")
    expect(result).toHaveLength(3)
  })
  test("ctrl + shift combo", () =>
    expect(Keybind.parse("ctrl+shift+x")).toEqual([
      { ctrl: true, meta: false, shift: true, leader: false, name: "x" },
    ]))
  test("complex combo", () =>
    expect(Keybind.parse("<leader>ctrl+alt+shift+a")[0]).toMatchObject({
      ctrl: true,
      meta: true,
      shift: true,
      leader: true,
      name: "a",
    }))
  test("case insensitive", () =>
    expect(Keybind.parse("CTRL+X")[0]?.ctrl).toBe(true))
  test("mixed case modifiers", () =>
    expect(Keybind.parse("Ctrl+Shift+a")[0]?.shift).toBe(true))
  test("fn keys", () => expect(Keybind.parse("f1")[0]?.name).toBe("f1"))
  test("digit key", () => expect(Keybind.parse("0")[0]?.name).toBe("0"))
  test("number combo", () => expect(Keybind.parse("ctrl+1")[0]?.name).toBe("1"))
})

describe("Keybind.match", () => {
  test("undefined returns false", () =>
    expect(Keybind.match(undefined, make({ name: "x" }))).toBe(false))
  test("equal infos match", () =>
    expect(Keybind.match(make({ name: "x" }), make({ name: "x" }))).toBe(true))
  test("different names do not match", () =>
    expect(Keybind.match(make({ name: "x" }), make({ name: "y" }))).toBe(false))
  test("different ctrl does not match", () =>
    expect(
      Keybind.match(make({ name: "x", ctrl: true }), make({ name: "x", ctrl: false })),
    ).toBe(false))
  test("super defaults to false in match", () => {
    const a = make({ name: "x" })
    const b = { ...make({ name: "x" }), super: false }
    expect(Keybind.match(a, b)).toBe(true)
  })
  test("super: true on both matches", () => {
    const a = { ...make({ name: "x" }), super: true }
    const b = { ...make({ name: "x" }), super: true }
    expect(Keybind.match(a, b)).toBe(true)
  })
  test("super: true vs false", () => {
    const a = { ...make({ name: "x" }), super: true }
    const b = { ...make({ name: "x" }), super: false }
    expect(Keybind.match(a, b)).toBe(false)
  })
})

describe("Keybind.fromParsedKey", () => {
  test("space mapped to space name", () => {
    const result = Keybind.fromParsedKey({ ctrl: false, meta: false, shift: false, name: " " })
    expect(result.name).toBe("space")
  })
  test("preserves modifiers", () => {
    const result = Keybind.fromParsedKey({ ctrl: true, meta: false, shift: true, name: "x" })
    expect(result.ctrl).toBe(true)
    expect(result.shift).toBe(true)
  })
  test("default super to false", () => {
    const result = Keybind.fromParsedKey({ ctrl: false, meta: false, shift: false, name: "x" })
    expect(result.super).toBe(false)
  })
  test("propagates super when set", () => {
    const result = Keybind.fromParsedKey({
      ctrl: false,
      meta: false,
      shift: false,
      super: true,
      name: "x",
    })
    expect(result.super).toBe(true)
  })
  test("default leader is false", () => {
    const result = Keybind.fromParsedKey({ ctrl: false, meta: false, shift: false, name: "x" })
    expect(result.leader).toBe(false)
  })
  test("can set leader true", () => {
    const result = Keybind.fromParsedKey(
      { ctrl: false, meta: false, shift: false, name: "x" },
      true,
    )
    expect(result.leader).toBe(true)
  })
})

describe("Keybind.toString and parse roundtrip", () => {
  const cases = ["a", "ctrl+a", "ctrl+shift+a", "alt+f", "shift+return", "f1", "f12", "esc"]
  for (const value of cases) {
    test(`roundtrip "${value}"`, () => {
      const parsed = Keybind.parse(value)[0]!
      const stringified = Keybind.toString(parsed)
      const reparsed = Keybind.parse(stringified)[0]!
      expect(reparsed).toEqual(parsed)
    })
  }
})

describe("Keybind.toString - edge cases", () => {
  test("super and ctrl combined", () =>
    expect(Keybind.toString(make({ ctrl: true, super: true, name: "x" }))).toBe(
      "ctrl+super+x",
    ))
  test("all modifiers + leader", () =>
    expect(
      Keybind.toString(
        make({ ctrl: true, meta: true, super: true, shift: true, leader: true, name: "z" }),
      ),
    ).toBe("<leader> ctrl+alt+super+shift+z"))
  test("empty name", () =>
    expect(Keybind.toString(make({ ctrl: true, name: "" }))).toBe("ctrl"))
  for (let i = 0; i < 30; i++) {
    test(`bulk string roundtrip #${i}`, () => {
      const info = make({ ctrl: i % 2 === 0, name: `key${i}` })
      const result = Keybind.toString(info)
      expect(result).toContain(`key${i}`)
    })
  }
})

describe("Keybind.parse - edge cases", () => {
  test("leader only via marker", () =>
    expect(Keybind.parse("<leader>")[0]?.leader).toBe(true))
  test("leader prefix with combo", () => {
    const result = Keybind.parse("<leader>ctrl+f")[0]!
    expect(result.leader).toBe(true)
    expect(result.ctrl).toBe(true)
    expect(result.name).toBe("f")
  })
  test("multiple leader markers in input", () => {
    const result = Keybind.parse("<leader><leader>x")[0]!
    expect(result.leader).toBe(true)
  })
  test("comma-separated bindings parse independently", () => {
    const result = Keybind.parse("ctrl+a,ctrl+b")
    expect(result[0]?.name).toBe("a")
    expect(result[1]?.name).toBe("b")
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk parse #${i}`, () => {
      const result = Keybind.parse(`ctrl+${i}`)
      expect(result[0]?.ctrl).toBe(true)
      expect(result[0]?.name).toBe(String(i))
    })
  }
})
