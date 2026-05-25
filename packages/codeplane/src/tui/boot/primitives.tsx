// Reusable TUI primitives for the boot wizard. Kept inside `boot/` so they
// don't depend on the main app's theme/keybind/dialog providers (the wizard
// runs on its own renderer before any of those exist).
import { createContext, createMemo, For, Show, useContext, type Accessor, type JSX } from "solid-js"
import { RGBA, TextAttributes, type TerminalColors } from "@opentui/core"
import { tuiT } from "@/tui/i18n"

export type BootPalette = {
  bg: RGBA
  surface: RGBA
  surfaceMuted: RGBA
  surfaceStrong: RGBA
  fg: RGBA
  fgMuted: RGBA
  fgDim: RGBA
  divider: RGBA
  accent: RGBA
  accentSoft: RGBA
  success: RGBA
  info: RGBA
  warn: RGBA
  error: RGBA
}

export const defaultBootPalette: BootPalette = {
  bg: RGBA.fromInts(4, 4, 4, 0),
  surface: RGBA.fromInts(26, 26, 26, 255),
  surfaceMuted: RGBA.fromInts(34, 34, 34, 255),
  surfaceStrong: RGBA.fromInts(42, 42, 42, 255),
  fg: RGBA.fromInts(238, 238, 238, 255),
  fgMuted: RGBA.fromInts(170, 170, 170, 255),
  fgDim: RGBA.fromInts(118, 118, 118, 255),
  divider: RGBA.fromInts(74, 74, 74, 255),
  accent: RGBA.fromInts(112, 190, 255, 255),
  accentSoft: RGBA.fromInts(92, 132, 168, 255),
  success: RGBA.fromInts(122, 196, 122, 255),
  info: RGBA.fromInts(112, 190, 255, 255),
  warn: RGBA.fromInts(214, 186, 110, 255),
  error: RGBA.fromInts(222, 116, 116, 255),
}

const BootPaletteContext = createContext<Accessor<BootPalette>>()

function mix(left: RGBA, right: RGBA, amount: number) {
  const alpha = Math.max(0, Math.min(1, amount))
  return RGBA.fromInts(
    Math.round((left.r + (right.r - left.r) * alpha) * 255),
    Math.round((left.g + (right.g - left.g) * alpha) * 255),
    Math.round((left.b + (right.b - left.b) * alpha) * 255),
    Math.round((left.a + (right.a - left.a) * alpha) * 255),
  )
}

function rgbaFromTerminal(value: string | null | undefined, fallback: RGBA) {
  if (!value) return fallback
  try {
    return RGBA.fromHex(value)
  } catch {
    return fallback
  }
}

function paletteColor(colors: TerminalColors, index: number, fallback: RGBA) {
  return rgbaFromTerminal(colors.palette[index], fallback)
}

export function createBootPaletteFromTerminal(colors: TerminalColors, mode: "dark" | "light"): BootPalette {
  const backgroundBase = rgbaFromTerminal(colors.defaultBackground, paletteColor(colors, 0, RGBA.fromInts(10, 10, 10, 255)))
  const foreground = rgbaFromTerminal(colors.defaultForeground, paletteColor(colors, 7, RGBA.fromInts(240, 240, 240, 255)))
  const isDark = mode === "dark"
  const bg = RGBA.fromValues(backgroundBase.r, backgroundBase.g, backgroundBase.b, 0)
  const surface = mix(backgroundBase, foreground, isDark ? 0.08 : 0.04)
  const surfaceMuted = mix(backgroundBase, foreground, isDark ? 0.12 : 0.08)
  const surfaceStrong = mix(backgroundBase, foreground, isDark ? 0.17 : 0.12)
  const fgMuted = mix(foreground, backgroundBase, isDark ? 0.3 : 0.42)
  const fgDim = mix(foreground, backgroundBase, isDark ? 0.55 : 0.66)
  const divider = mix(foreground, backgroundBase, isDark ? 0.72 : 0.8)
  const accent = paletteColor(colors, 6, paletteColor(colors, 4, defaultBootPalette.accent))
  const info = paletteColor(colors, 6, accent)
  const success = paletteColor(colors, 2, defaultBootPalette.success)
  const warn = paletteColor(colors, 3, defaultBootPalette.warn)
  const error = paletteColor(colors, 1, defaultBootPalette.error)

  return {
    bg,
    surface,
    surfaceMuted,
    surfaceStrong,
    fg: foreground,
    fgMuted,
    fgDim,
    divider,
    accent,
    accentSoft: mix(accent, backgroundBase, isDark ? 0.38 : 0.5),
    success,
    info,
    warn,
    error,
  }
}

