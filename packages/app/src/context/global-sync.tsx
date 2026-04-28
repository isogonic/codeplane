import type {
  Config,
  CodeplaneClient,
  Path,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  Session,
  Todo,
} from "@codeplane-ai/sdk/v2/client"
import { showToast } from "@codeplane-ai/ui/toast"
import { getFilename } from "@codeplane-ai/shared/util/path"
import { retry } from "@codeplane-ai/shared/util/retry"
import { batch, createContext, getOwner, onCleanup, onMount, type ParentProps, untrack, useContext } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { InitError } from "../pages/error"
import { useGlobalSDK } from "./global-sdk"
import { bootstrapDirectory, bootstrapGlobal, clearProviderRev } from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches } from "./global-sync/event-reducer"
import { createRefreshQueue } from "./global-sync/queue"
import { cachedSessionIDs } from "./global-sync/session-cache"
import { clearSessionPrefetchDirectory } from "./global-sync/session-prefetch"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import type { ProjectMeta } from "./global-sync/types"
import { SESSION_ALL_LIMIT, SESSION_RECENT_LIMIT } from "./global-sync/types"
import { formatServerError } from "@/utils/server-errors"
import { diffs as listDiffs } from "@/utils/diffs"
import { queryOptions, skipToken, useQueryClient } from "@tanstack/solid-query"
import { useServer } from "./server"

