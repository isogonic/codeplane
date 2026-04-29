// Shared store for live bash_interactive PTY output.
//
// The codeplane backend's bash_interactive tool publishes three bus events:
//   - bash_interactive.started { sessionID, callID, command }
//   - bash_interactive.chunk   { sessionID, callID, chunk }
//   - bash_interactive.exited  { sessionID, callID, exitCode }
//
// The app's global-sdk forwards every bus event into this store via the
// pushBashInteractive*() helpers. The bash_interactive tool renderer in
// message-part.tsx reads from useBashInteractive(callID) so it can show
// the live output and offer an input bar that POSTs to the
// /global/bash-interactive/:callID/stdin endpoint.

import { createStore, produce } from "solid-js/store"

export interface BashInteractiveState {
  status: "running" | "exited"
  output: string
  exitCode?: number
  command?: string
}

const [store, setStore] = createStore<Record<string, BashInteractiveState>>({})

export function pushBashInteractiveStarted(callID: string, command: string) {
  setStore(callID, {
    status: "running",
    output: "",
    command,
  })
}

export function pushBashInteractiveChunk(callID: string, chunk: string) {
  setStore(
    produce((draft) => {
      const current = draft[callID]
      if (!current) {
        draft[callID] = { status: "running", output: chunk }
        return
      }
      current.output += chunk
    }),
  )
}

export function pushBashInteractiveExited(callID: string, exitCode: number) {
  setStore(
    produce((draft) => {
      const current = draft[callID]
      if (!current) {
        draft[callID] = { status: "exited", output: "", exitCode }
        return
      }
      current.status = "exited"
      current.exitCode = exitCode
    }),
  )
}

export function useBashInteractive(callID: () => string | undefined) {
  return () => {
    const id = callID()
    if (!id) return undefined
    return store[id]
  }
}

export function clearBashInteractive(callID: string) {
  setStore(callID, undefined as unknown as BashInteractiveState)
}
