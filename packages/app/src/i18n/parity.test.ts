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

const dictionaries: Record<string, typeof en> = { ar, br, bs, da, de, en, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht }
const enKeys = Object.keys(en) as Array<keyof typeof en>

function tokens(value: string) {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
}

describe("app locale dictionaries", () => {
  test("en remains the source of truth", () => {
    expect(enKeys.length).toBeGreaterThan(400)
  })

  for (const [locale, dict] of Object.entries(dictionaries)) {
    test(`${locale} covers every app translation key`, () => {
      expect(Object.keys(dict)).toEqual(enKeys)
    })

    test(`${locale} values stay string-typed and non-empty`, () => {
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value).toBe("string")
        expect(value.length).toBeGreaterThan(0)
        expect(key.length).toBeGreaterThan(0)
      }
    })

    if (locale !== "en") {
      test(`${locale} preserves interpolation tokens`, () => {
        for (const key of enKeys) {
          expect(tokens(dict[key])).toEqual(tokens(en[key]))
        }
      })
    }
  }
})
