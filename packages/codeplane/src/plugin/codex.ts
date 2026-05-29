import type { Hooks, PluginInput } from "@codeplane-ai/plugin"
import { Log } from "../util"
import { InstallationVersion } from "../installation/version"
import { OAUTH_DUMMY_KEY } from "../auth"
import os from "os"
import { setTimeout as sleep } from "node:timers/promises"
import { createServer } from "http"

const log = Log.create({ service: "plugin.codex" })

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OAUTH_PORT = 1455
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000
// Refresh slightly before expiry so a token that lapses mid-request (or under
// clock skew) doesn't produce a 401.
const TOKEN_REFRESH_MARGIN_MS = 60_000
// Model slugs the Codex backend (chatgpt.com/backend-api/codex) refuses for
// ChatGPT-account auth, returning 400 "not supported when using Codex with a
// ChatGPT account". Verified against the live backend 2026-05; the older codex
// slugs were retired there. Keep in sync as OpenAI admits/retires models —
// offering a model that hard-fails on send is worse than hiding it.
const unsupportedOAuthModels = new Set([
  "gpt-5.5-pro",
  "gpt-5-codex",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2-codex",
])

interface PkceCodes {
  verifier: string
  challenge: string
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43)
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

export interface IdTokenClaims {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  email?: string
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string
  }
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}

export function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  )
}

export function extractAccountId(tokens: TokenResponse): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token)
    const accountId = claims && extractAccountIdFromClaims(claims)
    if (accountId) return accountId
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token)
    return claims ? extractAccountIdFromClaims(claims) : undefined
  }
  return undefined
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "codeplane",
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

interface TokenResponse {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

async function exchangeCodeForTokens(code: string, redirectUri: string, pkce: PkceCodes): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }
  return response.json()
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    // A 400 here is almost always an expired/revoked refresh token (the grant
    // can't be renewed) — point the user at reconnecting rather than leaving a
    // bare status code.
    const hint = response.status === 400 ? " Your ChatGPT session may have expired — reconnect the provider." : ""
    throw new Error(`Codex token refresh failed: ${response.status}.${hint}${detail ? ` ${detail.slice(0, 200)}` : ""}`)
  }
  return response.json()
}

let inflightRefresh: Promise<TokenResponse> | undefined

// Single-flight wrapper around refreshAccessToken. When several requests see an
// expired token at once (e.g. parallel tool calls or concurrent sessions) they
// must share ONE network refresh: OpenAI rotates the refresh token on use, so
// parallel refreshes race and the losers send an already-consumed token, fail,
// and can persist a dead credential.
export function refreshTokensOnce(refreshToken: string): Promise<TokenResponse> {
  if (!inflightRefresh) {
    inflightRefresh = refreshAccessToken(refreshToken).finally(() => {
      inflightRefresh = undefined
    })
  }
  return inflightRefresh
}

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>Codeplane - Codex Authorization Successful</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #f1ecec;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to Codeplane.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>`

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head>
    <title>Codeplane - Codex Authorization Failed</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #fc533a;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
      .error {
        color: #ff917b;
        font-family: monospace;
        margin-top: 1rem;
        padding: 1rem;
        background: #3c140d;
        border-radius: 0.5rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${error}</div>
    </div>
  </body>
</html>`

interface PendingOAuth {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth: PendingOAuth | undefined

async function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  if (oauthServer) {
    return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
  }

  oauthServer = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${OAUTH_PORT}`)

    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")
      const errorDescription = url.searchParams.get("error_description")

      if (error) {
        const errorMsg = errorDescription || error
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      if (!code) {
        const errorMsg = "Missing authorization code"
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      if (!pendingOAuth || state !== pendingOAuth.state) {
        const errorMsg = "Invalid state - potential CSRF attack"
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      const current = pendingOAuth
      pendingOAuth = undefined

      exchangeCodeForTokens(code, `http://localhost:${OAUTH_PORT}/auth/callback`, current.pkce)
        .then((tokens) => current.resolve(tokens))
        .catch((err) => current.reject(err))

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(HTML_SUCCESS)
      return
    }

    if (url.pathname === "/cancel") {
      pendingOAuth?.reject(new Error("Login cancelled"))
      pendingOAuth = undefined
      res.writeHead(200)
      res.end("Login cancelled")
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  await new Promise<void>((resolve, reject) => {
    // If listen fails (e.g. port 1455 already in use by another codex login),
    // drop the cached handle so a retry can rebind — otherwise the early-return
    // above would hand back a redirect URI for a server that never listened,
    // and every subsequent attempt would hang until the 5-minute timeout.
    oauthServer!.once("error", (err) => {
      oauthServer = undefined
      reject(err)
    })
    oauthServer!.listen(OAUTH_PORT, () => {
      log.info("codex oauth server started", { port: OAUTH_PORT })
      resolve()
    })
  })

  // Keep a persistent guard so a post-startup socket error is logged instead of
  // crashing the process as an unhandled 'error' event.
  oauthServer?.on("error", (err) => log.error("codex oauth server error", { error: err }))

  return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
}

function stopOAuthServer() {
  if (oauthServer) {
    oauthServer.close(() => {
      log.info("codex oauth server stopped")
    })
    oauthServer = undefined
  }
}

function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      },
      5 * 60 * 1000,
    ) // 5 minute timeout

    pendingOAuth = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
  })
}

