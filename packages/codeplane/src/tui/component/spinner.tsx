import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useLocal } from "../context/local"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { createColors, createFrames } from "../ui/spinner.ts"
import "opentui-spinner/solid"

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={color()}>⋯ {props.children}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={frames} interval={80} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}

/**
 * Animated "pending" indicator for tools that are still running but have no
 * richer output yet. Renders the colored Knight Rider gradient scanner (the
 * same one used in the prompt footer) tinted to the active agent's color,
 * with the pending label beside it. Falls back to a static dimmed label when
 * animations are disabled.
 */
export function PendingAnimation(props: { label: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const local = useLocal()
  const kv = useKV()
  const color = createMemo(() => {
    if (props.color) return props.color
    const agent = local.agent.current()
    return agent ? local.agent.color(agent.name) : theme.primary
  })
  const def = createMemo(() => {
    const opts = { color: color(), style: "blocks" as const, width: 6, inactiveFactor: 0.5, minAlpha: 0.25 }
    return { frames: createFrames(opts), color: createColors(opts) }
  })
  return (
    <Show
      when={kv.get("animations_enabled", true)}
      fallback={<text fg={theme.textMuted}>⋯ {props.label}</text>}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <spinner frames={def().frames} color={def().color} interval={60} />
        <text fg={theme.textMuted}>{props.label}</text>
      </box>
    </Show>
  )
}
