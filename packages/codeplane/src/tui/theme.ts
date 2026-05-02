// Color tokens used by every TUI view component. Keep these stable so a single
// edit re-themes the whole UI.
//
// Design language: Claude Code / Codex.
// - chrome is muted; content carries the color
// - one accent (warm orange) for focus + interactive
// - role colors only when they help separate speakers
export const theme = {
  // Warm orange accent, like Claude/Codex highlight bars.
  accent: "yellow",
  accentSoft: "yellowBright",
  fg: "white",
  fgMuted: "gray",
  fgDim: "gray",
  success: "green",
  warning: "yellow",
  error: "red",
  info: "cyan",
  user: "white",
  assistant: "yellow",
  reasoning: "magenta",
  tool: "cyan",
  divider: "gray",
} as const

export type Variant = "info" | "success" | "warning" | "error"

export const variantColor: Record<Variant, string> = {
  info: theme.info,
  success: theme.success,
  warning: theme.warning,
  error: theme.error,
}

export const variantLabel: Record<Variant, string> = {
  info: "info",
  success: "ready",
  warning: "warn",
  error: "error",
}

export const glyph = {
  prompt: ">",
  cursor: "▌",
  caret: "▍",
  bullet: "·",
  filledDot: "●",
  hollowDot: "○",
  arrowRight: "›",
  arrowDown: "↓",
  arrowUp: "↑",
  check: "✓",
  cross: "✗",
  spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  todoPending: "○",
  todoActive: "◐",
  todoDone: "●",
  toolDone: "✓",
  toolError: "✗",
  toolRunning: "◐",
  toolPending: "○",
  divider: "─",
  vbar: "│",
  bold: "▪",
  folder: "▸",
  file: "·",
  homeMark: "~",
  separator: "/",
} as const
