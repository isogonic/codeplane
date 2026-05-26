import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import type { FollowupDraft } from "./submit"

let createPromptSubmit: typeof import("./submit").createPromptSubmit
let resolveFollowupDisposition: typeof import("./submit").resolveFollowupDisposition

const createdClients: string[] = []
const createdSessions: string[] = []
const enabledAutoAccept: Array<{ sessionID: string; directory: string }> = []
const optimistic: Array<{
  directory?: string
  sessionID?: string
  message: {
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
  }
}> = []
const optimisticSeeded: boolean[] = []
const storedSessions: Record<string, Array<{ id: string; title?: string }>> = {}
const promoted: Array<{ directory: string; sessionID: string }> = []
const sentShell: string[] = []
const sentPromptAsync: string[] = []
const syncedDirectories: string[] = []
const abortedSessions: string[] = []
const globalTodoUpdates: Array<{ sessionID: string; todos: unknown[] }> = []
const childTodoUpdates: Array<{ directory: string; sessionID: string; todos: unknown[] }> = []
const statusUpdates: Array<{ directory: string; sessionID: string; status: unknown }> = []

let params: { id?: string } = {}
let selected = "/repo/worktree-a"
let variant: string | undefined
let abortHold:
  | {
      promise: Promise<{ data: undefined }>
      resolve: (value: { data: undefined }) => void
    }
  | undefined

let promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]

const clientFor = (directory: string) => {
  createdClients.push(directory)
  return {
    session: {
      create: async () => {
        createdSessions.push(directory)
        return {
          data: {
            id: `session-${createdSessions.length}`,
            title: `New session ${createdSessions.length}`,
          },
        }
      },
      shell: async () => {
        sentShell.push(directory)
        return { data: undefined }
      },
      prompt: async () => ({ data: undefined }),
      promptAsync: async () => {
        sentPromptAsync.push(directory)
        return { data: undefined }
      },
      command: async () => ({ data: undefined }),
      abort: async (input: { sessionID: string }) => {
        abortedSessions.push(input.sessionID)
        if (abortHold) return abortHold.promise
        return { data: undefined }
      },
    },
    worktree: {
      create: async () => ({ data: { directory: `${directory}/new` } }),
    },
  }
}

