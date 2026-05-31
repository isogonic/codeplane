import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { pickPendingAnim } from "../ui/pending-anim.ts"
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
 * richer output yet. Picks a random multi-colour braille animation (scan,
 * cascade, snake, orbit, waverows, helix, pulse, rain — ported from the
 * MIT-licensed unicode-animations project) chosen stably from `seed` (a tool
 * callID), so the same tool keeps one animation while different tools get
 * variety. Each frame shimmers through the full oc-2 palette. Falls back to a
 * static dimmed label when animations are disabled.
 */
export function PendingAnimation(props: { label: JSX.Element; seed?: string }) {
  const { theme } = useTheme()
  const kv = useKV()
  const def = createMemo(() => pickPendingAnim(props.seed ?? ""))
  return (
    <Show
      when={kv.get("animations_enabled", true)}
      fallback={<text fg={theme.textMuted}>⋯ {props.label}</text>}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <spinner frames={def().frames} color={def().color} interval={def().interval} />
        <text fg={theme.textMuted}>{props.label}</text>
      </box>
    </Show>
  )
}
