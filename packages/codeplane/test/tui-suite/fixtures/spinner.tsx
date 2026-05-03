import { createSignal, onCleanup, onMount } from "solid-js"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function SpinnerFixture(props: { intervalMs?: number; label?: string }) {
  const [frame, setFrame] = createSignal(0)
  let timer: ReturnType<typeof setInterval> | undefined

  onMount(() => {
    timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), props.intervalMs ?? 80)
  })
  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  return (
    <box flexDirection="row" padding={1} title="Spinner Fixture" border={true}>
      <text fg="#22d3ee">{FRAMES[frame()]}</text>
      <text> {props.label ?? "Working..."}</text>
    </box>
  )
}
