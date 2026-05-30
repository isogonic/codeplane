import type { ServerConnection } from "@/context/server"

// Result of probing the public `/global/auth` endpoint on a server.
//   reachable     — the server answered the probe at all
//   required      — the server is password-protected
//   authenticated — the credentials we sent (if any) are valid
export type ServerAuthStatus = {
  reachable: boolean
  required: boolean
  authenticated: boolean
}

const UNREACHABLE: ServerAuthStatus = { reachable: false, required: false, authenticated: false }

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
    const res = await fetcher(`${base}/global/auth`, {
      method: "GET",
      cache: "no-store",
      credentials: credentialsFor(server),
      headers: auth ? { authorization: auth } : undefined,
      signal,
    })

    // A server that predates the discovery endpoint (or sits behind a proxy
    // that doesn't expose it) will answer non-200 here. Treat a 401 as
    // "auth required, not authenticated" so the login screen still appears;
    // any other status means the probe isn't available — fall back to
    // "reachable, no auth required" so the app proceeds as before.
    if (res.status === 401) return { reachable: true, required: true, authenticated: false }
    if (!res.ok) return { reachable: true, required: false, authenticated: true }

    const data = (await res.json().catch(() => null)) as
      | { required?: unknown; authenticated?: unknown }
      | null
    if (!data || typeof data.required !== "boolean") {
      return { reachable: true, required: false, authenticated: true }
    }
    return {
      reachable: true,
      required: data.required,
      authenticated: data.authenticated === true,
    }
  } catch {
    return UNREACHABLE
  } finally {
    if (timer) clearTimeout(timer)
  }
}
