import { createResource, createSignal, Match, type ParentProps, Suspense, Switch } from "solid-js"
import { Splash } from "@codeplane-ai/ui/logo"
import { usePlatform } from "@/context/platform"
import { ServerConnection, serverName, useServer } from "@/context/server"
import { checkServerAuth, verifyTotp } from "@/utils/server-auth"
import { LoginScreen, type LoginSubmit } from "./login-screen"
import { OtpScreen } from "./otp-screen"

function Splashing() {
  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
      <Splash class="w-16 h-20 opacity-50 animate-pulse" />
    </div>
  )
}

// Gates the app behind the server's authentication requirement, replacing the
// browser's native Basic Auth popup with an in-app login flow.
//
// Two-step flow:
//   1. Probe the public `/global/auth` endpoint. If the server doesn't require
//      auth (or already accepts our stored credentials + OTP token) render the
//      app.
//   2. Otherwise show the login screen. On submit we store the password and
//      re-probe. If the server requires a TOTP second factor, the probe now
//      reports `passwordValid && !authenticated` — we show the OTP screen,
//      exchange the code for a session token at `/global/auth/verify`, store
//      it, and re-probe so the app boots fully authenticated.
export function AuthGate(props: ParentProps) {
  const server = useServer()
  const platform = usePlatform()
  const fetcher = platform.fetch ?? globalThis.fetch

  const [attempt, setAttempt] = createSignal(0)
  const [submitting, setSubmitting] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [otpFailed, setOtpFailed] = createSignal(false)

  const probeKey = () => {
    const current = server.current
    return {
      key: current ? ServerConnection.key(current) : "",
      url: current?.http.url ?? "",
      password: current?.http.password ?? "",
      username: current?.http.username ?? "",
      otpToken: current?.http.otpToken ?? "",
      attempt: attempt(),
    }
  }

  const [status] = createResource(probeKey, async (input) => {
    if (!input.url)
      return { reachable: true, required: false, authenticated: true, totpRequired: false, passwordValid: false }
    return checkServerAuth(
      {
        url: input.url,
        username: input.username || undefined,
        password: input.password || undefined,
        otpToken: input.otpToken || undefined,
      },
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
      // Wrong password — neither fully authenticated nor (when TOTP is on)
      // password-valid.
      if (result.reachable && result.required && !result.authenticated && !result.passwordValid) {
        setFailed(true)
        return
      }
      // Password accepted. Persist it; if a second factor is still required
      // the probe in the OTP step will surface it.
      server.authenticate(ServerConnection.key(current), {
        username: input.username || undefined,
        password: input.password,
      })
      setAttempt((n) => n + 1)
    } finally {
      setSubmitting(false)
    }
  }

  const onSubmitOtp = async (code: string) => {
    const current = server.current
    if (!current) return
    setOtpFailed(false)
    setSubmitting(true)
    try {
      const result = await verifyTotp(
        {
          url: current.http.url,
          username: current.http.username || undefined,
          password: current.http.password || undefined,
        },
        code,
        fetcher,
        { timeoutMs: 8000 },
      )
      if (!result.ok) {
        setOtpFailed(true)
        return
      }
      // Store the session token alongside the existing credentials and
      // re-probe so the app boots fully authenticated.
      server.authenticate(ServerConnection.key(current), {
        username: current.http.username || undefined,
        password: current.http.password,
        otpToken: result.token,
      })
      setAttempt((n) => n + 1)
    } finally {
      setSubmitting(false)
    }
  }

  const onBack = () => {
    const current = server.current
    if (!current) return
    setOtpFailed(false)
    // Drop the stored password so the flow returns to the password step.
    server.clearCredentials(ServerConnection.key(current))
    setAttempt((n) => n + 1)
  }

  const phase = (): "ok" | "password" | "otp" => {
    const s = status()
    if (!s) return "ok"
    if (!s.reachable || !s.required || s.authenticated) return "ok"
    // Password accepted but second factor still needed → OTP step.
    if (s.totpRequired && s.passwordValid) return "otp"
    return "password"
  }

  return (
    <Suspense fallback={<Splashing />}>
      <Switch fallback={props.children}>
        <Match when={phase() === "password"}>
          <LoginScreen
            serverName={serverName(server.current) || server.name || server.key}
            error={failed()}
            busy={submitting()}
            onSubmit={onSubmit}
          />
        </Match>
        <Match when={phase() === "otp"}>
          <OtpScreen
            serverName={serverName(server.current) || server.name || server.key}
            error={otpFailed()}
            busy={submitting()}
            onSubmit={onSubmitOtp}
            onBack={onBack}
          />
        </Match>
      </Switch>
    </Suspense>
  )
}