export function BootPaletteProvider(props: {
  palette: Accessor<BootPalette>
  children: JSX.Element
}) {
  return <BootPaletteContext.Provider value={props.palette}>{props.children}</BootPaletteContext.Provider>
}

export function useBootPalette() {
  return useContext(BootPaletteContext) ?? (() => defaultBootPalette)
}

export function StatusBar(props: { hints: { keys: string; label: string }[] }) {
  const palette = useBootPalette()
  return (
    <box flexDirection="row" paddingX={1} paddingY={0} backgroundColor={palette().surface}>
      <For each={props.hints}>
        {(hint, i) => (
          <box flexDirection="row" marginRight={2}>
            <text fg={palette().accent}>{hint.keys}</text>
            <text fg={palette().fgMuted}> {hint.label}</text>
            <Show when={i() < props.hints.length - 1}>
              <text fg={palette().divider}> </text>
            </Show>
          </box>
        )}
      </For>
    </box>
  )
}

export function Header(props: { instance: string; cwd?: string; status: string; statusColor?: RGBA }) {
  const palette = useBootPalette()
  return (
    <box flexDirection="row" paddingX={1} paddingY={0} backgroundColor={palette().surfaceStrong}>
      <text fg={palette().fg} attributes={TextAttributes.BOLD}>
        Codeplane
      </text>
      <text fg={palette().fgDim}> · </text>
      <text fg={palette().fgMuted}>{props.instance}</text>
      <Show when={props.cwd}>
        <text fg={palette().fgDim}> · </text>
        <text fg={palette().fgDim}>{props.cwd}</text>
      </Show>
      <text fg={palette().fgDim}> · </text>
      <text fg={props.statusColor ?? palette().success}>{props.status}</text>
    </box>
  )
}

export function SectionHeading(props: { children: string }) {
  const palette = useBootPalette()
  return (
    <box marginTop={1} paddingX={2}>
      <text fg={palette().fg} attributes={TextAttributes.BOLD}>
        {props.children}
      </text>
    </box>
  )
}

// Text field rendered as label + value with a `▎` cursor when focused.
// All keystroke handling is done by the parent's `useKeyboard` — the field
// is presentational only. `placeholder` shows in muted grey when value is
// empty and the field isn't focused.
export function TextField(props: {
  label: string
  value: string
  focused: boolean
  placeholder?: string
  hint?: string
  width?: number
  validate?: () => { ok: boolean; message?: string }
}) {
  const palette = useBootPalette()
  const valid = createMemo(() => props.validate?.() ?? { ok: true })
  return (
    <box flexDirection="column" paddingX={2}>
      <box flexDirection="row">
        <text fg={props.focused ? palette().accent : palette().fgDim}>
          {props.focused ? "▍ " : "  "}
        </text>
        <text
          fg={props.focused ? palette().fg : palette().fgMuted}
          attributes={props.focused ? TextAttributes.BOLD : 0}
        >
          {props.label}
        </text>
        <Show when={props.hint}>
          <text fg={palette().fgDim}>  {props.hint}</text>
        </Show>
      </box>
      <box flexDirection="row" paddingLeft={2}>
        <Show
          when={props.value || !props.placeholder}
          fallback={<text fg={palette().fgDim}>{props.placeholder}</text>}
        >
          <text fg={props.focused ? palette().fg : palette().fgMuted}>{props.value}</text>
        </Show>
        <Show when={props.focused}>
          <text fg={palette().accent}>▎</text>
        </Show>
      </box>
      <Show when={!valid().ok && valid().message}>
        <box paddingLeft={2}>
          <text fg={palette().warn}>{valid().message}</text>
        </box>
      </Show>
    </box>
  )
}

