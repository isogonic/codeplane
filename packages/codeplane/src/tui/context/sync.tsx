import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
} from "@/tui/_compat/sdk-v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "@/tui/context/project"
import { useEvent } from "@/tui/context/event"
import { useSDK } from "@/tui/context/sdk"
import { Binary } from "@/tui/_compat/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onCleanup, onMount } from "solid-js"
import * as Log from "@/util/log"
import { emptyConsoleState, type ConsoleState } from "@/config/console-state"
import path from "path"
import { useKV } from "./kv"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp_ready: boolean
      lsp: LspStatus[]
      mcp_ready: boolean
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      provider_next: {
        all: [],
        catalog: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp_ready: false,
      lsp: [],
      mcp_ready: false,
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()
    const kv = useKV()

    const fullSyncedSessions = new Set<string>()
    let syncedWorkspace = project.workspace.current()
    let eventGapBootstrap: Promise<void> | undefined
    let eventGapBootstrapQueued = false
    let eventGapTimer: Timer | undefined

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function listSessions() {
      return sdk.client.session
        .list({ start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    function runEventGapBootstrap(reason: string) {
      if (store.status === "loading") return
      if (eventGapBootstrap) {
        eventGapBootstrapQueued = true
        return
      }
      const sessionsToRefresh = [...fullSyncedSessions]
      fullSyncedSessions.clear()
      eventGapBootstrap = bootstrap({ fatal: false })
        .then(async () => {
          await Promise.all(
            sessionsToRefresh.map((sessionID) =>
              syncSessionData(sessionID, { force: true }).catch((e) => {
                Log.Default.error("tui session resync after event gap failed", {
                  reason,
                  sessionID,
                  error: e instanceof Error ? e.message : String(e),
                  name: e instanceof Error ? e.name : undefined,
                  stack: e instanceof Error ? e.stack : undefined,
                })
              }),
            ),
          )
        })
        .catch((e) => {
          Log.Default.error("tui event gap resync failed", {
            reason,
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
        })
        .finally(() => {
          eventGapBootstrap = undefined
          if (!eventGapBootstrapQueued) return
          eventGapBootstrapQueued = false
          runEventGapBootstrap(reason)
        })
    }

    function resyncAfterEventGap(reason: string) {
      if (eventGapTimer) clearTimeout(eventGapTimer)
      eventGapTimer = setTimeout(() => {
        eventGapTimer = undefined
        runEventGapBootstrap(reason)
      }, 100)
    }

    event.subscribe((event) => {
      switch (event.type) {
        case "server.connected":
          if (store.status === "complete") resyncAfterEventGap(event.type)
          break
        case "server.dropped":
        case "server.resume_failed":
          resyncAfterEventGap(event.type)
          break
        case "server.instance.disposed":
          void bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (!result.found) break
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field as keyof typeof part
              const existing = part[field] as string | undefined
              ;(part[field] as string) = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "message.part.removed": {
          const parts = store.part[event.properties.messageID]
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp
            .status({ workspace })
            .then((x) => {
              setStore("lsp", x.data ?? [])
              setStore("lsp_ready", true)
            })
            .catch((e) => {
              Log.Default.error("tui lsp event refresh failed", {
                error: e instanceof Error ? e.message : String(e),
                name: e instanceof Error ? e.name : undefined,
                stack: e instanceof Error ? e.stack : undefined,
              })
            })
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      if (workspace !== syncedWorkspace) {
        fullSyncedSessions.clear()
        syncedWorkspace = workspace
      }
      batch(() => {
        setStore("lsp_ready", false)
        setStore("mcp_ready", false)
      })
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions())

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true })
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => emptyConsoleState)
      const agentsPromise = sdk.client.app.agents({ workspace }, { throwOnError: true })
      const configPromise = sdk.client.config.get({ workspace }, { throwOnError: true })
      const blockingRequests: Promise<unknown>[] = [
        providersPromise,
        providerListPromise,
        agentsPromise,
        configPromise,
        projectPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ]

      await Promise.all(blockingRequests)
        .then(async () => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            consoleStateResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const consoleState = responses[2]
            const agents = responses[3]
            const config = responses[4]
            const sessions = responses[5]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("console_state", reconcile(consoleState))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")

          const optional = (label: string, task: Promise<unknown>) =>
            task.catch((e) => {
              Log.Default.error("tui optional bootstrap task failed", {
                label,
                error: e instanceof Error ? e.message : String(e),
                name: e instanceof Error ? e.name : undefined,
                stack: e instanceof Error ? e.stack : undefined,
              })
            })

          // non-blocking
          void Promise.all([
            ...(args.continue
              ? []
              : [
                  optional(
                    "session.list",
                    sessionListPromise.then((sessions) => setStore("session", reconcile(sessions))),
                  ),
                ]),
            optional(
              "console_state",
              consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            ),
            optional(
              "command.list",
              sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
            ),
            optional(
              "lsp.status",
              sdk.client.lsp
                .status({ workspace })
                .then((x) => {
                  setStore("lsp", reconcile(x.data ?? []))
                  setStore("lsp_ready", true)
                })
                .catch((e) => {
                  setStore("lsp", [])
                  setStore("lsp_ready", true)
                  throw e
                }),
            ),
            optional(
              "mcp.status",
              sdk.client.mcp
                .status({ workspace })
                .then((x) => {
                  setStore("mcp", reconcile(x.data ?? {}))
                  setStore("mcp_ready", true)
                })
                .catch((e) => {
                  setStore("mcp", {})
                  setStore("mcp_ready", true)
                  throw e
                }),
            ),
            optional(
              "mcp_resource.list",
              sdk.client.experimental.resource
                .list({ workspace })
                .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            ),
            optional(
              "formatter.status",
              sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data ?? []))),
            ),
            optional(
              "session.status",
              sdk.client.session.status({ workspace }).then((x) => {
                setStore("session_status", reconcile(x.data ?? {}))
              }),
            ),
            optional(
              "provider.auth",
              sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            ),
            optional(
              "vcs.get",
              sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
            ),
            optional("workspace.sync", project.workspace.sync()),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          if (fatal) {
            await exit(e)
          } else {
            throw e
          }
        })
    }

    async function syncSessionData(sessionID: string, input: { force?: boolean } = {}) {
      if (!input.force && fullSyncedSessions.has(sessionID)) return
      const [session, messages, todo, diff] = await Promise.all([
        sdk.client.session.get({ sessionID }, { throwOnError: true }),
        sdk.client.session.messages({ sessionID, limit: 100 }),
        sdk.client.session.todo({ sessionID }),
        sdk.client.session.diff({ sessionID }),
      ])
      const sessionInfo = session.data!
      const sessionMessages = messages.data ?? []
      batch(() => {
        setStore(
          "session",
          produce((draft) => {
            const match = Binary.search(draft, sessionID, (s) => s.id)
            if (match.found) draft[match.index] = sessionInfo
            if (!match.found) draft.splice(match.index, 0, sessionInfo)
          }),
        )
        setStore("todo", sessionID, reconcile(todo.data ?? [], { key: "id" }))
        setStore(
          "message",
          sessionID,
          reconcile(
            sessionMessages.map((x) => x.info),
            { key: "id" },
          ),
        )
        for (const message of sessionMessages) {
          setStore("part", message.info.id, reconcile(message.parts, { key: "id" }))
        }
        setStore("session_diff", sessionID, reconcile(diff.data ?? []))
      })
      fullSyncedSessions.add(sessionID)
    }

    onMount(() => {
      void bootstrap()
    })

    onCleanup(() => {
      if (eventGapTimer) clearTimeout(eventGapTimer)
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (process.env.CODEPLANE_FAST_BOOT) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        query() {
          return sessionListQuery()
        },
        async refresh() {
          const list = await listSessions()
          setStore("session", reconcile(list))
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string, input: { force?: boolean } = {}) {
          await syncSessionData(sessionID, input)
        },
      },
      bootstrap,
    }
    return result
  },
})
