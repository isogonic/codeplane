import { describe, expect, test } from "bun:test"
import { createBootPaletteFromTerminal } from "../../src/tui/boot/primitives"

function rgbaInts(input: { r: number; g: number; b: number; a: number }) {
  return [
    Math.round(input.r * 255),
    Math.round(input.g * 255),
    Math.round(input.b * 255),
    Math.round(input.a * 255),
  ]
}

describe("boot primitives", () => {
  test("derive a transparent boot background from the terminal palette instead of forcing black", () => {
    const terminal = {
      defaultBackground: "#112233",
      defaultForeground: "#ddeeff",
      palette: [
        "#112233",
        "#cc6666",
        "#99cc99",
        "#f0c674",
        "#81a2be",
        "#b294bb",
        "#8abeb7",
        "#ddeeff",
      ],
      cursorColor: "#ddeeff",
      mouseForeground: "#ddeeff",
      mouseBackground: "#112233",
      highlightForeground: "#112233",
      highlightBackground: "#ddeeff",
      tekForeground: "#ddeeff",
      tekBackground: "#112233",
    } satisfies Parameters<typeof createBootPaletteFromTerminal>[0]
    const palette = createBootPaletteFromTerminal(
      terminal,
      "dark",
    )

    expect(rgbaInts(palette.bg)).toEqual([17, 34, 51, 0])
    expect(rgbaInts(palette.fg)).toEqual([221, 238, 255, 255])
    expect(rgbaInts(palette.info)).toEqual([138, 190, 183, 255])
    expect(rgbaInts(palette.success)).toEqual([153, 204, 153, 255])
  })

  test("keeps light terminal themes light instead of falling back to an opaque dark shell", () => {
    const terminal = {
      defaultBackground: "#fdf6e3",
      defaultForeground: "#586e75",
      palette: [
        "#073642",
        "#dc322f",
        "#859900",
        "#b58900",
        "#268bd2",
        "#d33682",
        "#2aa198",
        "#eee8d5",
      ],
      cursorColor: "#586e75",
      mouseForeground: "#586e75",
      mouseBackground: "#fdf6e3",
      highlightForeground: "#fdf6e3",
      highlightBackground: "#586e75",
      tekForeground: "#586e75",
      tekBackground: "#fdf6e3",
    } satisfies Parameters<typeof createBootPaletteFromTerminal>[0]
    const palette = createBootPaletteFromTerminal(
      terminal,
      "light",
    )

    expect(rgbaInts(palette.bg)).toEqual([253, 246, 227, 0])
    expect(rgbaInts(palette.accent)).toEqual([42, 161, 152, 255])
    expect(rgbaInts(palette.surfaceStrong)[0]).toBeGreaterThan(180)
    expect(rgbaInts(palette.fgDim)[0]).toBeLessThan(rgbaInts(palette.bg)[0])
  })
})
