import { describe, expect, test } from "bun:test"
import { makeTuiTranslator, tuiLocale } from "../../src/tui/i18n"

describe("tui i18n", () => {
  test("defaults to a supported locale", () => {
    expect(typeof tuiLocale).toBe("string")
    expect(tuiLocale.length).toBeGreaterThan(0)
  })

  test("interpolates boot strings", () => {
    const t = makeTuiTranslator("en").t
    expect(t("boot.remote.probeOk", { version: "29.0.0" })).toBe("Server reachable. Reports v29.0.0.")
    expect(t("boot.directory.showing", { start: 1, end: 14, total: 88 })).toBe("Showing 1-14 of 88")
  })

  test("falls back to english copy for supported locales without overrides", () => {
    const de = makeTuiTranslator("de").t
    const tr = makeTuiTranslator("tr").t
    expect(de("common.search")).toBe("Search")
    expect(tr("boot.local.installedBanner")).toBe("Binary installed and ready.")
  })
})
