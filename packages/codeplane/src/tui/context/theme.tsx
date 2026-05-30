import { SyntaxStyle, RGBA } from "@opentui/core"
import { createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import * as Log from "@/util/log"
// Codeplane ships a single theme (oc-2) matching the Web/Desktop design.
// Only its light and dark variants are selectable; there is no theme picker.
import oc2 from "./theme/oc-2.json" with { type: "json" }
import { useKV } from "./kv"
import { useRenderer } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import { useTuiConfig } from "./tui-config"
import { isRecord } from "@/util/record"
import type { TuiThemeCurrent } from "@codeplane-ai/plugin/tui"

type Theme = TuiThemeCurrent & {
  _hasSelectedListItemText: boolean
}
type ThemeColor = Exclude<keyof TuiThemeCurrent, "thinkingOpacity">

export function selectedForeground(theme: Theme, bg?: RGBA): RGBA {
  // If theme explicitly defines selectedListItemText, use it
  if (theme._hasSelectedListItemText) {
    return theme.selectedListItemText
  }

  // For transparent backgrounds, calculate contrast based on the actual bg (or fallback to primary)
  if (theme.background.a === 0) {
    const targetColor = bg ?? theme.primary
    const { r, g, b } = targetColor
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
  }

  // Fall back to background color
  return theme.background
}

type HexColor = `#${string}`
type RefName = string
type Variant = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
type ColorValue = HexColor | RefName | Variant | RGBA
export type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Omit<Record<ThemeColor, ColorValue>, "selectedListItemText" | "backgroundMenu"> & {
    selectedListItemText?: ColorValue
    backgroundMenu?: ColorValue
    thinkingOpacity?: number
  }
}

export const DEFAULT_THEMES: Record<string, ThemeJson> = {
  "oc-2": oc2,
}

const SOFTENED_THEME_COLOR_KEYS = [
  "primary",
  "secondary",
  "accent",
  "error",
  "warning",
  "success",
  "info",
  "borderActive",
  "diffAdded",
  "diffRemoved",
  "diffContext",
  "diffHunkHeader",
  "diffHighlightAdded",
  "diffHighlightRemoved",
  "markdownHeading",
  "markdownLink",
  "markdownLinkText",
  "markdownCode",
  "markdownBlockQuote",
  "markdownEmph",
  "markdownStrong",
  "markdownListItem",
  "markdownListEnumeration",
  "markdownImage",
  "markdownImageText",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
] as const satisfies readonly ThemeColor[]

const SOFTENED_THEME_SURFACE_KEYS = [
  "diffAddedBg",
  "diffRemovedBg",
  "diffAddedLineNumberBg",
  "diffRemovedLineNumberBg",
] as const satisfies readonly ThemeColor[]

type State = {
  themes: Record<string, ThemeJson>
  mode: "dark" | "light"
  active: string
  ready: boolean
}

const pluginThemes: Record<string, ThemeJson> = {}

function listThemes() {
  // Only the bundled oc-2 theme plus anything a plugin explicitly registers.
  // The generated terminal-derived "system" theme and on-disk custom theme
  // files were removed so the only selectable palette is oc-2 (light/dark).
  return {
    ...DEFAULT_THEMES,
    ...pluginThemes,
  }
}

function syncThemes() {
  setStore("themes", listThemes())
}

const [store, setStore] = createStore<State>({
  themes: listThemes(),
  mode: "dark",
  active: "oc-2",
  ready: false,
})

export function allThemes() {
  return store.themes
}

function isTheme(theme: unknown): theme is ThemeJson {
  if (!isRecord(theme)) return false
  if (!isRecord(theme.theme)) return false
  return true
}

export function hasTheme(name: string) {
  if (!name) return false
  return allThemes()[name] !== undefined
}

export function addTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isTheme(theme)) return false
  if (hasTheme(name)) return false
  pluginThemes[name] = theme
  syncThemes()
  return true
}

export function upsertTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isTheme(theme)) return false
  pluginThemes[name] = theme
  syncThemes()
  return true
}

