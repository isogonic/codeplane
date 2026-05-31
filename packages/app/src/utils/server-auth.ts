import type { ServerConnection } from "@/context/server"

// Result of probing the public `/global/auth` endpoint on a server.
//   reachable     — the server answered the probe at all
//   required      — the server is password-protected
//   authenticated — fully authenticated (password AND, if enabled, second factor)
//   totpRequired  — the server requires a TOTP second factor
//   passwordValid — the password we sent is correct (only the OTP step remains)
export type ServerAuthStatus = {
  reachable: boolean
  required: boolean
  authenticated: boolean
  totpRequired: boolean
  passwordValid: boolean
}

const UNREACHABLE: ServerAuthStatus = {
  reachable: false,
  required: false,
  authenticated: false,
  totpRequired: false,
  passwordValid: false,
}

function basicAuthHeader(server: ServerConnection.HttpBase): string | undefined {
  if (!server.password) return
  return `Basic ${btoa(`${server.username ?? "codeplane"}:${server.password}`)}`
}

function credentialsFor(server: ServerConnection.HttpBase): RequestCredentials | undefined {
  if (!URL.canParse(server.url)) return
  const url = new URL(server.url)
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
  if (url.protocol === "https:" && !loopback) return "include"
}

// Probe whether a server requires authentication and whether the provided
// credentials satisfy it. This drives the in-app login screen so the
// browser's native Basic Auth popup never has to appear. The endpoint is
// intentionally public (served ahead of the auth gate), so a reachable
// server always answers 200 with `{ required, authenticated }`.
export async function checkServerAuth(
  server: ServerConnection.HttpBase,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<ServerAuthStatus> {
  if (!URL.canParse(server.url)) return UNREACHABLE
  const base = server.url.replace(/\/+$/, "")
  const auth = basicAuthHeader(server)

  const controller = opts?.signal ? undefined : new AbortController()
  const timer =
    controller && opts?.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined
  const signal = opts?.signal ?? controller?.signal

  try {
    const headers: Record<string, string> = {}
    if (auth) headers.authorization = auth
    if (server.otpToken) headers["x-codeplane-otp"] = server.otpToken
    const res = await fetcher(`${base}/global/auth`, {
      method: "GET",
      cache: "no-store",
      credentials: credentialsFor(server),
      headers: Object.keys(headers).length ? headers : undefined,
      signal,
    })

    // A server that predates the discovery endpoint (or sits behind a proxy
    // that doesn't expose it) will answer non-200 here. Treat a 401 as
    // "auth required, not authenticated" so the login screen still appears;
    // any other status means the probe isn't available — fall back to
    // "reachable, no auth required" so the app proceeds as before.
    if (res.status === 401)
      return { reachable: true, required: true, authenticated: false, totpRequired: false, passwordValid: false }
    if (!res.ok)
      return { reachable: true, required: false, authenticated: true, totpRequired: false, passwordValid: false }

    const data = (await res.json().catch(() => null)) as
      | { required?: unknown; authenticated?: unknown; totpRequired?: unknown; passwordValid?: unknown }
      | null
    if (!data || typeof data.required !== "boolean") {
      return { reachable: true, required: false, authenticated: true, totpRequired: false, passwordValid: false }
    }
    const totpRequired = data.totpRequired === true
    return {
      reachable: true,
      required: data.required,
      authenticated: data.authenticated === true,
      totpRequired,
      // The probe reports passwordValid explicitly when TOTP is on; otherwise
      // a fully-authenticated result means the password was accepted.
      passwordValid: data.passwordValid === true || (!totpRequired && data.authenticated === true),
    }
  } catch {
    return UNREACHABLE
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// Exchange a valid password + TOTP code for a second-factor session token.
// Returns the token on success, or an error reason the UI can show.
export type VerifyTotpResult =
  | { ok: true; token: string }
  | { ok: false; reason: "invalid-code" | "unauthorized" | "rate-limited" | "unreachable" | "disabled" }

export async function verifyTotp(
  server: ServerConnection.HttpBase,
  code: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<VerifyTotpResult> {
  if (!URL.canParse(server.url)) return { ok: false, reason: "unreachable" }
  const base = server.url.replace(/\/+$/, "")
  const auth = basicAuthHeader(server)
  if (!auth) return { ok: false, reason: "unauthorized" }

  const controller = opts?.signal ? undefined : new AbortController()
  const timer =
    controller && opts?.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined
  const signal = opts?.signal ?? controller?.signal

  try {
    const res = await fetcher(`${base}/global/auth/verify`, {
      method: "POST",
      cache: "no-store",
      credentials: credentialsFor(server),
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ code: code.replace(/\s+/g, "") }),
      signal,
    })
    if (res.status === 429) return { ok: false, reason: "rate-limited" }
    if (res.status === 400) return { ok: false, reason: "disabled" }
    if (res.status === 401) {
      const body = (await res.json().catch(() => null)) as { totp?: unknown } | null
      return { ok: false, reason: body?.totp === true ? "invalid-code" : "unauthorized" }
    }
    if (!res.ok) return { ok: false, reason: "unreachable" }
    const data = (await res.json().catch(() => null)) as { token?: unknown } | null
    if (!data || typeof data.token !== "string") return { ok: false, reason: "unreachable" }
    return { ok: true, token: data.token }
  } catch {
    return { ok: false, reason: "unreachable" }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
