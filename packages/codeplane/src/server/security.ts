// Defense-in-depth middleware. v29.0.23 closed the Basic Auth holes — this
// module assumes auth has already happened and tries to make life as
// miserable as possible for anyone who somehow gets past it, or who is
// trying to abuse the public attack surface (browser CSRF, request flood,
// huge-body DOS, error-message info leak).
//
// Each middleware is independent and cheap. The order they run in matters
// — see server.ts for the wiring. The general idea is:
//
//   1. SecurityHeadersMiddleware sets defensive response headers on
//      everything we send back.
//   2. OriginValidationMiddleware rejects browser-originated requests
//      from origins not on the allow-list. Non-browser clients (SDK,
//      curl, the TUI) don't send Origin and aren't affected. This is
//      CSRF protection — important because Basic Auth credentials are
//      auto-attached by the browser whenever a cached login exists.
//   3. BodySizeLimitMiddleware refuses absurd Content-Length so a single
//      attacker can't OOM the process with a 4 GB JSON blob.
//   4. RequestRateMiddleware blanket-caps total req/min per client IP so
//      auth-success doesn't unlock a free DOS.
//   5. IpAllowlistMiddleware lets paranoid deployments restrict access to
//      a known IP set (opt-in via env var).
//
// All five run BEFORE AuthMiddleware, so an attacker probing the auth
// surface is also subject to per-request rate limits and origin checks.

import type { Context, MiddlewareHandler } from "hono"
import { Flag } from "@/flag/flag"
import { Log } from "../util"
import * as AuthRateLimit from "./rate-limit"

const log = Log.create({ service: "server.security" })

// ----------------------------------------------------------------------------
// Security response headers
// ----------------------------------------------------------------------------
//
// These headers are cheap, universally supported, and close a few attack
// classes:
//
//   X-Content-Type-Options: nosniff
//     Blocks browsers from MIME-sniffing a response into a script or
//     stylesheet context. Without this, a JSON response containing
//     attacker-controlled text could be re-interpreted as JS by an old
//     browser.
//
//   X-Frame-Options: DENY
//     Prevents the response from being framed inside another page. Stops
//     clickjacking attacks that try to overlay the Codeplane UI under a
//     transparent attacker page.
//
//   Referrer-Policy: no-referrer
//     The browser never sends the URL of this response in the Referer
//     header when the user clicks a link. Belt-and-suspenders since we
//     no longer accept `auth_token` query credentials, but defends
//     against future regressions and other in-URL secrets.
//
//   Strict-Transport-Security
//     Only meaningful if served over HTTPS. The header is harmless on
//     HTTP, and on HTTPS it forces the browser to refuse to downgrade.
//
//   X-XSS-Protection: 0
//     Disables the legacy IE/Chrome XSS filter, which has been shown to
//     introduce vulnerabilities of its own. Modern browsers rely on CSP.
//
//   Cross-Origin-Opener-Policy / Cross-Origin-Resource-Policy
//     Isolates this origin's window from cross-origin attackers and
//     refuses to be loaded as a subresource from another site.
//
//   Permissions-Policy
//     Denies powerful browser APIs (camera, microphone, etc) by default.

export const SecurityHeadersMiddleware: MiddlewareHandler = async (c, next) => {
  await next()
  c.header("X-Content-Type-Options", "nosniff")
  c.header("X-Frame-Options", "DENY")
  c.header("Referrer-Policy", "no-referrer")
  c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
  c.header("X-XSS-Protection", "0")
  c.header("Cross-Origin-Opener-Policy", "same-origin")
  c.header("Cross-Origin-Resource-Policy", "same-site")
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()")
  // Don't reveal what's serving the response.
  c.header("Server", "codeplane")
}

// ----------------------------------------------------------------------------
// Origin validation (CSRF defense)
// ----------------------------------------------------------------------------
//
// The Codeplane server uses HTTP Basic Auth. Browsers auto-attach the
// saved credentials to every request to the origin, which means a
// malicious page open in the same browser could trigger state-changing
// requests as the user. CORS preflight blocks most cross-origin XHR with
// custom headers, but simple POSTs and WebSocket upgrades fall outside
// that protection.
//
// This middleware validates the Origin header on every state-changing
// request (POST/PUT/DELETE/PATCH) and on WebSocket upgrade requests. If
// the Origin is present and not on the allow-list, the request is
// rejected with 403. Requests without an Origin header (curl, the SDK,
// non-browser tooling) are allowed through — browsers always set Origin
// on cross-origin requests, so the absence of Origin is itself a signal
// that the request didn't come from a browser cross-origin context.

