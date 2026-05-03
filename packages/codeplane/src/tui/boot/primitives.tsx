// Reusable TUI primitives for the boot wizard. Kept inside `boot/` so they
// don't depend on the main app's theme/keybind/dialog providers (the wizard
// runs on its own renderer before any of those exist).
import { createMemo, For, Show } from "solid-js"
import { RGBA, TextAttributes } from "@opentui/core"

export const palette = {
  bg: RGBA.fromInts(4, 4, 4, 255),
  fg: RGBA.fromInts(238, 238, 238, 255),
  fgMuted: RGBA.fromInts(160, 160, 160, 255),
  fgDim: RGBA.fromInts(96, 96, 96, 255),
  divider: RGBA.fromInts(53, 53, 53, 255),
  accent: RGBA.fromInts(250, 178, 131, 255),
  accentDim: RGBA.fromInts(180, 120, 80, 255),
  selectedBg: RGBA.fromInts(38, 64, 101, 255),
  success: RGBA.fromInts(120, 200, 120, 255),
  info: RGBA.fromInts(120, 170, 230, 255),
  warn: RGBA.fromInts(230, 200, 120, 255),
  error: RGBA.fromInts(220, 110, 110, 255),
}

export function StatusBar(props: { hints: { keys: string; label: string }[] }) {
  return (
    <box flexDirection="row" paddingX={1} backgroundColor={palette.bg}>
      <For each={props.hints}>
        {(hint, i) => (
          <box flexDirection="row" marginRight={2}>
            <text fg={palette.accent}>{hint.keys}</text>
            <text fg={palette.fgMuted}> {hint.label}</text>
            <Show when={i() < props.hints.length - 1}>
              <text fg={palette.divider}> </text>
            </Show>
          </box>
        )}
      </For>
    </box>
  )
}

export function Header(props: { instance: string; cwd?: string; status: string; statusColor?: RGBA }) {
  return (
    <box flexDirection="row" paddingX={1} backgroundColor={palette.bg}>
      <text fg={palette.accent} attributes={TextAttributes.BOLD}>
        codeplane
      </text>
      <text fg={palette.fgDim}> · </text>
      <text fg={palette.fg}>{props.instance}</text>
      <Show when={props.cwd}>
        <text fg={palette.fgDim}> · </text>
        <text fg={palette.fgMuted}>{props.cwd}</text>
      </Show>
      <text fg={palette.fgDim}> · </text>
      <text fg={props.statusColor ?? palette.success}>{props.status}</text>
    </box>
  )
}

export function SectionHeading(props: { children: string }) {
  return (
    <box marginTop={1} paddingX={2}>
      <text fg={palette.fgDim}>{props.children}</text>
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
  const valid = createMemo(() => props.validate?.() ?? { ok: true })
  return (
    <box flexDirection="column" paddingX={2}>
      <box flexDirection="row">
        <text fg={props.focused ? palette.accent : palette.fgDim}>
          {props.focused ? "▍ " : "  "}
        </text>
        <text
          fg={props.focused ? palette.accent : palette.fgMuted}
          attributes={props.focused ? TextAttributes.BOLD : 0}
        >
          {props.label}
        </text>
        <Show when={props.hint}>
          <text fg={palette.fgDim}>  {props.hint}</text>
        </Show>
      </box>
      <box flexDirection="row" paddingLeft={2}>
        <Show
          when={props.value || !props.placeholder}
          fallback={<text fg={palette.fgDim}>{props.placeholder}</text>}
        >
          <text fg={props.focused ? palette.fg : palette.fgMuted}>{props.value}</text>
        </Show>
        <Show when={props.focused}>
          <text fg={palette.accent}>▎</text>
        </Show>
      </box>
      <Show when={!valid().ok && valid().message}>
        <box paddingLeft={2}>
          <text fg={palette.warn}>{valid().message}</text>
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
  const idx = createMemo(() => props.options.indexOf(props.value))
  return (
    <box flexDirection="column" paddingX={2}>
      <box flexDirection="row">
        <text fg={props.focused ? palette.accent : palette.fgDim}>
          {props.focused ? "▍ " : "  "}
        </text>
        <text
          fg={props.focused ? palette.accent : palette.fgMuted}
          attributes={props.focused ? TextAttributes.BOLD : 0}
        >
          {props.label}
        </text>
        <Show when={props.hint}>
          <text fg={palette.fgDim}>  {props.hint}</text>
        </Show>
      </box>
      <box flexDirection="row" paddingLeft={2}>
        <Show when={props.focused && props.options.length > 1}>
          <text fg={palette.fgDim}>‹ </text>
        </Show>
        <text fg={props.focused ? palette.fg : palette.fgMuted}>
          {props.value || "—"}
        </text>
        <Show when={props.focused && props.options.length > 1}>
          <text fg={palette.fgDim}> ›</text>
        </Show>
        <Show when={props.options.length > 0}>
          <text fg={palette.fgDim}>{`   ${idx() + 1}/${props.options.length}`}</text>
        </Show>
      </box>
    </box>
  )
}

// Toggle field rendered as `[x]` / `[ ]`.
export function ToggleField(props: { label: string; value: boolean; focused: boolean; hint?: string }) {
  return (
    <box flexDirection="column" paddingX={2}>
      <box flexDirection="row">
        <text fg={props.focused ? palette.accent : palette.fgDim}>
          {props.focused ? "▍ " : "  "}
        </text>
        <text
          fg={props.focused ? palette.accent : palette.fgMuted}
          attributes={props.focused ? TextAttributes.BOLD : 0}
        >
          {props.label}
        </text>
        <Show when={props.hint}>
          <text fg={palette.fgDim}>  {props.hint}</text>
        </Show>
      </box>
      <box flexDirection="row" paddingLeft={2}>
        <text fg={props.value ? palette.success : palette.fgDim}>
          {props.value ? "[x]" : "[ ]"}
        </text>
        <text fg={props.focused ? palette.fgMuted : palette.fgDim}>  space to toggle</text>
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
  const w = () => props.width ?? 40
  const filled = () => Math.max(0, Math.min(w(), Math.round((props.percent / 100) * w())))
  return (
    <box flexDirection="column" paddingX={2}>
      <box flexDirection="row">
        <text fg={props.color ?? palette.accent}>{"█".repeat(filled())}</text>
        <text fg={palette.divider}>{"░".repeat(w() - filled())}</text>
        <text fg={palette.fgMuted}>{`  ${Math.round(props.percent)}%`}</text>
      </box>
      <Show when={props.message}>
        <text fg={palette.fgDim}>{props.message}</text>
      </Show>
    </box>
  )
}

// Error/info banner.
export function Banner(props: { variant: "error" | "warn" | "success" | "info"; children: string }) {
  const fg =
    props.variant === "error"
      ? palette.error
      : props.variant === "warn"
        ? palette.warn
        : props.variant === "success"
          ? palette.success
          : palette.info
  const glyph =
    props.variant === "error" ? "✗" : props.variant === "warn" ? "⚠" : props.variant === "success" ? "✓" : "ℹ"
  return (
    <box flexDirection="row" paddingX={2}>
      <text fg={fg}>{glyph}  </text>
      <text fg={palette.fgMuted}>{props.children}</text>
    </box>
  )
}