beforeAll(async () => {
  const rootClient = clientFor("/repo/main")

  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => params,
  }))

  mock.module("@codeplane-ai/sdk/v2/client", () => ({
    createCodeplaneClient: (input: { directory: string }) => {
      createdClients.push(input.directory)
      return clientFor(input.directory)
    },
  }))

  mock.module("@codeplane-ai/ui/toast", () => ({
    showToast: () => 0,
  }))

  mock.module("@codeplane-ai/shared/util/encode", () => ({
    base64Encode: (value: string) => value,
  }))

  mock.module("@/context/local", () => ({
    useLocal: () => ({
      model: {
        current: () => ({ id: "model", provider: { id: "provider" } }),
        variant: { current: () => variant },
      },
      agent: {
        current: () => ({ name: "agent" }),
      },
      session: {
        promote(directory: string, sessionID: string) {
          promoted.push({ directory, sessionID })
        },
      },
    }),
  }))

  mock.module("@/context/permission", () => ({
    usePermission: () => ({
      enableAutoAccept(sessionID: string, directory: string) {
        enabledAutoAccept.push({ sessionID, directory })
      },
    }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => ({
      current: () => promptValue,
      reset: () => undefined,
      set: () => undefined,
      context: {
        add: () => undefined,
        remove: () => undefined,
        items: () => [],
      },
    }),
  }))

  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      handoff: {
        setTabs: () => undefined,
      },
    }),
  }))

  mock.module("@/context/sdk", () => ({
    useSDK: () => {
      const sdk = {
        directory: "/repo/main",
        client: rootClient,
        scope: { key: "local" },
        url: "http://localhost:4096",
        createClient(opts: any) {
          return clientFor(opts.directory)
        },
      }
      return sdk
    },
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => ({
      data: { command: [] },
      session: {
        optimistic: {
          add: (value: {
            directory?: string
            sessionID?: string
            message: { agent: string; model: { providerID: string; modelID: string; variant?: string } }
          }) => {
            optimistic.push(value)
            optimisticSeeded.push(
              !!value.directory &&
                !!value.sessionID &&
                !!storedSessions[value.directory]?.find((item) => item.id === value.sessionID)?.title,
            )
          },
          remove: () => undefined,
        },
      },
      set: () => undefined,
    }),
  }))

  mock.module("@/context/global-sync", () => ({
    useGlobalSync: () => ({
      todo: {
        set: (sessionID: string, todos: unknown[]) => {
          globalTodoUpdates.push({ sessionID, todos })
        },
      },
      project: {
        loadSessions: (directory: string) => {
          syncedDirectories.push(directory)
        },
      },
      child: (directory: string) => {
        syncedDirectories.push(directory)
        storedSessions[directory] ??= []
        return [
          { session: storedSessions[directory] },
          (...args: unknown[]) => {
            if (args[0] === "todo") {
              childTodoUpdates.push({
                directory,
                sessionID: args[1] as string,
                todos: args[2] as unknown[],
              })
              return
            }
            if (args[0] === "session_status") {
              statusUpdates.push({
                directory,
                sessionID: args[1] as string,
                status: args[2],
              })
              return
            }
            if (args[0] !== "session") return
            const next = args[1]
            if (typeof next === "function") {
              storedSessions[directory] = next(storedSessions[directory]) as Array<{ id: string; title?: string }>
              return
            }
            if (Array.isArray(next)) {
              storedSessions[directory] = next as Array<{ id: string; title?: string }>
            }
          },
        ]
      },
    }),
  }))

  mock.module("@/context/platform", () => ({
    usePlatform: () => ({
      fetch: fetch,
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))

  const mod = await import("./submit")
  createPromptSubmit = mod.createPromptSubmit
  resolveFollowupDisposition = mod.resolveFollowupDisposition
})

beforeEach(() => {
  createdClients.length = 0
  createdSessions.length = 0
  enabledAutoAccept.length = 0
  optimistic.length = 0
  optimisticSeeded.length = 0
  promoted.length = 0
  params = {}
  sentShell.length = 0
  sentPromptAsync.length = 0
  syncedDirectories.length = 0
  abortedSessions.length = 0
  globalTodoUpdates.length = 0
  childTodoUpdates.length = 0
  statusUpdates.length = 0
  selected = "/repo/worktree-a"
  variant = undefined
  abortHold = undefined
  promptValue = [{ type: "text", content: "ls", start: 0, end: 2 }]
  for (const key of Object.keys(storedSessions)) delete storedSessions[key]
})

describe("prompt submit worktree selection", () => {
  test("resolves follow-up behavior between send, queue, and steer", () => {
    expect(
      resolveFollowupDisposition({
        isNewSession: true,
        mode: "normal",
        working: true,
        shouldQueue: true,
      }),
    ).toBe("send")
    expect(
      resolveFollowupDisposition({
        isNewSession: false,
        mode: "shell",
        working: true,
        shouldQueue: true,
      }),
    ).toBe("send")
    expect(
      resolveFollowupDisposition({
        isNewSession: false,
        mode: "normal",
        working: false,
        shouldQueue: true,
      }),
    ).toBe("send")
    expect(
      resolveFollowupDisposition({
        isNewSession: false,
        mode: "normal",
        working: true,
        shouldQueue: true,
      }),
    ).toBe("queue")
    expect(
      resolveFollowupDisposition({
        isNewSession: false,
        mode: "normal",
        working: true,
        shouldQueue: false,
      }),
    ).toBe("steer")
  })

  test("reads the latest worktree accessor value per submit", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    selected = "/repo/worktree-b"
    await submit.handleSubmit(event)

    expect(createdClients).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(createdSessions).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(sentShell).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(syncedDirectories).toEqual([
      "/repo/worktree-a",
      "/repo/worktree-a",
      "/repo/worktree-a",
      "/repo/worktree-b",
      "/repo/worktree-b",
      "/repo/worktree-b",
    ])
    expect(promoted).toEqual([
      { directory: "/repo/worktree-a", sessionID: "session-1" },
      { directory: "/repo/worktree-b", sessionID: "session-2" },
    ])
    expect(syncedDirectories).toEqual([
      "/repo/worktree-a",
      "/repo/worktree-a",
      "/repo/worktree-a",
      "/repo/worktree-b",
      "/repo/worktree-b",
      "/repo/worktree-b",
    ])
  })

  test("applies auto-accept to newly created sessions", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(enabledAutoAccept).toEqual([{ sessionID: "session-1", directory: "/repo/worktree-a" }])
  })

  test("includes the selected variant on optimistic prompts", async () => {
    params = { id: "session-1" }
    variant = "high"

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({
      message: {
        agent: "agent",
        model: { providerID: "provider", modelID: "model", variant: "high" },
      },
    })
  })

  test("queues follow-up drafts instead of sending while queue mode is enabled", async () => {
    params = { id: "session-1" }
    const queued: FollowupDraft[] = []

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => true,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      shouldQueue: () => true,
      onQueue: (draft) => queued.push(draft),
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await Promise.resolve()
    await Promise.resolve()

    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({
      sessionID: "session-1",
      sessionDirectory: "/repo/main",
      agent: "agent",
      model: { providerID: "provider", modelID: "model" },
    })
    expect(sentPromptAsync).toEqual([])
  })

  test("sends follow-up drafts immediately while steer mode is enabled", async () => {
    params = { id: "session-1" }
    const queued: FollowupDraft[] = []
    abortHold = (() => {
      let resolve!: (value: { data: undefined }) => void
      const promise = new Promise<{ data: undefined }>((done) => {
        resolve = done
      })
      return { promise, resolve }
    })()

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => true,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      shouldQueue: () => false,
      onQueue: (draft) => queued.push(draft),
      onSubmit: () => undefined,
    })

    await Promise.resolve()
    const pending = submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await Promise.resolve()

    expect(queued).toEqual([])
    expect(abortedSessions).toEqual(["session-1"])
    expect(sentPromptAsync).toEqual([])

    abortHold.resolve({ data: undefined })
    await pending
    await Promise.resolve()
    await Promise.resolve()

    expect(sentPromptAsync).toEqual(["/repo/main"])
  })

  test("seeds new sessions before optimistic prompts are added", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(storedSessions["/repo/worktree-a"]).toEqual([{ id: "session-1", title: "New session 1" }])
    expect(optimisticSeeded).toEqual([true])
  })

  test("ignores blank submit events instead of aborting busy sessions", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "", start: 0, end: 0 }]

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => true,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(abortedSessions).toEqual([])
    expect(sentPromptAsync).toEqual([])
  })

  test("abort clears busy state and todos before the server responds", async () => {
    params = { id: "session-1" }
    abortHold = (() => {
      let resolve!: (value: { data: undefined }) => void
      const promise = new Promise<{ data: undefined }>((done) => {
        resolve = done
      })
      return { promise, resolve }
    })()
    let abortCalls = 0

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => true,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onAbort: () => {
        abortCalls += 1
      },
      onSubmit: () => undefined,
    })

    const pendingAbort = submit.abort()
    await Promise.resolve()

    expect(abortCalls).toBe(1)
    expect(abortedSessions).toEqual(["session-1"])
    expect(globalTodoUpdates).toEqual([{ sessionID: "session-1", todos: [] }])
    expect(childTodoUpdates).toEqual([{ directory: "/repo/main", sessionID: "session-1", todos: [] }])
    expect(statusUpdates).toEqual([{ directory: "/repo/main", sessionID: "session-1", status: { type: "idle" } }])

    abortHold.resolve({ data: undefined })
    await pendingAbort
  })
})