const CODEPLANE_AI_HOST = /^https:\/\/([a-z0-9-]+\.)*codeplane\.ai$/

function isAllowedOrigin(origin: string, opts: OriginOptions): boolean {
  if (origin.startsWith("http://localhost:") || origin === "http://localhost") return true
  if (origin.startsWith("http://127.0.0.1:") || origin === "http://127.0.0.1") return true
  // The desktop shell loads its UI from file://, which Chromium reports
  // as a null Origin or as the file:// URL with no host. Accept those
  // for the Electron host path. (Hono passes them through as-is.)
  if (origin === "null" || origin.startsWith("file://")) return true
  if (CODEPLANE_AI_HOST.test(origin)) return true
  if (opts.allowedOrigins?.includes(origin)) return true
  return false
}

export type OriginOptions = { allowedOrigins?: string[] }

export function OriginValidationMiddleware(opts: OriginOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method
    const isUpgrade = c.req.header("upgrade")?.toLowerCase() === "websocket"
    const isStateChange = method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH"
    if (!isUpgrade && !isStateChange) return next()

    const origin = c.req.header("origin")
    if (!origin) return next() // Non-browser request; CSRF not applicable.

    if (isAllowedOrigin(origin, opts)) return next()

    log.warn("origin rejected", {
      audit: true,
      origin,
      path: c.req.path,
      method,
      client: clientKeyForRequest(c),
    })
    return c.text("Origin not allowed", 403)
  }
}

// ----------------------------------------------------------------------------
// Body-size limit (DOS protection)
// ----------------------------------------------------------------------------
//
// The default 50 MB cap matches what most reverse proxies accept by
// default. Configurable via CODEPLANE_SERVER_MAX_BODY_BYTES for
// deployments that legitimately upload larger payloads (e.g. multi-MB
// markdown).

const DEFAULT_MAX_BODY_BYTES = 50 * 1024 * 1024

function getMaxBodyBytes(): number {
  const raw = process.env["CODEPLANE_SERVER_MAX_BODY_BYTES"]
  if (!raw) return DEFAULT_MAX_BODY_BYTES
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_BODY_BYTES
  return parsed
}

export const BodySizeLimitMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next()
  const contentLength = c.req.header("content-length")
  if (contentLength === undefined) {
    // No Content-Length means either chunked or no body — the streaming
    // body parsers in route handlers should refuse to consume more than
    // they expect. We can't pre-flight here without buffering.
    return next()
  }
  const length = Number(contentLength)
  const max = getMaxBodyBytes()
  if (!Number.isFinite(length) || length < 0 || length > max) {
    log.warn("body too large", {
      audit: true,
      contentLength,
      max,
      path: c.req.path,
      client: clientKeyForRequest(c),
    })
    return c.text("Payload too large", 413)
  }
  return next()
}

// ----------------------------------------------------------------------------
// Per-IP request rate limit (DOS protection)
// ----------------------------------------------------------------------------
//
// AuthRateLimit guards the credential check. This middleware caps total
// requests per client IP per minute regardless of whether they
// authenticate, so a successful auth doesn't unlock a free DOS amplifier
// against expensive routes (LLM proxies, file scans).

const REQUEST_WINDOW_MS = 60_000
const REQUEST_MAX_PER_WINDOW = 600
const requestCounts = new Map<string, { count: number; windowStart: number }>()
const REQUEST_TRACKED_MAX = 50_000

function evictOldestRequestKey() {
  if (requestCounts.size <= REQUEST_TRACKED_MAX) return
  let oldestKey: string | undefined
  let oldestAt = Infinity
  for (const [k, v] of requestCounts) {
    if (v.windowStart < oldestAt) {
      oldestAt = v.windowStart
      oldestKey = k
    }
  }
  if (oldestKey) requestCounts.delete(oldestKey)
}

export const RequestRateMiddleware: MiddlewareHandler = async (c, next) => {
  const key = clientKeyForRequest(c)
  const now = Date.now()
  let entry = requestCounts.get(key)
  if (!entry || now - entry.windowStart > REQUEST_WINDOW_MS) {
    entry = { count: 0, windowStart: now }
    requestCounts.set(key, entry)
    evictOldestRequestKey()
  }
  entry.count += 1
  if (entry.count > REQUEST_MAX_PER_WINDOW) {
    const retryAfterMs = REQUEST_WINDOW_MS - (now - entry.windowStart)
    const retrySeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
    log.warn("request rate limit", {
      audit: true,
      client: key,
      path: c.req.path,
      count: entry.count,
      retryAfterSeconds: retrySeconds,
    })
    return new Response("Too many requests", {
      status: 429,
      headers: { "retry-after": String(retrySeconds) },
    })
  }
  return next()
}

