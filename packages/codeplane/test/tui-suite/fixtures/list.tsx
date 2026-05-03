import { createSignal, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export interface ListItem {
  id: string
  label: string
}

export function ListFixture(props: { items?: ListItem[]; onSelect?: (item: ListItem) => void }) {
  const items = () => props.items ?? defaultItems
  const [index, setIndex] = createSignal(0)
  const [selected, setSelected] = createSignal<ListItem | null>(null)

  useKeyboard((evt) => {
    const list = items()
    if (list.length === 0) return
    if (evt.name === "down" || evt.name === "j") {
      setIndex((i) => Math.min(list.length - 1, i + 1))
    } else if (evt.name === "up" || evt.name === "k") {
      setIndex((i) => Math.max(0, i - 1))
    } else if (evt.name === "home") {
      setIndex(0)
    } else if (evt.name === "end") {
      setIndex(list.length - 1)
    } else if (evt.name === "return") {
      const item = list[index()]
      if (item) {
        setSelected(item)
        props.onSelect?.(item)
      }
    }
  })

  return (
    <box flexDirection="column" padding={1} title="List Fixture" border={true}>
      <text>Use ↑/↓ to move, Enter to select.</text>
      <text> </text>
      <For each={items()}>
        {(item, i) => (
          <text fg={i() === index() ? "#000000" : "#ffffff"} bg={i() === index() ? "#22d3ee" : "transparent"}>
            {i() === index() ? "▸ " : "  "}
            {item.label}
          </text>
        )}
      </For>
      <text> </text>
      <text>Selected: {selected()?.label ?? "(none)"}</text>
    </box>
  )
}

const defaultItems: ListItem[] = [
  { id: "alpha", label: "Alpha" },
  { id: "bravo", label: "Bravo" },
  { id: "charlie", label: "Charlie" },
  { id: "delta", label: "Delta" },
  { id: "echo", label: "Echo" },
]
