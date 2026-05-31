import { createResource, createSignal, onCleanup, onMount, type ParentProps, Show, Suspense } from "solid-js"
import { Splash } from "@codeplane-ai/ui/logo"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { ServerConnection, serverName, useServer } from "@/context/server"
import { checkServerAuth } from "@/utils/server-auth"
import { AuthSession } from "@/utils/auth-session"
import { ConnectScreen, type ConnectSubmit } from "./connect-screen"
import { LoginScreen, type LoginSubmit } from "./login-screen"

function Splashing() {
  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
      <Splash class="w-16 h-20 opacity-50 animate-pulse" />
    </div>
  )
}

// Gates the app behind connect + authentication, with three phases:
//
//   connect → no server chosen yet (or the host shell didn't pick one).
//             Show the smart "local / IP / domain" field; on submit we add
//             the connection and advance.
//   login   → the server requires auth and we're not authenticated. Show the
//             password screen; on submit we store credentials and re-probe.
//   ok      → reachable + authenticated (or no auth required) → render the app.
//
// Two behaviors make this "remember and re-prompt":
//   * Credentials are persisted per connection (server.authenticate), so a
//     reload reconnects automatically without re-typing.
//   * A mid-session 401 (reported by the SDK via AuthSession) flips the gate
//     back to the login phase for that connection — the user is told to log
//     in again and the app is blocked until they do, instead of silently
//     failing requests.
//
// "Only writable when not logged in": the connect field (URL) is only shown /
// editable in the connect phase. Once connected + authenticated it's locked
// away behind the running app; an expiry re-opens the login (not connect)
// step so the address stays put but the credentials must be re-entered.
export function AuthGate(props: ParentProps) {
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const fetcher = platform.fetch ?? globalThis.fetch
  // The desktop/mobile shells inject the server list + active key, so the
  // connect step is only for plain-web users who land without one.
  const shellManaged = !!platform.serverManager

  const [attempt, setAttempt] = createSignal(0)
  const [submitting, setSubmitting] = createSignal(false)
  const [loginFailed, setLoginFailed] = createSignal(false)
  const [connectFailed, setConnectFailed] = createSignal(false)
  // Bumped when a mid-session 401 fires for the active connection.
  const [expiredTick, setExpiredTick] = createSignal(0)

  // Re-show the login screen when the SDK reports an expired session for the
  // connection we're currently on.
  onMount(() => {
    const unsub = AuthSession.subscribe((key) => {
      const current = server.current
      if (current && ServerConnection.key(current) === key) {
        setExpiredTick((n) => n + 1)
      }
    })
    onCleanup(unsub)
  })

  const probeKey = () => {
    const current = server.current
    return {
      key: current ? ServerConnection.key(current) : "",
      url: current?.http.url ?? "",
      password: current?.http.password ?? "",
      username: current?.http.username ?? "",
      attempt: attempt(),
      expired: expiredTick(),
    }
  }

  const [status] = createResource(probeKey, async (input) => {
    if (!input.url) return { reachable: true, required: false, authenticated: true }
    return checkServerAuth(
      { url: input.url, username: input.username || undefined, password: input.password || undefined },
      fetcher,
      { timeoutMs: 8000 },
    )
  })

  const onConnect = async (input: ConnectSubmit) => {
    setConnectFailed(false)
    setSubmitting(true)
    try {
      const status = await checkServerAuth({ url: input.url }, fetcher, { timeoutMs: 8000 })
      if (!status.reachable) {
        setConnectFailed(true)
        return
      }
      // Remember the server and make it active. The next probe decides whether
      // a login step is needed.
      const conn = server.add({ type: "http", displayName: input.label, http: { url: input.url } })
      if (conn) server.setActive(ServerConnection.key(conn))
      void platform.setDefaultServer?.(ServerConnection.Key.make(input.url))
      setAttempt((n) => n + 1)
    } finally {
      setSubmitting(false)
    }
  }

  const onLogin = async (input: LoginSubmit) => {
    const current = server.current
    if (!current) return
    setLoginFailed(false)
    setSubmitting(true)
    try {
      const result = await checkServerAuth(
        { url: current.http.url, username: input.username || undefined, password: input.password },
        fetcher,
        { timeoutMs: 8000 },
      )
      if (result.reachable && result.required && !result.authenticated) {
        setLoginFailed(true)
        return
      }
      // Persist working credentials, clear any expiry, and re-probe so the app
      // boots with them applied.
      server.authenticate(ServerConnection.key(current), {
        username: input.username || undefined,
        password: input.password,
      })
      AuthSession.clear(ServerConnection.key(current))
      setAttempt((n) => n + 1)
    } finally {
      setSubmitting(false)
    }
  }

  const phase = (): "connect" | "login" | "ok" => {
    const current = server.current
    // No connection yet, on plain web → ask where to connect.
    if (!shellManaged && (!current || !current.http.url)) return "connect"
    const s = status()
    if (!s) return "ok"
    if (!s.reachable) return "ok" // ConnectionGate handles unreachable.
    // A mid-session expiry forces the login step even if the probe response is
    // momentarily stale.
    const expired = AuthSession.isExpired(current ? ServerConnection.key(current) : undefined)
    if (s.required && (!s.authenticated || expired)) return "login"
    return "ok"
  }

  return (
    <Suspense fallback={<Splashing />}>
      <Show when={phase() !== "connect"} fallback={<ConnectScreen error={connectFailed()} busy={submitting()} onSubmit={onConnect} />}>
        <Show
          when={phase() !== "login"}
          fallback={
            <LoginScreen
              serverName={serverName(server.current) || server.name || server.key}
              error={loginFailed()}
              busy={submitting()}
              notice={
                AuthSession.isExpired(server.current ? ServerConnection.key(server.current) : undefined)
                  ? language.t("login.expired")
                  : undefined
              }
              onSubmit={onLogin}
            />
          }
        >
          {props.children}
        </Show>
      </Show>
    </Suspense>
  )
}
