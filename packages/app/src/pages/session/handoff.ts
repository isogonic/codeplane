import type { SelectedLineRange } from "@/context/file"

type HandoffSession = {
  prompt: string
  files: Record<string, SelectedLineRange | null>
}

const MAX = 40

const store = {
  session: new Map<string, HandoffSession>(),
  terminal: new Map<string, string[]>(),
}

const scoped = (scope: string, key: string) => `${scope}\n${key}`

const touch = <K, V>(map: Map<K, V>, key: K, value: V) => {
  map.delete(key)
  map.set(key, value)
  while (map.size > MAX) {
    const first = map.keys().next().value
    if (first === undefined) return
    map.delete(first)
  }
}

export const setSessionHandoff = (scope: string, key: string, patch: Partial<HandoffSession>) => {
  const id = scoped(scope, key)
  const prev = store.session.get(id) ?? { prompt: "", files: {} }
  touch(store.session, id, { ...prev, ...patch })
}

export const getSessionHandoff = (scope: string, key: string) => store.session.get(scoped(scope, key))

export const setTerminalHandoff = (scope: string, key: string, value: string[]) => {
  touch(store.terminal, scoped(scope, key), value)
}

export const getTerminalHandoff = (scope: string, key: string) => store.terminal.get(scoped(scope, key))