export function resolveTheme(theme: ThemeJson, mode: "dark" | "light", options?: { soften?: boolean }) {
  const defs = theme.defs ?? {}
  function resolveColor(c: ColorValue, chain: string[] = []): RGBA {
    if (c instanceof RGBA) return c
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)

      if (c.startsWith("#")) return RGBA.fromHex(c)

      if (chain.includes(c)) {
        throw new Error(`Circular color reference: ${[...chain, c].join(" -> ")}`)
      }

      const next = defs[c] ?? theme.theme[c as ThemeColor]
      if (next === undefined) {
        throw new Error(`Color reference "${c}" not found in defs or theme`)
      }
      return resolveColor(next, [...chain, c])
    }
    if (typeof c === "number") {
      return ansiToRgba(c)
    }
    return resolveColor(c[mode], chain)
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
      .map(([key, value]) => {
        return [key, resolveColor(value as ColorValue)]
      }),
  ) as Partial<Record<ThemeColor, RGBA>>

  // Handle selectedListItemText separately since it's optional
  const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined
  if (hasSelectedListItemText) {
    resolved.selectedListItemText = resolveColor(theme.theme.selectedListItemText!)
  } else {
    // Backward compatibility: if selectedListItemText is not defined, use background color
    // This preserves the current behavior for all existing themes
    resolved.selectedListItemText = resolved.background
  }

  // Handle backgroundMenu - optional with fallback to backgroundElement
  if (theme.theme.backgroundMenu !== undefined) {
    resolved.backgroundMenu = resolveColor(theme.theme.backgroundMenu)
  } else {
    resolved.backgroundMenu = resolved.backgroundElement
  }

  // Handle thinkingOpacity - optional with default of 0.6
  const thinkingOpacity = theme.theme.thinkingOpacity ?? 0.6

  const result = {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
    thinkingOpacity,
  } as Theme

  return options?.soften ? softenBuiltInTheme(result, mode) : result
}

type MutableTheme = { -readonly [Key in keyof Theme]: Theme[Key] }

function isBuiltInTheme(theme: ThemeJson) {
  return Object.values(DEFAULT_THEMES).some((item) => item === theme)
}

// `oc-2` is the Web/Desktop parity palette. Its colors are already tuned for
// soft contrast against warm surfaces, so running them through the built-in
// softening pass (which desaturates + relightens accents) washes them out and
// hurts legibility. Resolve it verbatim so the TUI matches the desktop exactly.
function shouldSoften(theme: ThemeJson) {
  if (theme === oc2) return false
  return isBuiltInTheme(theme)
}

function softenBuiltInTheme(theme: Theme, mode: "dark" | "light"): Theme {
  const softened = { ...theme } as MutableTheme
  for (const key of SOFTENED_THEME_COLOR_KEYS) {
    softened[key] = softenAccentColor(theme[key], mode)
  }

  const surface = theme.backgroundPanel.a > 0 ? theme.backgroundPanel : theme.backgroundElement
  for (const key of SOFTENED_THEME_SURFACE_KEYS) {
    softened[key] = softenSurfaceColor(theme[key], surface)
  }

  return softened
}

function softenAccentColor(color: RGBA, mode: "dark" | "light") {
  if (color.a === 0) return color
  const hsl = rgbToHsl(color.r, color.g, color.b)
  if (hsl.s < 0.08) return color
  const saturation = hsl.s * (mode === "dark" ? 0.68 : 0.62)
  const targetLightness = mode === "dark" ? clamp(hsl.l, 0.55, 0.78) : clamp(hsl.l, 0.32, 0.58)
  return hslToRgba({
    h: hsl.h,
    s: saturation,
    l: hsl.l + (targetLightness - hsl.l) * 0.72,
    a: color.a,
  })
}

