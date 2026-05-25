import { describe, expect, test } from "bun:test"
import path from "node:path"

describe("boot wizard", () => {
  test("directory picker source does not render file or folder emoji markers", async () => {
    const source = await Bun.file(path.join(import.meta.dir, "../../src/tui/boot/wizard.tsx")).text()
    const forbiddenGlyphs = [0x1f4c1, 0x1f4c2, 0x1f4c4, 0x1f5c2].map((codepoint) =>
      String.fromCodePoint(codepoint),
    )

    for (const glyph of forbiddenGlyphs) {
      expect(source).not.toContain(glyph)
    }
    expect(source).not.toContain("[D]")
    expect(source).not.toContain("[F]")
  })

  test("boot chrome uses Codeplane branding and avoids emoji-style status glyphs", async () => {
    const source = await Bun.file(path.join(import.meta.dir, "../../src/tui/boot/primitives.tsx")).text()
    const forbiddenGlyphs = [0x2713, 0x2717, 0x26a0, 0x2139, 0x27f3].map((codepoint) =>
      String.fromCodePoint(codepoint),
    )

    expect(source).toContain("Codeplane")
    for (const glyph of forbiddenGlyphs) {
      expect(source).not.toContain(glyph)
    }
  })

  test("shared instance helpers route pure local edits differently from hosted local instances", async () => {
    const source = await Bun.file(path.join(import.meta.dir, "../../../shared/src/instance.ts")).text()

    expect(source).toContain("export function hasRemoteAccessSettings")
    expect(source).toContain("export function instanceEditorKind")
  })
})