export async function CodexAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "openai",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        // Non-codex gpt-5.x slugs (<= 5.4) to keep for OAuth. Codex slugs are
        // kept by the `includes("codex")` rule below unless listed in
        // unsupportedOAuthModels; models > 5.4 are kept by the numeric rule.
        const allowedModels = new Set(["gpt-5.2", "gpt-5.3-codex", "gpt-5.4", "gpt-5.4-mini"])
        for (const [modelId, model] of Object.entries(provider.models)) {
          if (unsupportedOAuthModels.has(model.api.id)) {
            delete provider.models[modelId]
            continue
          }
          if (modelId.includes("codex")) continue
          if (allowedModels.has(model.api.id)) continue
          // Keep anything newer than 5.4 (incl. integer majors like a future
          // gpt-6) on the assumption newer GPTs stay Codex-compatible.
          const match = model.api.id.match(/^gpt-(\d+(?:\.\d+)?)/)
          if (match && parseFloat(match[1]) > 5.4) continue
          delete provider.models[modelId]
        }

        // Zero out costs for Codex (included with ChatGPT subscription)
        for (const model of Object.values(provider.models)) {
          model.cost = {
            input: 0,
            output: 0,
            cache: { read: 0, write: 0 },
          }

          // gpt-5.5 models temporarily have restricted context window size for codex plans
          if (model.id.includes("gpt-5.5")) {
            model.limit = {
              context: 400_000,
              input: 272_000,
              output: 128_000,
            }
          }
        }

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            // Remove dummy API key authorization header
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.delete("authorization")
                init.headers.delete("Authorization")
              } else if (Array.isArray(init.headers)) {
                init.headers = init.headers.filter(([key]) => key.toLowerCase() !== "authorization")
              } else {
                delete init.headers["authorization"]
                delete init.headers["Authorization"]
              }
            }

            const currentAuth = await getAuth()
            if (currentAuth.type !== "oauth") return fetch(requestInput, init)

            // Cast to include accountId field
            const authWithAccount = currentAuth as typeof currentAuth & { accountId?: string }

            // Check if token needs refresh (with a margin so it never lapses
            // mid-request)
            if (!currentAuth.access || currentAuth.expires - Date.now() < TOKEN_REFRESH_MARGIN_MS) {
              log.info("refreshing codex access token")
              const tokens = await refreshTokensOnce(currentAuth.refresh)
              // A refresh response may omit the rotated tokens; never overwrite
              // working credentials with undefined or the provider becomes
              // permanently unauthenticated.
              const refresh = tokens.refresh_token || currentAuth.refresh
              const access = tokens.access_token || currentAuth.access
              const expires = Date.now() + (tokens.expires_in ?? 3600) * 1000
              const newAccountId = extractAccountId(tokens) || authWithAccount.accountId
              await input.client.auth.set({
                providerID: "openai",
                auth: {
                  type: "oauth",
                  refresh,
                  access,
                  expires,
                  ...(newAccountId && { accountId: newAccountId }),
                },
              })
              currentAuth.access = access
              currentAuth.refresh = refresh
              currentAuth.expires = expires
              authWithAccount.accountId = newAccountId
            }

            // Build headers
            const headers = new Headers()
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.forEach((value, key) => headers.set(key, value))
              } else if (Array.isArray(init.headers)) {
                for (const [key, value] of init.headers) {
                  if (value !== undefined) headers.set(key, String(value))
                }
              } else {
                for (const [key, value] of Object.entries(init.headers)) {
                  if (value !== undefined) headers.set(key, String(value))
                }
              }
            }

            // Set authorization header with access token
            headers.set("authorization", `Bearer ${currentAuth.access}`)

            // Set ChatGPT-Account-Id header for organization subscriptions
            if (authWithAccount.accountId) {
              headers.set("ChatGPT-Account-Id", authWithAccount.accountId)
            }

            // Rewrite URL to Codex endpoint
            const parsed =
              requestInput instanceof URL
                ? requestInput
                : new URL(typeof requestInput === "string" ? requestInput : requestInput.url)
            const url =
              parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
                ? new URL(CODEX_API_ENDPOINT)
                : parsed

            return fetch(url, {
              ...init,
              headers,
            })
          },
        }
      },
      methods: [
        {
          label: "ChatGPT Pro/Plus (browser)",
          type: "oauth",
          authorize: async () => {
            // The browser OAuth flow uses a redirect_uri of
            // http://localhost:1455/auth/callback — the codex plugin
            // starts an HTTP server on that port to receive the
            // authorization code. If the Codeplane server itself is
            // running behind a non-loopback hostname (i.e., a remote
            // deployment the user is accessing through a reverse proxy
            // like 1i.codeplane.cc), that callback never reaches the
            // plugin: OpenAI redirects the user's browser to
            // localhost:1455 ON THE USER'S MACHINE, which has nothing
            // listening, and the pending PKCE state on the remote
            // codeplane is orphaned. Surface a clear error pointing
            // the user at the "headless" flow (paste the code manually)
            // or instruct them to authenticate via a local install.
            const serverHost = input.serverUrl.hostname
            const isLoopback =
              serverHost === "localhost" ||
              serverHost === "127.0.0.1" ||
              serverHost === "::1" ||
              serverHost.startsWith("127.")
            if (!isLoopback) {
              throw new Error(
                "ChatGPT (browser) OAuth requires the Codeplane server to be reachable at " +
                  "http://localhost:1455. This server appears to be running at a public " +
                  "address (" +
                  input.serverUrl.host +
                  "), so the OAuth callback can't reach it. Either (a) authenticate on a " +
                  "local Codeplane install — credentials sync across instances — or (b) use " +
                  '"ChatGPT Pro/Plus (headless)" below, which gives you a code to paste back.',
              )
            }

            const { redirectUri } = await startOAuthServer()
            const pkce = await generatePKCE()
            const state = generateState()
            const authUrl = buildAuthorizeUrl(redirectUri, pkce, state)

            const callbackPromise = waitForOAuthCallback(pkce, state)

            return {
              url: authUrl,
              instructions: "Complete authorization in your browser. This window will close automatically.",
              method: "auto" as const,
              callback: async () => {
                // finally: tear down the :1455 server whether auth succeeds,
                // times out, or fails the CSRF/state check — otherwise a failed
                // attempt leaves the socket bound and blocks the next login.
                try {
                  const tokens = await callbackPromise
                  const accountId = extractAccountId(tokens)
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                    accountId,
                  }
                } finally {
                  stopOAuthServer()
                }
              },
            }
          },
        },
        {
          label: "ChatGPT Pro/Plus (headless)",
          type: "oauth",
          authorize: async () => {
            const deviceResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": `codeplane/${InstallationVersion}`,
              },
              body: JSON.stringify({ client_id: CLIENT_ID }),
            })

            if (!deviceResponse.ok) throw new Error("Failed to initiate device authorization")

            const deviceData = (await deviceResponse.json()) as {
              device_auth_id: string
              user_code: string
              interval: string
              expires_in?: number | string
            }
            const interval = Math.max(parseInt(deviceData.interval) || 5, 1) * 1000
            // Stop polling once the device code expires (default 15 min) so the
            // connect dialog can't wait forever when the code is never entered.
            const expiresInMs = (Number(deviceData.expires_in) || 900) * 1000
            const deadline = Date.now() + expiresInMs

            return {
              url: `${ISSUER}/codex/device`,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto" as const,
              async callback() {
                while (true) {
                  if (Date.now() >= deadline) return { type: "failed" as const }
                  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "User-Agent": `codeplane/${InstallationVersion}`,
                    },
                    body: JSON.stringify({
                      device_auth_id: deviceData.device_auth_id,
                      user_code: deviceData.user_code,
                    }),
                  })

                  if (response.ok) {
                    const data = (await response.json()) as {
                      authorization_code: string
                      code_verifier: string
                    }

                    const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
                      method: "POST",
                      headers: { "Content-Type": "application/x-www-form-urlencoded" },
                      body: new URLSearchParams({
                        grant_type: "authorization_code",
                        code: data.authorization_code,
                        redirect_uri: `${ISSUER}/deviceauth/callback`,
                        client_id: CLIENT_ID,
                        code_verifier: data.code_verifier,
                      }).toString(),
                    })

                    if (!tokenResponse.ok) {
                      throw new Error(`Token exchange failed: ${tokenResponse.status}`)
                    }

                    const tokens: TokenResponse = await tokenResponse.json()

                    return {
                      type: "success" as const,
                      refresh: tokens.refresh_token,
                      access: tokens.access_token,
                      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                      accountId: extractAccountId(tokens),
                    }
                  }

                  if (response.status !== 403 && response.status !== 404) {
                    return { type: "failed" as const }
                  }

                  await sleep(interval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                }
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
    "chat.headers": async (input, output) => {
      if (input.model.providerID !== "openai") return
      output.headers.originator = "codeplane"
      output.headers["User-Agent"] = `codeplane/${InstallationVersion} (${os.platform()} ${os.release()}; ${os.arch()})`
      output.headers.session_id = input.sessionID
    },
    "chat.params": async (input, output) => {
      if (input.model.providerID !== "openai") return
      // Match codex cli
      output.maxOutputTokens = undefined
    },
  }
}
