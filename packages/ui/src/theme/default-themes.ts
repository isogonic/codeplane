import type { WebTheme } from "./types"
import oc2ThemeJson from "./themes/oc-2.json"

/*
 * Default themes — the multi-theme picker has been removed. The UI ships
 * a single Logic-style monochrome design driven by the CSS in
 * `packages/ui/src/styles/shadcn.css`; the JSON here only exists so that
 * code paths which still expect a `WebTheme` shape (the desktop host's
 * legacy asset writer; the xterm palette fallback) keep working without
 * a behaviour change. Light/dark switching toggles the `.dark` class on
 * `<html>` — there is no theme to swap.
 */

export const oc2Theme = oc2ThemeJson as WebTheme

/* Aliases kept so legacy named imports still resolve. */
export const codeplaneTheme = oc2Theme
export const amoledTheme = oc2Theme
export const auraTheme = oc2Theme
export const ayuTheme = oc2Theme
export const carbonfoxTheme = oc2Theme
export const catppuccinTheme = oc2Theme
export const catppuccinFrappeTheme = oc2Theme
export const catppuccinMacchiatoTheme = oc2Theme
export const cobalt2Theme = oc2Theme
export const cursorTheme = oc2Theme
export const draculaTheme = oc2Theme
export const everforestTheme = oc2Theme
export const flexokiTheme = oc2Theme
export const githubTheme = oc2Theme
export const gruvboxTheme = oc2Theme
export const kanagawaTheme = oc2Theme
export const lucentOrngTheme = oc2Theme
export const materialTheme = oc2Theme
export const matrixTheme = oc2Theme
export const mercuryTheme = oc2Theme
export const monokaiTheme = oc2Theme
export const nightowlTheme = oc2Theme
export const nordTheme = oc2Theme
export const oneDarkTheme = oc2Theme
export const oneDarkProTheme = oc2Theme
export const orngTheme = oc2Theme
export const osakaJadeTheme = oc2Theme
export const palenightTheme = oc2Theme
export const rosepineTheme = oc2Theme
export const shadesOfPurpleTheme = oc2Theme
export const solarizedTheme = oc2Theme
export const synthwave84Theme = oc2Theme
export const tokyonightTheme = oc2Theme
export const vercelTheme = oc2Theme
export const vesperTheme = oc2Theme
export const zenburnTheme = oc2Theme

export const DEFAULT_THEMES: Record<string, WebTheme> = {
  "oc-2": oc2Theme,
}

export const LEGACY_THEME_ASSET_IDS = [
  "oc-2",
  "amoled",
  "aura",
  "ayu",
  "carbonfox",
  "catppuccin",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "cobalt2",
  "cursor",
  "dracula",
  "everforest",
  "flexoki",
  "github",
  "gruvbox",
  "kanagawa",
  "lucent-orng",
  "material",
  "matrix",
  "mercury",
  "monokai",
  "nightowl",
  "nord",
  "one-dark",
  "one-dark-pro",
  "codeplane",
  "orng",
  "osaka-jade",
  "palenight",
  "rosepine",
  "shades-of-purple",
  "solarized",
  "synthwave84",
  "tokyonight",
  "vercel",
  "vesper",
  "zenburn",
] as const

export const LEGACY_THEME_ASSETS: Record<(typeof LEGACY_THEME_ASSET_IDS)[number], WebTheme> = Object.fromEntries(
  LEGACY_THEME_ASSET_IDS.map((id) => [id, oc2Theme]),
) as Record<(typeof LEGACY_THEME_ASSET_IDS)[number], WebTheme>
