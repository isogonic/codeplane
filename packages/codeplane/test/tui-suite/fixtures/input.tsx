import { createSignal } from "solid-js"

export function InputFixture(props: { placeholder?: string }) {
  const [value, setValue] = createSignal("")
  const [submitted, setSubmitted] = createSignal<string[]>([])

  return (
    <box flexDirection="column" padding={1} title="Input Fixture" border={true} width={60} height={16}>
      <text>Type something and press Enter:</text>
      <input
        focused={true}
        placeholder={props.placeholder ?? "say something..."}
        value={value()}
        onInput={(v: string) => setValue(v)}
        onSubmit={((v: string) => {
          setSubmitted((arr) => [...arr, v])
          setValue("")
        }) as any}
      />
      <text> </text>
      <text>History ({submitted().length}):</text>
      <text>{submitted().join(" | ")}</text>
    </box>
  )
}
