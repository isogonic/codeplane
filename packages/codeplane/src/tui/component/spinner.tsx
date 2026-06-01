import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { RGBA } from "@opentui/core"
import "opentui-spinner/solid"
import { textValue } from "@/tui/util/text-value"

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: unknown; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  const label = () => textValue(props.children)
  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={color()}>⋯ {label()}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={frames} interval={80} color={color()} />
        <Show when={label()}>
          <text fg={color()}>{label()}</text>
        </Show>
      </box>
    </Show>
  )
}

/**
 * Static "pending" indicator for tools that are still running but have no
 * richer output yet. Renders a dimmed `⋯ <label>` row.
 *
 * Previously this showed a small multi-frame braille animation, but that
 * rendered too small and looked poor at terminal cell size, so it was removed
 * in favour of this plain, legible indicator. `seed` is accepted for call-site
 * compatibility but no longer used.
 */
export function PendingAnimation(props: { label: unknown; seed?: string; color?: RGBA }) {
  const { theme } = useTheme()
  const color = () => props.color ?? theme.textMuted
  return <text fg={color()}>⋯ {textValue(props.label)}</text>
}
