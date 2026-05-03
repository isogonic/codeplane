import { createSignal, ErrorBoundary } from "solid-js"
import { useKeyboard } from "@opentui/solid"

function Boom() {
  throw new Error("intentional crash for fixture")
  return null
}

export function ErrorBoundaryFixture() {
  const [crashed, setCrashed] = createSignal(false)
  const [resetFn, setResetFn] = createSignal<(() => void) | null>(null)

  useKeyboard((evt) => {
    if (evt.name === "x") setCrashed(true)
    if (evt.name === "r") {
      const r = resetFn()
      setCrashed(false)
      if (r) r()
    }
  })

  return (
    <box flexDirection="column" padding={1} title="ErrorBoundary Fixture" border={true} width={60} height={12}>
      <text>Press 'x' to crash, 'r' to recover.</text>
      <text> </text>
      <ErrorBoundary
        fallback={(err: Error, reset: () => void) => {
          setResetFn(() => reset)
          return (
            <box border={true} padding={1} backgroundColor="#7f1d1d">
              <text fg="#fecaca">[error boundary] {String(err.message)}</text>
            </box>
          )
        }}
      >
        {crashed() ? <Boom /> : <text fg="#86efac">no errors here.</text>}
      </ErrorBoundary>
    </box>
  )
}
