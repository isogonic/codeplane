import { createSimpleContext } from "@codeplane-ai/ui/context"
import { type Accessor, batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { useCheckServerHealth } from "@/utils/server-health"

type StoredProject = { worktree: string; expanded: boolean }
type StoredServer = string | ServerConnection.HttpBase | ServerConnection.Http
const HEALTH_POLL_INTERVAL_MS = 10_000

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

export function serverName(conn?: ServerConnection.Any, ignoreDisplayName = false) {
  if (!conn) return ""
  if (conn.displayName && !ignoreDisplayName) return conn.displayName
  return (conn.http.remoteUrl ?? conn.http.url).replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

function projectsKey(key: ServerConnection.Key) {
  if (!key) return ""
  if (key === "sidecar") return "local"
  return key
}

function serverFromKey(key: ServerConnection.Key | undefined): ServerConnection.Http | undefined {
  if (!key) return
  if (!/^https?:\/\//.test(key)) return
  return { type: "http", http: { url: key } }
}

function loopback(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^\[(.*)\]$/, "$1")
    return host === "localhost" || host === "127.0.0.1" || host === "::1"
  } catch {
    return false
  }
}

function scopeUrl(input: string) {
  const normalized = normalizeServerUrl(input) ?? input.replace(/\/+$/, "")
  try {
    const url = new URL(normalized)
    url.username = ""
    url.password = ""
    return url.toString().replace(/\/+$/, "")
  } catch {
    return normalized.replace(/\/\/[^/@]+@/, "//")
  }
}

export namespace ServerConnection {
  type Base = { displayName?: string }

  export type HttpBase = {
    url: string
    key?: string
    remoteUrl?: string
    username?: string
    password?: string
  }

  // Regular web connections
  export type Http = {
    type: "http"
    http: HttpBase
  } & Base

  export type Sidecar = {
    type: "sidecar"
    http: HttpBase
  } & (
    | // Local sidecar server
    { variant: "base" }
    // WSL server (windows only)
    | {
        variant: "wsl"
        distro: string
      }
  ) &
    Base

  // Remote server exposed through an SSH proxy
  export type Ssh = {
    type: "ssh"
    host: string
    // SSH client exposes an HTTP server for the app to use as a proxy
    http: HttpBase
  } & Base

  export type Any =
    | Http
    // Non-HTTP connections managed by the host app
    | (Sidecar | Ssh)

  export const key = (conn: Any): Key => {
    switch (conn.type) {
      case "http":
        return Key.make(conn.http.key ?? conn.http.url)
      case "sidecar": {
        if (conn.variant === "wsl") return Key.make(`wsl:${conn.distro}`)
        return Key.make("sidecar")
      }
      case "ssh":
        return Key.make(`ssh:${conn.host}`)
    }
  }

  export type Key = string & { _brand: "Key" }
  export const Key = { make: (v: string) => v as Key }

  export type StorageScope = {
    key: string
    legacy?: boolean
  }

  export const storageScope = (conn: Any): StorageScope => {
    switch (conn.type) {
      case "http": {
        const key = conn.http.key ?? scopeUrl(conn.http.url)
        return { key, legacy: loopback(key) }
      }
      case "sidecar": {
        if (conn.variant === "wsl") return { key: `wsl:${conn.distro}` }
        return { key: "local", legacy: true }
      }
      case "ssh":
        return { key: `ssh:${conn.host}` }
    }
  }
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (props: {
    defaultServer: ServerConnection.Key
    disableHealthCheck?: boolean
    servers?: Array<ServerConnection.Any>
  }) => {
    const checkServerHealth = useCheckServerHealth()

    const [store, setStore, _, ready] = persisted(
      Persist.global("server", ["server.v3"]),
      createStore({
        list: [] as StoredServer[],
        projects: {} as Record<string, StoredProject[]>,
        lastProject: {} as Record<string, string>,
        // Basic Auth credentials captured by the in-app login screen, keyed
        // by connection key. Overlaid onto the active connection's http so
        // the SDK turns them into an `Authorization: Basic` header — exactly
        // the format every other Codeplane client (TUI/CLI/desktop/mobile)
        // already speaks, so this stays fully backwards compatible.
        credentials: {} as Record<string, { username?: string; password?: string }>,
      }),
    )

    const url = (x: StoredServer) => (typeof x === "string" ? x : "type" in x ? x.http.url : x.url)

    const withCredentials = (conn: ServerConnection.Any): ServerConnection.Any => {
      const creds = store.credentials[ServerConnection.key(conn)]
      if (!creds || (!creds.password && !creds.username)) return conn
      // Never clobber credentials that were stored on the connection itself
      // (e.g. a remote instance saved with an explicit username/password).
      if (conn.http.password) return conn
      return { ...conn, http: { ...conn.http, username: creds.username, password: creds.password } }
    }

    const allServers = createMemo((): Array<ServerConnection.Any> => {
      const servers = [
        ...(props.servers ?? []),
        ...[serverFromKey(props.defaultServer)].filter((conn): conn is ServerConnection.Http => !!conn),
        ...store.list.map((value) =>
          typeof value === "string"
            ? {
                type: "http" as const,
                http: { url: value },
              }
            : value,
        ),
      ]

      const deduped = new Map(
        servers.map((value) => {
          const conn: ServerConnection.Any = "type" in value ? value : { type: "http", http: value }
          return [ServerConnection.key(conn), withCredentials(conn)]
        }),
      )

      return [...deduped.values()]
    })

    const [state, setState] = createStore({
      active: props.defaultServer,
      healthy: undefined as boolean | undefined,
    })

    const healthy = () => state.healthy

    function startHealthPolling(conn: ServerConnection.Any) {
      let alive = true
      let busy = false

      const run = () => {
        if (busy) return
        busy = true
        void check(conn)
          .then((next) => {
            if (!alive) return
            setState("healthy", next)
          })
          .finally(() => {
            busy = false
          })
      }

      run()
      const interval = setInterval(run, HEALTH_POLL_INTERVAL_MS)
      return () => {
        alive = false
        clearInterval(interval)
      }
    }

    function setActive(input: ServerConnection.Key) {
      if (state.active !== input) setState("active", input)
    }

    function add(input: ServerConnection.Http) {
      const url_ = normalizeServerUrl(input.http.url)
      if (!url_) return
      const conn = { ...input, http: { ...input.http, url: url_ } }
      return batch(() => {
        const existing = store.list.findIndex((x) => url(x) === url_)
        if (existing !== -1) {
          setStore("list", existing, conn)
        } else {
          setStore("list", store.list.length, conn)
        }
        setState("active", ServerConnection.key(conn))
        return conn
      })
    }

    function remove(key: ServerConnection.Key) {
      const list = store.list.filter((x) => url(x) !== key)
      batch(() => {
        setStore("list", list)
        if (state.active === key) {
          const next = list[0]
          setState("active", next ? ServerConnection.Key.make(url(next)) : props.defaultServer)
        }
      })
    }

    // Persist Basic Auth credentials captured by the in-app login screen for
    // a given connection. Stored separately from the server list so it also
    // works for the embedded-origin connection (which never lives in
    // `store.list`). The credentials are overlaid by `withCredentials`.
    function authenticate(key: ServerConnection.Key, creds: { username?: string; password?: string }) {
      setStore("credentials", key, {
        username: creds.username?.trim() || undefined,
        password: creds.password,
      })
    }

    function clearCredentials(key: ServerConnection.Key) {
      setStore("credentials", key, undefined!)
    }

    const credentialsFor = (key: ServerConnection.Key) => store.credentials[key]

    const isReady = createMemo(() => ready() && !!state.active)

    const check = (conn: ServerConnection.Any) => checkServerHealth(conn.http).then((x) => x.healthy)

    createEffect(() => {
      const current_ = current()
      if (!current_) return

      if (props.disableHealthCheck) {
        setState("healthy", true)
        return
      }
      setState("healthy", undefined)
      onCleanup(startHealthPolling(current_))
    })

    const origin = createMemo(() => projectsKey(state.active))
    const projectsList = createMemo(() => store.projects[origin()] ?? [])
    const current: Accessor<ServerConnection.Any | undefined> = createMemo(
      () =>
        allServers().find((s) => ServerConnection.key(s) === state.active) ??
        serverFromKey(state.active) ??
        allServers()[0],
    )
    const isLocal = createMemo(() => {
      const c = current()
      return c?.type === "sidecar"
    })
    const scope = createMemo(() => {
      const c = current()
      if (!c) return { key: projectsKey(state.active), legacy: false }
      return ServerConnection.storageScope(c)
    })

    return {
      ready: isReady,
      healthy,
      isLocal,
      get key() {
        return state.active
      },
      get name() {
        return serverName(current())
      },
      get list() {
        return allServers()
      },
      get current() {
        return current()
      },
      get scope() {
        return scope()
      },
      setActive,
      add,
      remove,
      authenticate,
      clearCredentials,
      credentialsFor,
      projects: {
        list: projectsList,
        open(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          if (current.find((x) => x.worktree === directory)) return
          setStore("projects", key, [{ worktree: directory, expanded: true }, ...current])
        },
        close(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          setStore(
            "projects",
            key,
            current.filter((x) => x.worktree !== directory),
          )
        },
        expand(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", key, index, "expanded", true)
        },
        collapse(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", key, index, "expanded", false)
        },
        move(directory: string, toIndex: number) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const fromIndex = current.findIndex((x) => x.worktree === directory)
          if (fromIndex === -1 || fromIndex === toIndex) return
          const result = [...current]
          const [item] = result.splice(fromIndex, 1)
          result.splice(toIndex, 0, item)
          setStore("projects", key, result)
        },
        last() {
          const key = origin()
          if (!key) return
          return store.lastProject[key]
        },
        touch(directory: string) {
          const key = origin()
          if (!key) return
          setStore("lastProject", key, directory)
        },
      },
    }
  },
})
