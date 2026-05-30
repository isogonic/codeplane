import { createConnection } from "net"
import { createServer } from "http"
import { Log } from "../util"
import { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH, parseRedirectUri } from "./oauth-provider"

const log = Log.create({ service: "mcp.oauth-callback" })

// The OAuth authorization server is untrusted (it controls the redirect back to
// this loopback callback). `error`/`error_description` are attacker-controllable
// query params that were interpolated raw into the HTML error page — a reflected
// XSS executing in the loopback origin. Escape before embedding.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Current callback server configuration (may differ from defaults if custom redirectUri is used)
let currentPort = OAUTH_CALLBACK_PORT
let currentPath = OAUTH_CALLBACK_PATH

const HTML_SUCCESS = `<!DOCTYPE html>
<html>
<head>
  <title>Codeplane - Authorization Successful</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 1rem; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Successful</h1>
    <p>You can close this window and return to Codeplane.</p>
  </div>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`

const HTML_ERROR = (error: string) => `<!DOCTYPE html>
<html>
<head>
  <title>Codeplane - Authorization Failed</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #f87171; margin-bottom: 1rem; }
    p { color: #aaa; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Failed</h1>
    <p>An error occurred during authorization.</p>
    <div class="error">${escapeHtml(error)}</div>
  </div>
</body>
</html>`

