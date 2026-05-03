import { createSignal, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export function DialogFixture(props: { initialOpen?: boolean }) {
  const [open, setOpen] = createSignal(props.initialOpen ?? false)
  const [confirmed, setConfirmed] = createSignal(false)

  useKeyboard((evt) => {
    if (!open()) {
      if (evt.name === "o") setOpen(true)
      return
    }
    if (evt.name === "escape") setOpen(false)
    if (evt.name === "y") {
      setConfirmed(true)
      setOpen(false)
    }
    if (evt.name === "n") {
      setConfirmed(false)
      setOpen(false)
    }
  })

  return (
    <box flexDirection="column" padding={1} title="Dialog Fixture" border={true} width={60} height={20}>
      <text>Press 'o' to open the dialog.</text>
      <text>Status: {confirmed() ? "CONFIRMED" : "pending"}</text>
      <Show when={open()}>
        <box position="absolute" top={4} left={4} width={50} height={10} title="Confirm" border={true} backgroundColor="#1e1e2e">
          <text>Are you sure?</text>
          <text> </text>
          <text>[y] yes  [n] no  [Esc] cancel</text>
        </box>
      </Show>
    </box>
  )
}
