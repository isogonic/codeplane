import { createEffect, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createSimpleContext } from "../context/helper"
import oc2ThemeJson from "./themes/oc-2.json"
import type { WebTheme } from "./types"

/*
 * Theme context — strict light/dark switcher.
 *
 * The legacy multi-theme system (Dracula / Tokyonight / Catppuccin / 35
 * other themes that loaded JSON at runtime and injected `<style>` rules
 * into `<head>`) has been removed. The shared UI now ships a single
 * Logic-style monochrome design, with the actual token values living in
 * `packages/ui/src/styles/shadcn.css`. This module just toggles the
 * `.dark` class on `<html>` so that file's selectors flip light ↔ dark.
 *
 * The old API surface (`themeId()`, `themes()`, `setTheme()`,
 * `previewTheme()`, `ids()`, `name()`, `loadThemes()`, `registerTheme()`,
 * `commitPreview()` / `cancelPreview()`) is preserved so existing
 * consumers (terminal palette, command palette entries, settings rows)
 * keep compiling. The picker methods are no-ops; `themes()` returns the
 * single bundled theme; `themeId()` is always `"oc-2"`.
 */

export type ColorScheme = "light" | "dark" | "system"

const STORAGE_KEY = "codeplane-color-scheme"
const SINGLE_THEME_ID = "oc-2"
const oc2Theme = oc2ThemeJson as WebTheme

function read(): string | null {
  if (typeof localStorage !== "object") return null
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function write(value: string): void {
  if (typeof localStorage !== "object") return
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {}
}

function getSystemMode(): "light" | "dark" {
  if (typeof window !== "object") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function applyMode(mode: "light" | "dark"): void {
  if (typeof document !== "object") return
  const root = document.documentElement
  if (mode === "dark") root.classList.add("dark")
  else root.classList.remove("dark")
  root.style.colorScheme = mode
  root.dataset.colorScheme = mode
  root.dataset.theme = SINGLE_THEME_ID
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { defaultTheme?: string; onThemeApplied?: (theme: WebTheme, mode: "light" | "dark") => void }) => {
    void props.defaultTheme
    const colorScheme = (read() as ColorScheme | null) ?? "system"
    const mode = colorScheme === "system" ? getSystemMode() : colorScheme

    const [store, setStore] = createStore({
      themes: { [SINGLE_THEME_ID]: oc2Theme } as Record<string, WebTheme>,
      themeId: SINGLE_THEME_ID,
      colorScheme,
      mode,
      previewThemeId: null as string | null,
      previewScheme: null as ColorScheme | null,
    })

    onMount(() => {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
      const onMedia = () => {
        if (store.colorScheme !== "system") return
        setStore("mode", getSystemMode())
      }
      makeEventListener(mediaQuery, "change", onMedia)
      applyMode(store.mode)
      props.onThemeApplied?.(oc2Theme, store.mode)
    })

    createEffect(() => {
      const effective = store.previewScheme
        ? store.previewScheme === "system"
          ? getSystemMode()
          : store.previewScheme
        : store.mode
      applyMode(effective)
    })

    const setColorScheme = (scheme: ColorScheme) => {
      setStore("colorScheme", scheme)
      write(scheme)
      setStore("mode", scheme === "system" ? getSystemMode() : scheme)
    }

    /* Picker / preview hooks are kept as no-ops so the rest of the
       codebase keeps compiling — there's only one theme to pick from. */
    const noop = () => {}

    return {
      themeId: () => store.themeId,
      colorScheme: () => store.colorScheme,
      mode: () => store.mode,
      ids: () => [SINGLE_THEME_ID],
      name: (id: string) => (id === SINGLE_THEME_ID ? "Codeplane" : id),
      loadThemes: () => Promise.resolve(store.themes),
      themes: () => store.themes,
      setTheme: noop,
      setColorScheme,
      registerTheme: noop,
      previewTheme: noop,
      previewColorScheme: (scheme: ColorScheme) => {
        setStore("previewScheme", scheme)
      },
      commitPreview: () => {
        if (store.previewScheme) setColorScheme(store.previewScheme)
        setStore("previewScheme", null)
      },
      cancelPreview: () => {
        setStore("previewScheme", null)
      },
    }
  },
})
