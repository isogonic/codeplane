import { describe, expect, test } from "bun:test"
import {
  disposeIfDisposable,
  getHoveredLinkText,
  getSpeechRecognitionCtor,
  hasSetOption,
  isDisposable,
  setOptionIfSupported,
} from "../../src/utils/runtime-adapters"

describe("isDisposable", () => {
  test("returns true for object with dispose function", () => {
    expect(isDisposable({ dispose: () => {} })).toBe(true)
  })
  test("returns false when dispose is not a function", () => {
    expect(isDisposable({ dispose: "not a function" })).toBe(false)
  })
  test("returns false for null", () => expect(isDisposable(null)).toBe(false))
  test("returns false for undefined", () => expect(isDisposable(undefined)).toBe(false))
  test("returns false for primitive", () => expect(isDisposable(42)).toBe(false))
  test("returns false for empty object", () => expect(isDisposable({})).toBe(false))
  for (let i = 0; i < 30; i++) {
    test(`bulk disposable #${i}`, () => {
      expect(isDisposable({ dispose: () => i })).toBe(true)
    })
  }
})

describe("disposeIfDisposable", () => {
  test("calls dispose when present", () => {
    let called = false
    disposeIfDisposable({
      dispose: () => {
        called = true
      },
    })
    expect(called).toBe(true)
  })
  test("no-op for non-disposable", () => {
    expect(() => disposeIfDisposable({})).not.toThrow()
    expect(() => disposeIfDisposable(null)).not.toThrow()
  })
  test("does not throw on primitive", () => {
    expect(() => disposeIfDisposable(42)).not.toThrow()
  })
})

describe("hasSetOption", () => {
  test("returns true for object with setOption function", () => {
    expect(hasSetOption({ setOption: () => {} })).toBe(true)
  })
  test("returns false without setOption", () => {
    expect(hasSetOption({})).toBe(false)
  })
  test("returns false for null", () => expect(hasSetOption(null)).toBe(false))
})

describe("setOptionIfSupported", () => {
  test("calls setOption", () => {
    let last: { key: string; next: unknown } | undefined
    setOptionIfSupported(
      {
        setOption: (key: string, next: unknown) => {
          last = { key, next }
        },
      },
      "k",
      "v",
    )
    expect(last).toEqual({ key: "k", next: "v" })
  })
  test("no-op for non-supporting", () => {
    expect(() => setOptionIfSupported({}, "k", "v")).not.toThrow()
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk setOption #${i}`, () => {
      let last: unknown
      setOptionIfSupported(
        {
          setOption: (_key: string, next: unknown) => {
            last = next
          },
        },
        `key-${i}`,
        i,
      )
      expect(last).toBe(i)
    })
  }
})

describe("getHoveredLinkText", () => {
  test("returns text when present", () => {
    expect(getHoveredLinkText({ currentHoveredLink: { text: "hi" } })).toBe("hi")
  })
  test("returns undefined when no current link", () => {
    expect(getHoveredLinkText({})).toBeUndefined()
  })
  test("returns undefined when text is not string", () => {
    expect(getHoveredLinkText({ currentHoveredLink: { text: 42 } })).toBeUndefined()
  })
  test("returns undefined when value is null", () => {
    expect(getHoveredLinkText(null)).toBeUndefined()
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk hovered #${i}`, () => {
      expect(getHoveredLinkText({ currentHoveredLink: { text: `link-${i}` } })).toBe(`link-${i}`)
    })
  }
})

describe("getSpeechRecognitionCtor", () => {
  test("returns webkit ctor", () => {
    class W {}
    const fakeWindow = { webkitSpeechRecognition: W }
    const ctor = getSpeechRecognitionCtor(fakeWindow)
    expect(ctor).toBe(W as unknown as new () => unknown)
  })
  test("returns standard ctor", () => {
    class S {}
    const fakeWindow = { SpeechRecognition: S }
    expect(getSpeechRecognitionCtor(fakeWindow)).toBe(S as unknown as new () => unknown)
  })
  test("returns undefined when not supported", () => {
    expect(getSpeechRecognitionCtor({})).toBeUndefined()
  })
  test("returns undefined for null", () => {
    expect(getSpeechRecognitionCtor(null)).toBeUndefined()
  })
})
