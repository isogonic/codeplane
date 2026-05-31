import { createCodeplaneClient } from "@codeplane-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"

function credentialsForServer(server: ServerConnection.HttpBase): RequestCredentials | undefined {
  if (!URL.canParse(server.url)) return
  const url = new URL(server.url)
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
  if (url.protocol === "https:" && !loopback) return "include"
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

  return createCodeplaneClient({
    ...config,
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
