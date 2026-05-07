/**
 * OAuth 2.0 Authorization Code + PKCE flow for the mobile app.
 *
 * Flow:
 *   1. Generate a 96-byte code_verifier (base64url, no padding) and
 *      derive its S256 code_challenge.
 *   2. Persist the verifier in transient memory keyed by `state` so
 *      we can match the redirect to the right exchange.
 *   3. Open the IdP's authorization endpoint in the system browser
 *      (`@capacitor/browser` → `SFSafariViewController` on iOS,
 *      Custom Tabs on Android). System browser is mandatory: it
 *      shares cookies with Safari/Chrome so users stay signed in
 *      across other apps that use the same IdP, and Apple rejects
 *      App Store submissions that embed login pages in WKWebView.
 *   4. Listen for the `codeplane://oauth-callback?code=&state=` deep
 *      link. Match `state`, dismiss the browser, exchange `code`
 *      for tokens at the token endpoint with the verifier.
 *   5. Persist tokens in the secure store via `ssoTokenStore`.
 *
 * Refresh: when an instance is opened later, the caller asks
 * `ensureFreshToken()` for a non-expired access token. If the cache
 * has a valid token we hand it back; if it has a refresh token we
 * try a refresh (no browser); otherwise we kick off the full flow.
 *
 * All cryptographic primitives use the WebCrypto API which is
 * available inside the Capacitor WKWebView/WebView. No third-party
 * crypto deps.
 */

import { Browser } from "@capacitor/browser"
import { App as CapApp } from "@capacitor/app"
import {
  type SSOConfig,
  type SSOTokens,
  type SSOEndpoints,
  resolveSSOEndpoints,
  defaultScopesFor,
} from "./sso-types"
import { ssoTokenStore } from "./sso-store"

/**
 * Proactive-refresh window — refresh access tokens this many seconds
 * before they expire so an in-flight request never sees a 401.
 */
const REFRESH_LEEWAY_SECONDS = 60
const STATE_BYTES = 24

/* ---------- WebCrypto helpers ---------- */

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const randomBase64Url = (n: number): string => {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

const sha256Base64Url = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return toBase64Url(new Uint8Array(digest))
}

/* ---------- pending-flow registry ---------- */

type PendingFlow = {
  config: SSOConfig
  endpoints: SSOEndpoints
  codeVerifier: string
  state: string
  resolve: (tokens: SSOTokens) => void
  reject: (err: Error) => void
  /** Fail-safe so a closed browser doesn't leave us hanging. */
  timeout: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingFlow>()

const FLOW_TIMEOUT_MS = 5 * 60 * 1000 // 5 min

/* ---------- token exchange / refresh ---------- */

const tokensFromResponse = (json: unknown): SSOTokens => {
  if (!json || typeof json !== "object") {
    throw new Error("Token endpoint returned a non-object response")
  }
  const j = json as Record<string, unknown>
  if (typeof j.access_token !== "string") {
    const err = typeof j.error_description === "string" ? j.error_description : (j.error as string) || "missing access_token"
    throw new Error(`Token exchange failed: ${err}`)
  }
  const expiresInRaw = typeof j.expires_in === "number" ? j.expires_in : 3600
  return {
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : undefined,
    idToken: typeof j.id_token === "string" ? j.id_token : undefined,
    expiresAt: Date.now() + expiresInRaw * 1000,
    tokenType: typeof j.token_type === "string" ? j.token_type : "Bearer",
    scope: typeof j.scope === "string" ? j.scope : undefined,
  }
}

const exchangeAuthCode = async (
  endpoints: SSOEndpoints,
  config: SSOConfig,
  code: string,
  codeVerifier: string,
): Promise<SSOTokens> => {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  })
  const response = await fetch(endpoints.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  })
  // Some IdPs (notably GitHub OAuth Apps) default to form-urlencoded
  // responses unless you set Accept: application/json. We did set it,
  // but if the body still isn't JSON we parse it as a query string —
  // a small concession that lets the same code work for those.
  const text = await response.text()
  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    const params = new URLSearchParams(text)
    const obj: Record<string, string> = {}
    params.forEach((v, k) => {
      obj[k] = v
    })
    json = obj
  }
  if (!response.ok) {
    const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>
    throw new Error(
      `Token endpoint returned ${response.status}: ${(j.error_description as string) ?? (j.error as string) ?? text}`,
    )
  }
  return tokensFromResponse(json)
}