// Select-style "cycle" field: shows current value, can be cycled with ←/→
// when focused. Used for binary version, etc.
export function SelectField(props: {
  label: string
  value: string
  focused: boolean
  options: string[]
  hint?: string
}) {
  const palette = useBootPalette()
  const idx = createMemo(() => props.options.indexOf(props.value))
  return (
    <box flexDirection="column" paddingX={2}>
      <box flexDirection="row">
        <text fg={props.focused ? palette().accent : palette().fgDim}>
          {props.focused ? "▍ " : "  "}
        </text>
        <text
          fg={props.focused ? palette().fg : palette().fgMuted}
          attributes={props.focused ? TextAttributes.BOLD : 0}
        >
          {props.label}
        </text>
        <Show when={props.hint}>
          <text fg={palette().fgDim}>  {props.hint}</text>
        </Show>
      </box>
      <box flexDirection="row" paddingLeft={2}>
        <Show when={props.focused && props.options.length > 1}>
          <text fg={palette().fgDim}>‹ </text>
        </Show>
        <text fg={props.focused ? palette().fg : palette().fgMuted}>{props.value || "—"}</text>
        <Show when={props.focused && props.options.length > 1}>
          <text fg={palette().fgDim}> ›</text>
        </Show>
        <Show when={props.options.length > 0}>
          <text fg={palette().fgDim}>{`   ${idx() + 1}/${props.options.length}`}</text>
        </Show>
      </box>
    </box>
  )
}

// Toggle field rendered as `[x]` / `[ ]`.
export function ToggleField(props: { label: string; value: boolean; focused: boolean; hint?: string }) {
  const palette = useBootPalette()
  return (
    <box flexDirection="column" paddingX={2}>
      <box flexDirection="row">
        <text fg={props.focused ? palette().accent : palette().fgDim}>
          {props.focused ? "▍ " : "  "}
        </text>
        <text
          fg={props.focused ? palette().fg : palette().fgMuted}
          attributes={props.focused ? TextAttributes.BOLD : 0}
        >
          {props.label}
        </text>
        <Show when={props.hint}>
          <text fg={palette().fgDim}>  {props.hint}</text>
        </Show>
      </box>
      <box flexDirection="row" paddingLeft={2}>
        <text fg={props.value ? palette().success : palette().fgDim}>{props.value ? "[x]" : "[ ]"}</text>
        <text fg={props.focused ? palette().fgMuted : palette().fgDim}>  {tuiT("common.spaceToToggle")}</text>
      </box>
    </box>
  )
}

// Simple progress bar. `width` is the bar width in cells.
export function ProgressBar(props: {
  percent: number
  message?: string
  width?: number
  color?: RGBA
}) {
  const palette = useBootPalette()
  const w = () => props.width ?? 40
  const filled = () => Math.max(0, Math.min(w(), Math.round((props.percent / 100) * w())))
  return (
    <box flexDirection="column" paddingX={2}>
      <box flexDirection="row">
        <text fg={props.color ?? palette().accent}>{"█".repeat(filled())}</text>
        <text fg={palette().divider}>{"░".repeat(w() - filled())}</text>
        <text fg={palette().fgMuted}>{`  ${Math.round(props.percent)}%`}</text>
      </box>
      <Show when={props.message}>
        <text fg={palette().fgDim}>{props.message}</text>
      </Show>
    </box>
  )
}

// Error/info banner.
export function Banner(props: { variant: "error" | "warn" | "success" | "info"; children: string }) {
  const palette = useBootPalette()
  const fg =
    props.variant === "error"
      ? palette().error
      : props.variant === "warn"
        ? palette().warn
        : props.variant === "success"
          ? palette().success
          : palette().info
  const label =
    props.variant === "error"
      ? "Error"
      : props.variant === "warn"
        ? "Warning"
        : props.variant === "success"
          ? "Ready"
          : "Info"
  return (
    <box flexDirection="row" paddingX={2}>
      <text fg={fg} attributes={TextAttributes.BOLD}>
        {label}
      </text>
      <text fg={palette().fgDim}>  </text>
      <text fg={palette().fgMuted}>{props.children}</text>
    </box>
  )
}
