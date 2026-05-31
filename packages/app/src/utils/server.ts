import { createCodeplaneClient } from "@codeplane-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"
import { AuthSession } from "./auth-session"

function credentialsForServer(server: ServerConnection.HttpBase): RequestCredentials | undefined {
  if (!URL.canParse(server.url)) return
  const url = new URL(server.url)
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
  if (url.protocol === "https:" && !loopback) return "include"
}

// Wrap a fetch so that a 401 on a request we sent credentials for is reported
// as a session expiry for this connection. The AuthGate listens and re-shows
// the login screen mid-session instead of letting requests silently fail.
// Only fires when we actually presented auth (had a password / otp token), so
// the initial unauthenticated probe handshake doesn't trigger it.
function wrapFetchForAuth(
  base: typeof globalThis.fetch,
  key: string | undefined,
  hadAuth: boolean,
): typeof globalThis.fetch {
  if (!hadAuth || !key) return base
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await base(input, init)
    if (response.status === 401) AuthSession.reportExpired(key)
    return response
  }) as typeof globalThis.fetch
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createCodeplaneClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${btoa(`${server.username ?? "codeplane"}:${server.password}`)}`,
    }
  })()
  // Second-factor session token, sent as a custom header so the server's auth
  // gate can satisfy the TOTP requirement without re-prompting per request.
  const otp = server.otpToken ? { "x-codeplane-otp": server.otpToken } : undefined
  const credentials = config.credentials ?? credentialsForServer(server)
  const hadAuth = !!server.password
  const baseFetch = config.fetch ?? globalThis.fetch

  return createCodeplaneClient({
    ...config,
    fetch: wrapFetchForAuth(baseFetch, server.key ?? server.url, hadAuth),
    credentials,
    headers: {
      ...(credentials === "include" ? { "Content-Type": "text/plain" } : {}),
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
      ...otp,
    },
    baseUrl: server.url,
  })
}