function softenSurfaceColor(color: RGBA, surface: RGBA) {
  if (color.a === 0 || surface.a === 0) return color
  return tint(color, surface, 0.38)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function rgbToHsl(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  if (max === min) return { h: 0, s: 0, l }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4
  return { h: h / 6, s, l }
}

function hslToRgba(input: { h: number; s: number; l: number; a: number }) {
  if (input.s === 0) {
    return RGBA.fromInts(
      Math.round(input.l * 255),
      Math.round(input.l * 255),
      Math.round(input.l * 255),
      Math.round(input.a * 255),
    )
  }

  const hueToRgb = (p: number, q: number, t: number) => {
    const hue = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (hue < 1 / 6) return p + (q - p) * 6 * hue
    if (hue < 1 / 2) return q
    if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6
    return p
  }

  const q = input.l < 0.5 ? input.l * (1 + input.s) : input.l + input.s - input.l * input.s
  const p = 2 * input.l - q
  return RGBA.fromInts(
    Math.round(hueToRgb(p, q, input.h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, input.h) * 255),
    Math.round(hueToRgb(p, q, input.h - 1 / 3) * 255),
    Math.round(input.a * 255),
  )
}

function ansiToRgba(code: number): RGBA {
  // Standard ANSI colors (0-15)
  if (code < 16) {
    const ansiColors = [
      "#000000", // Black
      "#800000", // Red
      "#008000", // Green
      "#808000", // Yellow
      "#000080", // Blue
      "#800080", // Magenta
      "#008080", // Cyan
      "#c0c0c0", // White
      "#808080", // Bright Black
      "#ff0000", // Bright Red
      "#00ff00", // Bright Green
      "#ffff00", // Bright Yellow
      "#0000ff", // Bright Blue
      "#ff00ff", // Bright Magenta
      "#00ffff", // Bright Cyan
      "#ffffff", // Bright White
    ]
    return RGBA.fromHex(ansiColors[code] ?? "#000000")
  }

  // 6x6x6 Color Cube (16-231)
  if (code < 232) {
    const index = code - 16
    const b = index % 6
    const g = Math.floor(index / 6) % 6
    const r = Math.floor(index / 36)

    const val = (x: number) => (x === 0 ? 0 : x * 40 + 55)
    return RGBA.fromInts(val(r), val(g), val(b))
  }

  // Grayscale Ramp (232-255)
  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }

  // Fallback for invalid codes
  return RGBA.fromInts(0, 0, 0)
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light" }) => {
    const renderer = useRenderer()
    const config = useTuiConfig()
    const kv = useKV()
    const pick = (value: unknown) => {
      if (value === "dark" || value === "light") return value
      return
    }

    setStore(
      produce((draft) => {
        // Mode is an explicit light/dark choice. Migrate the legacy lock key
        // and prefer a previously saved explicit mode; otherwise fall back to
        // the terminal-reported mode at boot, then the provided default.
        const saved = pick(kv.get("theme_mode")) ?? pick(kv.get("theme_mode_lock"))
        if (kv.get("theme_mode_lock") !== undefined) kv.set("theme_mode_lock", undefined)
        draft.mode = saved ?? pick(renderer.themeMode) ?? props.mode
        const active = config.theme ?? kv.get("theme", "oc-2")
        draft.active = typeof active === "string" ? active : "oc-2"
        draft.ready = false
      }),
    )

    createEffect(() => {
      const theme = config.theme
      if (theme) setStore("active", theme)
    })

    function init() {
      setStore("ready", true)
    }

    onMount(init)

    // Explicitly set + persist a light/dark mode. There is no "system"
    // auto-follow: once the user (or the saved value) picks a mode it stays.
    function apply(mode: "dark" | "light") {
      kv.set("theme_mode", mode)
      if (store.mode === mode) return
      setStore("mode", mode)
      renderer.clearPaletteCache()
    }

    const refresh = () => {
      renderer.clearPaletteCache()
      init()
    }
    process.on("SIGUSR2", refresh)

    onCleanup(() => {
      process.off("SIGUSR2", refresh)
    })

    // A malformed custom theme (circular / undefined color reference) makes
    // resolveTheme throw. Inside this memo an uncaught throw escapes straight
    // to the global ErrorBoundary and takes the WHOLE TUI down with no way to
    // recover. Fall back to the known-good built-in instead.
    const safeResolve = (theme: ThemeJson, label: string) => {
      try {
        return resolveTheme(theme, store.mode, { soften: shouldSoften(theme) })
      } catch (e) {
        Log.Default.warn("invalid theme, falling back to oc-2", {
          theme: label,
          error: e instanceof Error ? e.message : String(e),
        })
        return resolveTheme(store.themes["oc-2"], store.mode, { soften: false })
      }
    }

    const values = createMemo(() => {
      const active = store.themes[store.active]
      if (active) {
        return safeResolve(active, store.active)
      }

      const saved = kv.get("theme")
      if (typeof saved === "string") {
        const theme = store.themes[saved]
        if (theme) {
          return safeResolve(theme, saved)
        }
      }

      return safeResolve(store.themes["oc-2"], "oc-2")
    })

    createEffect(() => {
      renderer.setBackgroundColor(values().background)
    })

    const syntax = createMemo(() => generateSyntax(values()))
    const subtleSyntax = createMemo(() => generateSubtleSyntax(values()))

    return {
      theme: new Proxy(values(), {
        get(_target, prop) {
          // @ts-expect-error
          return values()[prop]
        },
      }),
      get selected() {
        return store.active
      },
      all() {
        return allThemes()
      },
      has(name: string) {
        return hasTheme(name)
      },
      syntax,
      subtleSyntax,
      mode() {
        return store.mode
      },
      // Mode is always an explicit light/dark value now (no auto-follow), so
      // it is effectively always "locked". lock()/unlock() are retained as
      // no-ops for API/plugin compatibility.
      locked() {
        return true
      },
      lock() {},
      unlock() {},
      setMode(mode: "dark" | "light") {
        apply(mode)
      },
      set(theme: string) {
        if (!hasTheme(theme)) return false
        setStore("active", theme)
        kv.set("theme", theme)
        return true
      },
      get ready() {
        return store.ready
      },
    }
  },
})

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha
  const g = base.g + (overlay.g - base.g) * alpha
  const b = base.b + (overlay.b - base.b) * alpha
  return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
}