type GlobalStore = {
  ready: boolean
  error?: InitError
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: ProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

export const loadSessionsQuery = (directory: string, scope = "default") =>
  queryOptions<null>({ queryKey: [scope, directory, "loadSessions"], queryFn: skipToken })

function createGlobalSync() {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const server = useServer()
  const scope = server.scope
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSync must be created within owner")

  const sdkCache = new Map<string, CodeplaneClient>()
  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const diffLoads = new Map<string, Promise<void>>()

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    ready: false,
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    project: [],
    session_todo: {},
    provider: { all: [], catalog: [], connected: [], default: {} },
    provider_auth: {},
    config: {},
    reload: undefined,
  })
  const queryClient = useQueryClient()

  let bootedAt = 0
  let bootingRoot = false
  let eventFrame: number | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (eventFrame !== undefined) cancelAnimationFrame(eventFrame)
    if (eventTimer !== undefined) clearTimeout(eventTimer)
  })

  const setProjects = (next: Project[] | ((draft: Project[]) => Project[])) => {
    setGlobalStore("project", next)
  }

  const setBootStore = ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjects(input[1] as Project[])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => Project[]))
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const setSessionTodo = (sessionID: string, todos: Todo[] | undefined) => {
    if (!sessionID) return
    if (!todos) {
      setGlobalStore(
        "session_todo",
        produce((draft) => {
          delete draft[sessionID]
        }),
      )
      return
    }
    setGlobalStore("session_todo", sessionID, reconcile(todos, { key: "id" }))
  }

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    bootstrap,
    bootstrapInstance,
  })

  const children = createChildStoreManager({
    owner,
    scope: () => scope,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onDispose: (directory) => {
      queue.clear(directory)
      sdkCache.delete(directory)
      clearProviderRev(scope.key, directory)
      clearSessionPrefetchDirectory(scope.key, directory)
    },
    translate: language.t,
  })

  const sdkFor = (directory: string) => {
    const cached = sdkCache.get(directory)
    if (cached) return cached
    const sdk = globalSDK.createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(directory, sdk)
    return sdk
  }

  async function loadSessions(directory: string, options?: { all?: boolean; force?: boolean }) {
    const pending = sessionLoads.get(directory)
    if (pending && !options?.force && !options?.all) return pending
    if (pending) await pending.catch(() => undefined)

    children.pin(directory)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    if (options?.force || options?.all) {
      await queryClient.invalidateQueries({ queryKey: loadSessionsQuery(directory, scope.key).queryKey })
    }

    const loadedRootCount = store.session.filter((session) => !session.parentID && !session.time?.archived).length
    const fetchLimit = options?.all
      ? SESSION_ALL_LIMIT
      : Math.max(store.limit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT, loadedRootCount)
    const loadChildren = (
      parents: Session[],
      seen = new Set(parents.map((session) => session.id)),
    ): Promise<Session[]> =>
      Promise.all(
        parents.map((parent) =>
          retry(() => globalSDK.client.session.children({ directory, sessionID: parent.id }))
            .then((x) =>
              (x.data ?? [])
                .filter((s): s is Session => !!s?.id)
                .filter((session) => !session.time?.archived)
                .filter((session) => {
                  if (seen.has(session.id)) return false
                  seen.add(session.id)
                  return true
                }),
            )
            .catch(() => [] as Session[]),
        ),
      ).then((results) => {
        const childSessions = results.flat()
        if (childSessions.length === 0) return []
        return loadChildren(childSessions, seen).then((nested) => [...childSessions, ...nested])
      })
    const promise = queryClient
      .fetchQuery({
        ...loadSessionsQuery(directory, scope.key),
        queryFn: () =>
          (options?.all
            ? globalSDK.client.session.list({ directory, limit: SESSION_ALL_LIMIT }).then((result) => ({
                data: result.data,
                includesChildren: true as const,
                limit: SESSION_ALL_LIMIT,
                limited: true,
              }))
            : loadRootSessionsWithFallback({
                directory,
                limit: fetchLimit,
                list: (query) => globalSDK.client.session.list(query),
              }).then((result) => ({
                ...result,
                includesChildren: false as const,
              })))
            .then(async (x) => {
              const listed = (x.data ?? []).filter(
                (s): s is Session => !!s?.id && !s.time?.archived,
              )
              const nonArchived = x.includesChildren ? listed.filter((s) => !s.parentID) : listed
              const existingRoots =
                !options?.all && x.limit !== undefined && nonArchived.length >= x.limit
                  ? store.session.filter((s) => !s.parentID && !s.time?.archived)
                  : []
              const rootSessions = [...nonArchived, ...existingRoots].filter(
                (session, index, list) => list.findIndex((item) => item.id === session.id) === index,
              )
              const preserve = cachedSessionIDs(store)
              const preservedSessions = store.session.filter((s) => preserve.has(s.id))
              const childSessions = store.session.filter((s) => !!s.parentID)
              if (x.includesChildren) {
                const sessions = [...listed, ...preservedSessions].filter(
                  (session, index, list) => list.findIndex((item) => item.id === session.id) === index,
                )
                batch(() => {
                  setStore("sessionTotal", rootSessions.length)
                  setStore("limit", rootSessions.length)
                  setStore("session", reconcile(sessions, { key: "id" }))
                  cleanupDroppedSessionCaches(store, setStore, sessions, setSessionTodo, preserve)
                })
                return
              }
              const sessionLimit = store.limit
              const applySessions = (loadedChildren: Session[]) => {
                const loadedChildIDs = new Set(loadedChildren.map((session) => session.id))
                const sessions = trimSessions(
                  [
                    ...rootSessions,
                    ...childSessions.filter((session) => !loadedChildIDs.has(session.id)),
                    ...loadedChildren,
                    ...preservedSessions,
                  ],
                  {
                    limit: sessionLimit,
                    permission: store.permission,
                    preserve,
                  },
                )
                batch(() => {
                  setStore(
                    "sessionTotal",
                    estimateRootSessionTotal({
                      count: nonArchived.length,
                      limit: x.limit,
                      limited: x.limited,
                    }),
                  )
                  if (options?.all) setStore("limit", sessionLimit)
                  setStore("session", reconcile(sessions, { key: "id" }))
                  cleanupDroppedSessionCaches(store, setStore, sessions, setSessionTodo, preserve)
                })
              }
              applySessions([])
              applySessions(await loadChildren(rootSessions))
            })
            .catch((err) => {
              console.error("Failed to load sessions", err)
              const project = getFilename(directory)
              showToast({
                variant: "error",
                title: language.t("toast.session.listFailed.title", { project }),
                description: formatServerError(err, language.t),
              })
            })
            .then(() => null),
      })
      .then(() => {})

    sessionLoads.set(directory, promise)
    void promise.finally(() => {
      sessionLoads.delete(directory)
      children.unpin(directory)
    })
    return promise
  }

  async function loadSessionDiff(directory: string, sessionID: string, options?: { force?: boolean }) {
    const [store, setStore] = children.child(directory, { bootstrap: false })
    const cached = store.session_diff[sessionID]
    if (cached !== undefined && (!options?.force || cached.length > 0)) return

    const key = `${directory}\n${sessionID}`
    const pending = diffLoads.get(key)
    if (pending) return pending

    children.pin(directory)
    const promise = sdkFor(directory)
      .session.diff({ sessionID })
      .then((x) => {
        if (!children.children[directory]) return
        setStore("session_diff", sessionID, reconcile(listDiffs(x.data), { key: "file" }))
      })
      .finally(() => {
        diffLoads.delete(key)
        children.unpin(directory)
      })
    diffLoads.set(key, promise)
    return promise
  }

  async function bootstrapInstance(directory: string) {
    if (!directory) return
    const pending = booting.get(directory)
    if (pending) return pending

    children.pin(directory)
    const promise = Promise.resolve().then(async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(directory)
      if (!cache) return
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        scope: scope.key,
        directory,
        global: {
          config: globalStore.config,
          path: globalStore.path,
          project: globalStore.project,
          provider: globalStore.provider,
        },
        sdk,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        loadSessions,
        translate: language.t,
        queryClient,
      })
    })

    booting.set(directory, promise)
    void promise.finally(() => {
      booting.delete(directory)
      children.unpin(directory)
    })
    return promise
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name
    const event = e.details
    const recent = bootingRoot || Date.now() - bootedAt < 1500

    if (event.type === "session.error") {
      const error = event.properties.error
      if (error?.name !== "MessageAbortedError") {
        console.error("[global-sync] session error", {
          scope: directory === "global" ? "global" : "workspace",
          directory: directory === "global" ? undefined : directory,
          project: directory === "global" ? undefined : getFilename(directory),
          sessionID: event.properties.sessionID,
          error,
        })
      }
    }

    if (directory === "global") {
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (recent) return
          queue.refresh()
        },
        setGlobalProject: setProjects,
      })
      if (event.type === "server.connected" || event.type === "global.disposed") {
        if (recent) return
        for (const directory of Object.keys(children.children)) {
          queue.push(directory)
        }
      }
      return
    }

    const existing = children.children[directory]
    if (!existing) return
    children.mark(directory)
    const [store, setStore] = existing
    applyDirectoryEvent({
      event,
      directory,
      store,
      setStore,
      push: queue.push,
      setSessionTodo,
      vcsCache: children.vcsCache.get(directory),
      loadLsp: () => {
        void sdkFor(directory)
          .lsp.status()
          .then((x) => {
            setStore("lsp", x.data ?? [])
            setStore("lsp_ready", true)
          })
      },
    })
  })

  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directory)
    }
  })

  async function bootstrap() {
    bootingRoot = true
    try {
      await bootstrapGlobal({
        scope: scope.key,
        globalSDK: globalSDK.client,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
        queryClient,
      })
      bootedAt = Date.now()
    } finally {
      bootingRoot = false
    }
  }

  onMount(() => {
    if (typeof requestAnimationFrame === "function") {
      eventFrame = requestAnimationFrame(() => {
        eventFrame = undefined
        eventTimer = setTimeout(() => {
          eventTimer = undefined
          void globalSDK.event.start()
        }, 0)
      })
    } else {
      eventTimer = setTimeout(() => {
        eventTimer = undefined
        void globalSDK.event.start()
      }, 0)
    }
    void bootstrap()
  })

  const projectApi = {
    loadSessions,
    loadSessionDiffs(directory: string, sessionIDs: string[], options?: { force?: boolean }) {
      return Promise.all(
        [...new Set(sessionIDs)].map((sessionID) => loadSessionDiff(directory, sessionID, options)),
      ).then(() => undefined)
    },
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const updateConfig = async (config: Config) => {
    setGlobalStore("reload", "pending")
    return globalSDK.client.global.config
      .update({ config })
      .then(bootstrap)
      .then(() => {
        queue.refresh()
        setGlobalStore("reload", undefined)
        queue.refresh()
      })
      .catch((error) => {
        setGlobalStore("reload", undefined)
        throw error
      })
  }

  return {
    data: globalStore,
    set,
    get ready() {
      return globalStore.ready
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    peek: children.peek,
    bootstrap,
    updateConfig,
    project: projectApi,
    todo: {
      set: setSessionTodo,
    },
  }
}

const GlobalSyncContext = createContext<ReturnType<typeof createGlobalSync>>()

export function GlobalSyncProvider(props: ParentProps) {
  const value = createGlobalSync()
  return <GlobalSyncContext.Provider value={value}>{props.children}</GlobalSyncContext.Provider>
}

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext)
  if (!context) throw new Error("useGlobalSync must be used within GlobalSyncProvider")
  return context
}
