/**
 * ChatProvider — shared store for the `/chat` surface.
 *
 * Lives at the AppShell level (next to LayoutProvider, NotificationProvider
 * etc.) so BOTH the chat page AND the layout's sidebar panel can read/write
 * the same data. Persists everything in `localStorage` under
 * `codeplane.chat.v1`. The schema is the same one the page used to own
 * inline; we simply hoisted it so the native sidebar can consume it.
 */
import { createMemo, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@codeplane-ai/ui/context"

export type ChatRole = "user" | "assistant"

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  time: number
}

export type ChatFile = {
  name: string
  content: string
  updated: number
}

export type ChatSession = {
  id: string
  /** Backend codeplane session ID — only set after first send. */
  backendID?: string
  /** Backend directory the session lives in. */
  directory?: string
  title: string
  created: number
  updated: number
  modelID?: string
  providerID?: string
  /** Legacy local mirror of messages (pre-backend integration). */
  messages?: ChatMessage[]
  files: ChatFile[]
}

export type MemoryEntry = {
  id: string
  title: string
  content: string
  created: number
  updated: number
  /** ID of the assistant message that auto-saved this — used to dedupe. */
  sourceMessageID?: string
}

export type ChatStore = {
  sessions: ChatSession[]
  memory: MemoryEntry[]
}

const STORAGE_KEY = "codeplane.chat.v1"

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function loadStore(): ChatStore {
  if (typeof localStorage === "undefined") return { sessions: [], memory: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { sessions: [], memory: [] }
    // The store on disk may be from the old schema where `memory` was a
    // single string. Treat the parsed value as fully untyped and narrow at
    // runtime.
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const sessions = Array.isArray(parsed.sessions) ? (parsed.sessions as ChatSession[]) : []
    let memory: MemoryEntry[] = []
    const rawMemory = parsed.memory
    if (Array.isArray(rawMemory)) {
      memory = rawMemory.filter(
        (entry): entry is MemoryEntry =>
          !!entry &&
          typeof entry === "object" &&
          typeof (entry as MemoryEntry).id === "string" &&
          typeof (entry as MemoryEntry).content === "string",
      )
    } else if (typeof rawMemory === "string" && rawMemory.trim()) {
      const now = Date.now()
      memory = [
        {
          id: genId(),
          title: "Imported memory",
          content: rawMemory,
          created: now,
          updated: now,
        },
      ]
    }
    return { sessions, memory }
  } catch {
    return { sessions: [], memory: [] }
  }
}

function saveStore(store: ChatStore) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // ignore quota
  }
}

export const { use: useChat, provider: ChatProvider } = createSimpleContext({
  name: "Chat",
  init: (_props: ParentProps) => {
    const [store, setStore] = createStore<ChatStore>(loadStore())
    const persist = () => saveStore(store)

    /** All sessions sorted newest-first by `updated`. */
    const sortedSessions = createMemo(() =>
      store.sessions.slice().sort((a, b) => b.updated - a.updated),
    )

    /** Drop sessions that were never used (no backendID, no local messages). */
    const pruneEmpty = () => {
      const trimmed = store.sessions.filter((s) => {
        const hasBackend = !!s.backendID
        const hasLocalMessages = (s.messages?.length ?? 0) > 0
        return hasBackend || hasLocalMessages
      })
      if (trimmed.length !== store.sessions.length) {
        setStore("sessions", trimmed)
        persist()
      }
    }

    const newSession = (defaults?: { providerID?: string; modelID?: string; title?: string }) => {
      const session: ChatSession = {
        id: genId(),
        title: defaults?.title ?? "New chat",
        created: Date.now(),
        updated: Date.now(),
        modelID: defaults?.modelID,
        providerID: defaults?.providerID,
        files: [],
      }
      setStore("sessions", (list) => [session, ...list])
      persist()
      return session
    }

    const updateSession = (id: string, fn: (s: ChatSession) => void) => {
      setStore(
        "sessions",
        (s) => s.id === id,
        produce((s: ChatSession) => {
          fn(s)
          s.updated = Date.now()
        }),
      )
      persist()
    }

    const deleteSession = (id: string) => {
      setStore("sessions", (list) => list.filter((s) => s.id !== id))
      persist()
    }

    const addMemoryEntry = (entry?: Partial<MemoryEntry>): MemoryEntry => {
      const now = Date.now()
      const fresh: MemoryEntry = {
        id: genId(),
        title: entry?.title ?? "",
        content: entry?.content ?? "",
        created: now,
        updated: now,
        sourceMessageID: entry?.sourceMessageID,
      }
      setStore("memory", (list) => [...list, fresh])
      persist()
      return fresh
    }

    const updateMemoryEntry = (
      id: string,
      patch: Partial<Pick<MemoryEntry, "title" | "content">>,
    ) => {
      setStore(
        "memory",
        (m) => m.id === id,
        produce((m: MemoryEntry) => {
          if (patch.title !== undefined) m.title = patch.title
          if (patch.content !== undefined) m.content = patch.content
          m.updated = Date.now()
        }),
      )
      persist()
    }

    const removeMemoryEntry = (id: string) => {
      setStore("memory", (list) => list.filter((m) => m.id !== id))
      persist()
    }

    const saveFile = (sessionID: string, name: string, content: string) => {
      updateSession(sessionID, (s) => {
        const idx = s.files.findIndex((f) => f.name === name)
        const entry: ChatFile = { name, content, updated: Date.now() }
        if (idx >= 0) s.files[idx] = entry
        else s.files.push(entry)
      })
    }

    const removeFile = (sessionID: string, name: string) => {
      updateSession(sessionID, (s) => {
        s.files = s.files.filter((f) => f.name !== name)
      })
    }

    return {
      store,
      sortedSessions,
      pruneEmpty,
      newSession,
      updateSession,
      deleteSession,
      addMemoryEntry,
      updateMemoryEntry,
      removeMemoryEntry,
      saveFile,
      removeFile,
      genId,
    }
  },
})