function generateSyntax(theme: Theme) {
  return SyntaxStyle.fromTheme(getSyntaxRules(theme))
}

function generateSubtleSyntax(theme: Theme) {
  const rules = getSyntaxRules(theme)
  return SyntaxStyle.fromTheme(
    rules.map((rule) => {
      if (rule.style.foreground) {
        const fg = rule.style.foreground
        return {
          ...rule,
          style: {
            ...rule.style,
            foreground: RGBA.fromInts(
              Math.round(fg.r * 255),
              Math.round(fg.g * 255),
              Math.round(fg.b * 255),
              Math.round(theme.thinkingOpacity * 255),
            ),
          },
        }
      }
      return rule
    }),
  )
}

function getSyntaxRules(theme: Theme) {
  return [
    {
      scope: ["default"],
      style: {
        foreground: theme.text,
      },
    },
    {
      scope: ["prompt"],
      style: {
        foreground: theme.accent,
      },
    },
    {
      scope: ["extmark.file"],
      style: {
        foreground: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["extmark.agent"],
      style: {
        foreground: theme.secondary,
        bold: true,
      },
    },
    {
      scope: ["extmark.paste"],
      style: {
        foreground: theme.background,
        background: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["comment"],
      style: {
        foreground: theme.syntaxComment,
        italic: true,
      },
    },
    {
      scope: ["comment.documentation"],
      style: {
        foreground: theme.syntaxComment,
        italic: true,
      },
    },
    {
      scope: ["string", "symbol"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["number", "boolean"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["character.special"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.type"],
      style: {
        foreground: theme.syntaxType,
        bold: true,
        italic: true,
      },
    },
    {
      scope: ["keyword.function", "function.method"],
      style: {
        foreground: theme.syntaxFunction,
      },
    },
    {
      scope: ["keyword"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.import"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["operator", "keyword.operator", "punctuation.delimiter"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["keyword.conditional.ternary"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["variable", "variable.parameter", "function.method.call", "function.call"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["variable.member", "function", "constructor"],
      style: {
        foreground: theme.syntaxFunction,
      },
    },
    {
      scope: ["type", "module"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["constant"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["property"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["class"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["parameter"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["punctuation", "punctuation.bracket"],
      style: {
        foreground: theme.syntaxPunctuation,
      },
    },
    {
      scope: ["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["variable.super"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["string.escape", "string.regexp"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["keyword.directive"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["punctuation.special"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["keyword.modifier"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.exception"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    // Markdown specific styles
    {
      scope: ["markup.heading"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.1"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.2"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.3"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.4"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.5"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.6"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.bold", "markup.strong"],
      style: {
        foreground: theme.markdownStrong,
        bold: true,
      },
    },
    {
      scope: ["markup.italic"],
      style: {
        foreground: theme.markdownEmph,
        italic: true,
      },
    },
    {
      scope: ["markup.list"],
      style: {
        foreground: theme.markdownListItem,
      },
    },
    {
      scope: ["markup.quote"],
      style: {
        foreground: theme.markdownBlockQuote,
        italic: true,
      },
    },
    {
      scope: ["markup.raw", "markup.raw.block"],
      style: {
        foreground: theme.markdownCode,
      },
    },
    {
      scope: ["markup.raw.inline"],
      style: {
        foreground: theme.markdownCode,
        background: theme.background,
      },
    },
    {
      scope: ["markup.link"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["markup.link.label"],
      style: {
        foreground: theme.markdownLinkText,
        underline: true,
      },
    },
    {
      scope: ["markup.link.url"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["label"],
      style: {
        foreground: theme.markdownLinkText,
      },
    },
    {
      scope: ["spell", "nospell"],
      style: {
        foreground: theme.text,
      },
    },
    {
      scope: ["conceal"],
      style: {
        foreground: theme.textMuted,
      },
    },
    // Additional common highlight groups
    {
      scope: ["string.special", "string.special.url"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["character"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["float"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["comment.error"],
      style: {
        foreground: theme.error,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["comment.warning"],
      style: {
        foreground: theme.warning,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["comment.todo", "comment.note"],
      style: {
        foreground: theme.info,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["namespace"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["field"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["type.definition"],
      style: {
        foreground: theme.syntaxType,
        bold: true,
      },
    },
    {
      scope: ["keyword.export"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["attribute", "annotation"],
      style: {
        foreground: theme.warning,
      },
    },
    {
      scope: ["tag"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["tag.attribute"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["tag.delimiter"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["markup.strikethrough"],
      style: {
        foreground: theme.textMuted,
      },
    },
    {
      scope: ["markup.underline"],
      style: {
        foreground: theme.text,
        underline: true,
      },
    },
    {
      scope: ["markup.list.checked"],
      style: {
        foreground: theme.success,
      },
    },
    {
      scope: ["markup.list.unchecked"],
      style: {
        foreground: theme.textMuted,
      },
    },
    {
      scope: ["diff.plus"],
      style: {
        foreground: theme.diffAdded,
        background: theme.diffAddedBg,
      },
    },
    {
      scope: ["diff.minus"],
      style: {
        foreground: theme.diffRemoved,
        background: theme.diffRemovedBg,
      },
    },
    {
      scope: ["diff.delta"],
      style: {
        foreground: theme.diffContext,
        background: theme.diffContextBg,
      },
    },
    {
      scope: ["error"],
      style: {
        foreground: theme.error,
        bold: true,
      },
    },
    {
      scope: ["warning"],
      style: {
        foreground: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["info"],
      style: {
        foreground: theme.info,
      },
    },
    {
      scope: ["debug"],
      style: {
        foreground: theme.textMuted,
      },
    },
  ]
}
