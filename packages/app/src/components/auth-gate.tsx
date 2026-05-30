import { createResource, createSignal, type ParentProps, Show, Suspense } from "solid-js"
import { Splash } from "@codeplane-ai/ui/logo"
import { usePlatform } from "@/context/platform"
import { ServerConnection, serverName, useServer } from "@/context/server"
import { checkServerAuth } from "@/utils/server-auth"
import { LoginScreen, type LoginSubmit } from "./login-screen"

function Splashing() {
  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
      <Splash class="w-16 h-20 opacity-50 animate-pulse" />
    </div>
  )
}

// Gates the app behind the server's authentication requirement, replacing
// the browser's native Basic Auth popup with an in-app login screen.
//
// Flow: probe the public `/global/auth` endpoint. If the server doesn't
// require auth (or already accepts our stored credentials) render the app.
// Otherwise show the login screen; on submit, store the credentials on the
// active connection (which the SDK turns into an `Authorization: Basic`
// header) and re-probe.
export function AuthGate(props: ParentProps) {
  const server = useServer()
  const platform = usePlatform()
  const fetcher = platform.fetch ?? globalThis.fetch

  const [attempt, setAttempt] = createSignal(0)
  const [submitting, setSubmitting] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  const probeKey = () => {
    const current = server.current
    // Re-run whenever the active connection, its credentials, or a manual
    // retry changes.
    return {
      key: current ? ServerConnection.key(current) : "",
      url: current?.http.url ?? "",
      password: current?.http.password ?? "",
      username: current?.http.username ?? "",
      attempt: attempt(),
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

  const onSubmit = async (input: LoginSubmit) => {
    const current = server.current
    if (!current) return
    setFailed(false)
    setSubmitting(true)
    try {
      const result = await checkServerAuth(
        { url: current.http.url, username: input.username || undefined, password: input.password },
        fetcher,
        { timeoutMs: 8000 },
      )
      if (result.reachable && result.required && !result.authenticated) {
        setFailed(true)
        return
      }
      // Persist the working credentials and re-probe so the rest of the app
      // boots with them applied.
      server.authenticate(ServerConnection.key(current), {
        username: input.username || undefined,
        password: input.password,
      })
      setAttempt((n) => n + 1)
    } finally {
      setSubmitting(false)
    }
  }

  const needsLogin = () => {
    const s = status()
    if (!s) return false
    return s.reachable && s.required && !s.authenticated
  }

  return (
    <Suspense fallback={<Splashing />}>
      <Show
        when={!needsLogin()}
        fallback={
          <LoginScreen
            serverName={serverName(server.current) || server.name || server.key}
            error={failed()}
            busy={submitting()}
            onSubmit={onSubmit}
          />
        }
      >
        {props.children}
      </Show>
    </Suspense>
  )
}
