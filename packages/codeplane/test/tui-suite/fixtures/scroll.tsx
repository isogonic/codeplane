import { createSignal, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export function ScrollFixture(props: { count?: number }) {
  const total = props.count ?? 100
  const [offset, setOffset] = createSignal(0)
  const visible = 10

  useKeyboard((evt) => {
    if (evt.name === "down" || evt.name === "j") setOffset((o) => Math.min(total - visible, o + 1))
    else if (evt.name === "up" || evt.name === "k") setOffset((o) => Math.max(0, o - 1))
    else if (evt.name === "pagedown") setOffset((o) => Math.min(total - visible, o + visible))
    else if (evt.name === "pageup") setOffset((o) => Math.max(0, o - visible))
    else if (evt.name === "home") setOffset(0)
    else if (evt.name === "end") setOffset(total - visible)
  })

  const lines = () => {
    const out: number[] = []
    for (let i = offset(); i < Math.min(total, offset() + visible); i++) out.push(i)
    return out
  }

  return (
    <box flexDirection="column" padding={1} title="Scroll Fixture" border={true} width={60} height={visible + 8}>
      <text>{`UP/DN scroll one line | PgUp/PgDn page | Home/End jump`}</text>
      <text>{`showing ${offset() + 1}-${Math.min(total, offset() + visible)} of ${total}`}</text>
      <text> </text>
      <For each={lines()}>{(i) => <text>{`item ${String(i + 1).padStart(3, "0")}`}</text>}</For>
    </box>
  )
}
