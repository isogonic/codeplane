import { describe, expect, test } from "bun:test"
import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as en } from "./en"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as th } from "./th"
import { dict as tr } from "./tr"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"

const dictionaries = { ar, br, bs, da, de, en, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht }

describe("i18n dictionary structure", () => {
  for (const [lang, dict] of Object.entries(dictionaries)) {
    test(`${lang} dict is an object`, () => {
      expect(typeof dict).toBe("object")
      expect(dict).not.toBeNull()
    })

    test(`${lang} has at least one key`, () => {
      expect(Object.keys(dict).length).toBeGreaterThan(0)
    })

    test(`${lang} all values are strings`, () => {
      for (const v of Object.values(dict)) {
        expect(typeof v).toBe("string")
      }
    })

    test(`${lang} keys are non-empty`, () => {
      for (const k of Object.keys(dict)) {
        expect(k.length).toBeGreaterThan(0)
      }
    })

    test(`${lang} values are strings (may be empty if untranslated)`, () => {
      for (const v of Object.values(dict)) {
        expect(typeof v).toBe("string")
      }
    })
  }
})

describe("i18n key consistency", () => {
  const enKeys = new Set(Object.keys(en))

  test("en is the source of truth", () => {
    expect(enKeys.size).toBeGreaterThan(0)
  })

  for (const [lang, dict] of Object.entries(dictionaries)) {
    if (lang === "en") continue
    test(`${lang} has subset of en keys`, () => {
      for (const k of Object.keys(dict)) {
        expect(enKeys.has(k)).toBe(true)
      }
    })
  }
})

describe("i18n template tokens", () => {
  test("en sessionReview title is translated", () => {
    expect(en["ui.sessionReview.title"]).toBeDefined()
  })

  test("en uses {{token}} interpolation", () => {
    const v = en["ui.sessionReview.selection.line"]
    expect(v).toContain("{{")
    expect(v).toContain("}}")
  })

  test("en kind keys exist", () => {
    expect(en["ui.fileMedia.kind.image"]).toBe("image")
    expect(en["ui.fileMedia.kind.audio"]).toBe("audio")
  })

  test("translations preserve template tokens (de)", () => {
    if (de["ui.sessionReview.selection.line"]) {
      expect(de["ui.sessionReview.selection.line"]).toContain("{{line}}")
    }
  })
})
