import { describe, expect, test } from "bun:test"
import {
  detectLocaleFromEnvironment,
  detectLocaleFromNavigator,
  detectSupportedLocale,
  localeCandidatesFromEnvironment,
  localeIntl,
  normalizeSupportedLocale,
  supportedLocales,
} from "../src/locale"

describe("shared locale helpers", () => {
  test("exports the expected supported locales", () => {
    expect(supportedLocales).toEqual([
      "en",
      "zh",
      "zht",
      "ko",
      "de",
      "es",
      "fr",
      "da",
      "ja",
      "pl",
      "ru",
      "ar",
      "no",
      "br",
      "th",
      "bs",
      "tr",
    ])
  })

  test("maps locales to stable intl tags", () => {
    expect(localeIntl.zht).toBe("zh-Hant")
    expect(localeIntl.no).toBe("nb-NO")
    expect(localeIntl.br).toBe("pt-BR")
  })

  test("normalizes direct and regional locale tags", () => {
    expect(normalizeSupportedLocale("en-US")).toBe("en")
    expect(normalizeSupportedLocale("de-DE")).toBe("de")
    expect(normalizeSupportedLocale("pt-BR")).toBe("br")
    expect(normalizeSupportedLocale("nb-NO")).toBe("no")
    expect(normalizeSupportedLocale("nn_NO")).toBe("no")
    expect(normalizeSupportedLocale("zh-Hans-CN")).toBe("zh")
    expect(normalizeSupportedLocale("zh-Hant-TW")).toBe("zht")
    expect(normalizeSupportedLocale("ZH_hk")).toBe("zht")
  })

  test("falls back cleanly for unknown locales", () => {
    expect(normalizeSupportedLocale(undefined)).toBe("en")
    expect(normalizeSupportedLocale("xx-YY")).toBe("en")
    expect(normalizeSupportedLocale("xx-YY", "tr")).toBe("tr")
  })

  test("detects the first supported locale from a candidate list", () => {
    expect(detectSupportedLocale(["xx", "pt-PT", "de-DE"])).toBe("br")
    expect(detectSupportedLocale(["", undefined, "tr-TR"])).toBe("tr")
    expect(detectSupportedLocale(["", undefined], "bs")).toBe("bs")
  })

  test("detects locale from navigator-like inputs", () => {
    expect(detectLocaleFromNavigator({ languages: ["fr-CA", "en-US"] })).toBe("fr")
    expect(detectLocaleFromNavigator({ language: "ja-JP" })).toBe("ja")
    expect(detectLocaleFromNavigator(undefined, "th")).toBe("th")
  })

  test("reads environment candidates in priority order", () => {
    const env = {
      CODEPLANE_LOCALE: "tr",
      LC_ALL: "fr_FR.UTF-8",
      LC_MESSAGES: "de_DE.UTF-8",
      LANG: "es_ES.UTF-8",
    }
    expect(localeCandidatesFromEnvironment(env)).toEqual(["tr", "fr_FR.UTF-8", "de_DE.UTF-8", "es_ES.UTF-8"])
    expect(detectLocaleFromEnvironment(env)).toBe("tr")
    expect(detectLocaleFromEnvironment({ LANG: "bs_BA.UTF-8" })).toBe("bs")
    expect(detectLocaleFromEnvironment({ LANG: "zh_Hant_TW.UTF-8" })).toBe("zht")
  })
})