const exchangeRefreshToken = async (
  endpoints: SSOEndpoints,
  config: SSOConfig,
  refreshToken: string,
): Promise<SSOTokens> => {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  })
  if (config.audience) body.set("audience", config.audience)
  const response = await fetch(endpoints.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Refresh failed (${response.status}): ${text}`)
  }
  const json = (await response.json()) as unknown
  const next = tokensFromResponse(json)
  // Some IdPs don't reissue a refresh token on refresh — keep the old
  // one in that case so the user doesn't get bumped to the browser
  // sooner than necessary.
  if (!next.refreshToken) next.refreshToken = refreshToken
  return next
}

/* ---------- callback dispatcher ---------- */

let callbackListenerAttached = false

const attachCallbackListener = () => {
  if (callbackListenerAttached) return
  callbackListenerAttached = true

  CapApp.addListener("appUrlOpen", async (event) => {
    let url: URL
    try {
      url = new URL(event.url)
    } catch {
      return
    }
    // We only handle our own scheme; everything else is for the deep-
    // links subsystem in `api.ts` to dispatch.
    if (url.protocol !== "codeplane:") return
    const path = url.pathname.replace(/^\/\//, "/")
    if (!path.startsWith("/oauth-callback") && url.host !== "oauth-callback") return

    const state = url.searchParams.get("state")
    if (!state) return
    const flow = pending.get(state)
    if (!flow) return

    // Always consume the entry, even on error, so a second callback
    // can't accidentally reuse it.
    pending.delete(state)
    clearTimeout(flow.timeout)
    Browser.close().catch(() => {})

    const error = url.searchParams.get("error")
    if (error) {
      const description = url.searchParams.get("error_description") || error
      flow.reject(new Error(`Authorization failed: ${description}`))
      return
    }
    const code = url.searchParams.get("code")
    if (!code) {
      flow.reject(new Error("Authorization callback returned no code"))
      return
    }
    try {
      const tokens = await exchangeAuthCode(flow.endpoints, flow.config, code, flow.codeVerifier)
      flow.resolve(tokens)
    } catch (err) {
      flow.reject(err as Error)
    }
  }).catch(() => {
    // App listener not available (e.g. running in the dev preview).
    // The fallback below uses postMessage on the same window.
  })

  // Web fallback — useful in the browser preview where deep links
  // can't bounce off the app shell. The picker can simulate the
  // callback by posting `{type: "codeplane:oauth-callback", url}`.
  window.addEventListener("message", async (event) => {
    if (
      !event.data ||
      typeof event.data !== "object" ||
      (event.data as Record<string, unknown>).type !== "codeplane:oauth-callback"
    ) {
      return
    }
    const raw = (event.data as Record<string, unknown>).url
    if (typeof raw !== "string") return
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return
    }
    const state = url.searchParams.get("state")
    if (!state) return
    const flow = pending.get(state)
    if (!flow) return
    pending.delete(state)
    clearTimeout(flow.timeout)
    const code = url.searchParams.get("code")
    if (!code) {
      flow.reject(new Error("Authorization callback returned no code"))
      return
    }
    try {
      const tokens = await exchangeAuthCode(flow.endpoints, flow.config, code, flow.codeVerifier)
      flow.resolve(tokens)
    } catch (err) {
      flow.reject(err as Error)
    }
  })
}

/* ---------- public API ---------- */

export type SSOAPI = {
  /**
   * Begin a fresh authorization flow. Resolves once the user comes
   * back from the IdP and we've exchanged the code for tokens.
   * Tokens are also written to the keychain at this point.
   */
  signIn: (instanceId: string, config: SSOConfig) => Promise<SSOTokens>

  /**
   * Returns a non-expired token for the given instance, refreshing
   * silently if needed. Returns `null` if SSO isn't configured for
   * this instance, or if a refresh is impossible without re-prompting
   * the user (caller decides whether to call `signIn`).
   */
  ensureFreshToken: (instanceId: string, config: SSOConfig) => Promise<SSOTokens | null>

  /** Forget the cached tokens. Optionally hits the IdP's revocation endpoint. */
  signOut: (instanceId: string, config?: SSOConfig) => Promise<void>

  /** Direct access to the cached tokens — used for the handshake to the embedded UI. */
  getStoredTokens: (instanceId: string) => Promise<SSOTokens | null>
}

export function createSSO(): SSOAPI {
  attachCallbackListener()

  const signIn: SSOAPI["signIn"] = async (instanceId, config) => {
    const endpoints = resolveSSOEndpoints(config)
    const codeVerifier = randomBase64Url(STATE_BYTES * 2)
    const codeChallenge = await sha256Base64Url(codeVerifier)
    const state = randomBase64Url(STATE_BYTES)
    const scopes = config.scopes.length ? config.scopes : defaultScopesFor(config.provider)

    const authUrl = new URL(endpoints.authorizationEndpoint)
    authUrl.searchParams.set("response_type", "code")
    authUrl.searchParams.set("client_id", config.clientId)
    authUrl.searchParams.set("redirect_uri", config.redirectUri)
    authUrl.searchParams.set("scope", scopes.join(" "))
    authUrl.searchParams.set("state", state)
    authUrl.searchParams.set("code_challenge", codeChallenge)
    authUrl.searchParams.set("code_challenge_method", "S256")
    if (config.audience) authUrl.searchParams.set("audience", config.audience)
    for (const [k, v] of Object.entries(config.extraAuthParams ?? {})) {
      authUrl.searchParams.set(k, v)
    }

    const tokens = await new Promise<SSOTokens>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(state)
        reject(new Error("Sign-in timed out"))
      }, FLOW_TIMEOUT_MS)
      pending.set(state, { config, endpoints, codeVerifier, state, resolve, reject, timeout })

      // System browser. We deliberately don't use `WebView` here —
      // App Store guideline 4.5 disallows embedded auth, and we want
      // the user to share cookies with Safari for genuine SSO.
      Browser.open({
        url: authUrl.toString(),
        presentationStyle: "popover",
        windowName: "_self",
      }).catch((err) => {
        pending.delete(state)
        clearTimeout(timeout)
        reject(err as Error)
      })
    })

    await ssoTokenStore.set(instanceId, tokens)
    return tokens
  }

  const ensureFreshToken: SSOAPI["ensureFreshToken"] = async (instanceId, config) => {
    if (!config.enabled) return null
    const cached = await ssoTokenStore.get(instanceId)
    if (cached && cached.expiresAt - Date.now() > REFRESH_LEEWAY_SECONDS * 1000) {
      return cached
    }
    if (cached?.refreshToken) {
      try {
        const endpoints = resolveSSOEndpoints(config)
        const refreshed = await exchangeRefreshToken(endpoints, config, cached.refreshToken)
        await ssoTokenStore.set(instanceId, refreshed)
        return refreshed
      } catch (err) {
        // Common cases here: refresh token expired, user revoked
        // access in the IdP, or the IdP rotated tokens and ours is
        // stale. All of these need a browser round-trip; let the
        // caller decide whether to surface a sign-in button.
        console.warn("[sso] refresh failed, falling back to interactive flow", err)
        await ssoTokenStore.clear(instanceId)
        return null
      }
    }
    return null
  }

  const signOut: SSOAPI["signOut"] = async (instanceId, config) => {
    const cached = await ssoTokenStore.get(instanceId)
    await ssoTokenStore.clear(instanceId)
    if (!cached?.accessToken || !config) return
    let endpoints: SSOEndpoints
    try {
      endpoints = resolveSSOEndpoints(config)
    } catch {
      return
    }
    if (!endpoints.revocationEndpoint) return
    try {
      await fetch(endpoints.revocationEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: cached.refreshToken ?? cached.accessToken,
          client_id: config.clientId,
        }).toString(),
      })
    } catch {
      // Best-effort. Local cache is already gone.
    }
  }

  return {
    signIn,
    ensureFreshToken,
    signOut,
    getStoredTokens: (instanceId) => ssoTokenStore.get(instanceId),
  }
}
