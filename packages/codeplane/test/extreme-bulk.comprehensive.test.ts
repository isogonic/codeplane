import { describe, expect, test } from "bun:test"
import { Color, Keybind, Locale, Token, Wildcard } from "../src/util"
import { decodeDataUrl } from "../src/util/data-url"
import { lazy } from "../src/util/lazy"
import { iife } from "../src/util/iife"
import { isRecord } from "../src/util/record"
import { signal } from "../src/util/signal"
import { withTimeout } from "../src/util/timeout"
import { abortAfter } from "../src/util/abort"
import { errorMessage } from "../src/util/error"

const make = (overrides: Partial<Keybind.Info> = {}): Keybind.Info => ({
  ctrl: false,
  meta: false,
  shift: false,
  leader: false,
  name: "",
  ...overrides,
})

describe("EXTREME-CP - Keybind for every alphanumeric", () => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")
  for (const ch of chars) {
    test(`plain ${ch}`, () => expect(Keybind.toString(make({ name: ch }))).toBe(ch))
    test(`ctrl+${ch}`, () =>
      expect(Keybind.toString(make({ ctrl: true, name: ch }))).toBe(`ctrl+${ch}`))
    test(`alt+${ch}`, () =>
      expect(Keybind.toString(make({ meta: true, name: ch }))).toBe(`alt+${ch}`))
    test(`shift+${ch}`, () =>
      expect(Keybind.toString(make({ shift: true, name: ch }))).toBe(`shift+${ch}`))
  }
})

describe("EXTREME-CP - Wildcard match every basic case", () => {
  for (let i = 0; i < 200; i++) {
    test(`exact #${i}`, () => expect(Wildcard.match(`v${i}`, `v${i}`)).toBe(true))
    test(`star matches v${i}`, () => expect(Wildcard.match(`v${i}`, "*")).toBe(true))
    test(`prefix v* matches v${i}`, () => expect(Wildcard.match(`v${i}`, "v*")).toBe(true))
  }
})

describe("EXTREME-CP - Locale.titlecase 200 words", () => {
  for (let i = 0; i < 200; i++) {
    test(`word ${i}`, () => expect(Locale.titlecase(`word${i}`)).toBe(`Word${i}`))
  }
})

describe("EXTREME-CP - Locale.number ranges", () => {
  for (let i = 0; i < 1000; i++) {
    test(`number ${i}`, () => expect(Locale.number(i)).toBe(String(i)))
  }
})

describe("EXTREME-CP - Locale.duration ms", () => {
  for (let ms = 0; ms < 999; ms++) {
    test(`ms ${ms}`, () => expect(Locale.duration(ms)).toBe(`${ms}ms`))
  }
})

describe("EXTREME-CP - Locale.truncate", () => {
  for (let n = 2; n <= 80; n++) {
    test(`truncate ${n}`, () => expect(Locale.truncate("a".repeat(100), n).length).toBe(n))
  }
})

describe("EXTREME-CP - Locale.pluralize", () => {
  for (let i = 0; i < 200; i++) {
    test(`pluralize ${i}`, () => {
      const result = Locale.pluralize(i, "{} a", "{} as")
      expect(result).toContain(String(i))
    })
  }
})

describe("EXTREME-CP - Color hex 256 values", () => {
  for (let i = 0; i < 256; i++) {
    const v = i.toString(16).padStart(2, "0")
    test(`valid hex #${v}${v}${v}`, () =>
      expect(Color.isValidHex(`#${v}${v}${v}`)).toBe(true))
    test(`hexToRgb ${v}`, () =>
      expect(Color.hexToRgb(`#${v}${v}${v}`)).toEqual({ r: i, g: i, b: i }))
  }
})

describe("EXTREME-CP - Token.estimate", () => {
  for (let i = 0; i < 200; i++) {
    test(`tokens length ${i}`, () => {
      const v = "x".repeat(i)
      expect(Token.estimate(v)).toBe(Math.max(0, Math.round(i / 4)))
    })
  }
})

describe("EXTREME-CP - decodeDataUrl plain", () => {
  for (let i = 0; i < 200; i++) {
    test(`decode plain ${i}`, () =>
      expect(decodeDataUrl(`data:text/plain,value-${i}`)).toBe(`value-${i}`))
  }
})

describe("EXTREME-CP - lazy", () => {
  for (let i = 0; i < 200; i++) {
    test(`lazy memo ${i}`, () => {
      let calls = 0
      const fn = lazy(() => {
        calls++
        return i
      })
      fn()
      fn()
      fn()
      expect(calls).toBe(1)
    })
  }
})

describe("EXTREME-CP - iife", () => {
  for (let i = 0; i < 200; i++) {
    test(`iife ${i}`, () => expect(iife(() => i)).toBe(i))
  }
})

describe("EXTREME-CP - isRecord", () => {
  for (let i = 0; i < 200; i++) {
    test(`record ${i}`, () => expect(isRecord({ k: i })).toBe(true))
    test(`primitive ${i}`, () => expect(isRecord(i)).toBe(false))
  }
})

describe("EXTREME-CP - signal", () => {
  for (let i = 0; i < 100; i++) {
    test(`signal ${i}`, async () => {
      const s = signal()
      s.trigger()
      await s.wait()
    })
  }
})

describe("EXTREME-CP - withTimeout success", () => {
  for (let i = 0; i < 100; i++) {
    test(`success ${i}`, async () => {
      expect(await withTimeout(Promise.resolve(i), 1000)).toBe(i)
    })
  }
})

describe("EXTREME-CP - abortAfter", () => {
  for (let i = 0; i < 100; i++) {
    test(`abortAfter ${i}`, () => {
      const a = abortAfter(1000)
      expect(a.signal.aborted).toBe(false)
      a.clearTimeout()
    })
  }
})

describe("EXTREME-CP - errorMessage", () => {
  for (let i = 0; i < 200; i++) {
    test(`error ${i}`, () => expect(errorMessage(new Error(`msg-${i}`))).toBe(`msg-${i}`))
  }
})