interface PendingAuth {
  resolve: (code: string) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

let server: ReturnType<typeof createServer> | undefined
// In-flight start, so concurrent ensureRunning() calls don't each create a
// server (check-then-act race across the awaits below).
let starting: Promise<void> | undefined
const pendingAuths = new Map<string, PendingAuth>()
// Reverse index: caller-provided cancel key -> oauthState, so cancelPending()
// can find the right entry in pendingAuths (which is keyed by oauthState).
const cancelKeyToState = new Map<string, string>()

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

function cleanupStateIndex(oauthState: string) {
  for (const [name, state] of cancelKeyToState) {
    if (state === oauthState) {
      cancelKeyToState.delete(name)
      break
    }
  }
}

export type CallbackOutcome = { kind: "success" } | { kind: "error"; status: 200 | 400; message: string }

// Resolve (or reject) the pending OAuth flow identified by `state`. This is the
// single source of truth shared by every callback entrypoint — the loopback
// HTTP server (desktop / local CLI) AND the server-hosted route
// `GET /mcp/oauth/callback` (which is reachable from web + mobile browsers
// talking to a remote instance, where 127.0.0.1 loopback never could be).
//
// Security: the flow is keyed by an unguessable 32-byte random `state`, so an
// attacker who hits this endpoint without the legitimate state can't complete
// or hijack a flow. Provider errors reject with HTTP 200 (the auth server
// controls the redirect and a 4xx would be misleading); CSRF / shape problems
// return 400.
export function resolveCallback(input: {
  code?: string | null
  state?: string | null
  error?: string | null
  errorDescription?: string | null
}): CallbackOutcome {
  const { code, state, error, errorDescription } = input

  log.info("received oauth callback", { hasCode: !!code, state, error })

  if (!state) {
    log.error("oauth callback missing state parameter")
    return { kind: "error", status: 400, message: "Missing required state parameter - potential CSRF attack" }
  }

  if (error) {
    const errorMsg = errorDescription || error
    const pending = pendingAuths.get(state)
    if (pending) {
      clearTimeout(pending.timeout)
      pendingAuths.delete(state)
      cleanupStateIndex(state)
      pending.reject(new Error(errorMsg))
    }
    return { kind: "error", status: 200, message: errorMsg }
  }

  if (!code) {
    return { kind: "error", status: 400, message: "No authorization code provided" }
  }

  const pending = pendingAuths.get(state)
  if (!pending) {
    log.error("oauth callback with invalid state", { state, pendingStates: Array.from(pendingAuths.keys()) })
    return { kind: "error", status: 400, message: "Invalid or expired state parameter - potential CSRF attack" }
  }

  clearTimeout(pending.timeout)
  pendingAuths.delete(state)
  cleanupStateIndex(state)
  pending.resolve(code)

  return { kind: "success" }
}

// Map a callback query string to the HTTP response (status + HTML body) that
// every entrypoint serves. Centralizing this keeps the loopback server and the
// server-hosted route byte-for-byte identical.
export function handleCallbackQuery(searchParams: URLSearchParams): { status: number; body: string } {
  const outcome = resolveCallback({
    code: searchParams.get("code"),
    state: searchParams.get("state"),
    error: searchParams.get("error"),
    errorDescription: searchParams.get("error_description"),
  })
  if (outcome.kind === "success") return { status: 200, body: HTML_SUCCESS }
  return { status: outcome.status, body: HTML_ERROR(outcome.message) }
}

function handleRequest(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  const url = new URL(req.url || "/", `http://localhost:${currentPort}`)

  if (url.pathname !== currentPath) {
    res.writeHead(404)
    res.end("Not found")
    return
  }

  const { status, body } = handleCallbackQuery(url.searchParams)
  res.writeHead(status, { "Content-Type": "text/html" })
  res.end(body)
}

export async function ensureRunning(redirectUri?: string): Promise<void> {
  // Parse the redirect URI to get port and path (uses defaults if not provided)
  const { port, path } = parseRedirectUri(redirectUri)

  // If server is running on a different port/path, stop it first
  if (server && (currentPort !== port || currentPath !== path)) {
    log.info("stopping oauth callback server to reconfigure", { oldPort: currentPort, newPort: port })
    await stop()
  }

  if (server) return

  // Dedupe concurrent starts; a second caller awaits the same start instead of
  // creating its own server.
  if (!starting) {
    starting = (async () => {
      const running = await isPortInUse(port)
      if (running) {
        log.info("oauth callback server already running on another instance", { port })
        return
      }

      const next = createServer(handleRequest)
      await new Promise<void>((resolve, reject) => {
        next.listen(port, () => {
          log.info("oauth callback server started", { port, path })
          resolve()
        })
        next.on("error", reject)
      })

      // Assign module state only AFTER a successful listen. Assigning before
      // (the old behaviour) meant a failed bind left `server` non-null, so
      // every later ensureRunning() returned early thinking it was running —
      // permanently breaking the OAuth callback.
      server = next
      currentPort = port
      currentPath = path
    })().finally(() => {
      starting = undefined
    })
  }
  return starting
}

export function waitForCallback(oauthState: string, cancelKey?: string): Promise<string> {
  if (cancelKey) cancelKeyToState.set(cancelKey, oauthState)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingAuths.has(oauthState)) {
        pendingAuths.delete(oauthState)
        if (cancelKey) cancelKeyToState.delete(cancelKey)
        reject(new Error("OAuth callback timeout - authorization took too long"))
      }
    }, CALLBACK_TIMEOUT_MS)

    pendingAuths.set(oauthState, { resolve, reject, timeout })
  })
}

export function cancelPending(cancelKey: string): void {
  // Look up the oauthState for this caller-specific key via the reverse index.
  const oauthState = cancelKeyToState.get(cancelKey)
  const key = oauthState ?? cancelKey
  const pending = pendingAuths.get(key)
  if (pending) {
    clearTimeout(pending.timeout)
    pendingAuths.delete(key)
    cancelKeyToState.delete(cancelKey)
    pending.reject(new Error("Authorization cancelled"))
  }
}

export async function isPortInUse(port: number = OAUTH_CALLBACK_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, "127.0.0.1")
    socket.on("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.on("error", () => {
      resolve(false)
    })
  })
}

export async function stop(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
    log.info("oauth callback server stopped")
  }

  for (const [_name, pending] of pendingAuths) {
    clearTimeout(pending.timeout)
    pending.reject(new Error("OAuth callback server stopped"))
  }
  pendingAuths.clear()
  cancelKeyToState.clear()
}

export function isRunning(): boolean {
  return server !== undefined
}

export * as McpOAuthCallback from "./oauth-callback"