// ----------------------------------------------------------------------------
// Trusted-hosts (DNS-rebinding defense, opt-in)
// ----------------------------------------------------------------------------
//
// DNS-rebinding: attacker's malicious domain initially resolves to their
// IP (so the browser allows fetches to it), then re-resolves to
// 127.0.0.1. The browser is now making requests to the user's local
// Codeplane server using `Host: evil.example.com`. Validating the Host
// header against an allowlist closes this attack.
//
// Off by default because reverse-proxy deployments legitimately rewrite
// Host. Enable via CODEPLANE_SERVER_TRUSTED_HOSTS=host1,host2 to lock it
// down for a known-good deployment. Loopback hosts are always allowed
// since DNS rebinding by definition produces a non-loopback Host header.

function getTrustedHosts(): readonly string[] {
  const raw = process.env["CODEPLANE_SERVER_TRUSTED_HOSTS"]
  if (!raw) return EMPTY_LIST
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function isLoopbackHost(host: string): boolean {
  // Strip the port if present.
  const bare = host.split(":")[0]?.toLowerCase() ?? ""
  return bare === "localhost" || bare === "127.0.0.1" || bare === "[::1]" || bare === "::1"
}

export const TrustedHostsMiddleware: MiddlewareHandler = async (c, next) => {
  const list = getTrustedHosts()
  if (list.length === 0) return next()
  const host = c.req.header("host")?.toLowerCase()
  if (!host) {
    // HTTP/1.1 requires Host; absence is suspicious. Reject.
    log.warn("host header missing", { audit: true, client: clientKeyForRequest(c), path: c.req.path })
    return c.text("Host header required", 400)
  }
  if (isLoopbackHost(host)) return next()
  if (list.includes(host)) return next()
  // Also accept the host without port for ergonomics — `example.com:8080`
  // matches a trusted list entry of `example.com`.
  const bare = host.split(":")[0]
  if (bare && list.includes(bare)) return next()
  log.warn("untrusted host", {
    audit: true,
    host,
    client: clientKeyForRequest(c),
    path: c.req.path,
  })
  return c.text("Host not allowed", 421)
}

// ----------------------------------------------------------------------------
// IP allow-list (opt-in)
// ----------------------------------------------------------------------------
//
// For ultra-paranoid deployments: only accept connections from a fixed
// list of source IPs. Off by default. Enable with
// CODEPLANE_SERVER_IP_ALLOWLIST=ip1,ip2,ip3.

function getIpAllowlist(): readonly string[] {
  const raw = process.env["CODEPLANE_SERVER_IP_ALLOWLIST"]
  if (!raw) return EMPTY_LIST
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

const EMPTY_LIST: readonly string[] = Object.freeze([])

export const IpAllowlistMiddleware: MiddlewareHandler = async (c, next) => {
  const list = getIpAllowlist()
  if (list.length === 0) return next()
  const key = clientKeyForRequest(c)
  if (!list.includes(key)) {
    log.warn("ip allowlist rejected", {
      audit: true,
      client: key,
      path: c.req.path,
      method: c.req.method,
    })
    return c.text("Forbidden", 403)
  }
  return next()
}

// ----------------------------------------------------------------------------
// Shared client-key helper
// ----------------------------------------------------------------------------
//
// Same shape as middleware.ts uses for auth-rate-limit; centralized here
// so security and auth code agree on what "the same client" means.

export function clientKeyForRequest(c: Context): string {
  const cf = c.req.header("cf-connecting-ip")
  if (cf) return cf.trim()
  const real = c.req.header("x-real-ip")
  if (real) return real.trim()
  const xff = c.req.header("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  const env = c.env as
    | { incoming?: { socket?: { remoteAddress?: string } }; remoteAddress?: string }
    | undefined
  const remote = env?.incoming?.socket?.remoteAddress ?? env?.remoteAddress
  return remote || "unknown"
}

// Test helpers. Module-level state needs to be reset between test files.
export function _resetRequestRate(): void {
  requestCounts.clear()
}

export const _config = {
  REQUEST_WINDOW_MS,
  REQUEST_MAX_PER_WINDOW,
  DEFAULT_MAX_BODY_BYTES,
  REQUEST_TRACKED_MAX,
} as const

// Re-exported so callers don't need to know which limiter is which.
export { AuthRateLimit }

// Silences the unused-import lint when this file is consumed only via
// `import * as Security from "./security"` (which it usually is).
export type { Context }
// `Flag` is intentionally imported even though only env reads are used —
// kept around so when we eventually move the security config keys onto
// the Flag table they don't move imports too.
void Flag
