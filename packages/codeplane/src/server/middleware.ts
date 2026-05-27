import { Provider } from "../provider"
import { NamedError } from "@codeplane-ai/shared/util/error"
import { NotFoundError } from "../storage"
import { Session } from "../session"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { Context, ErrorHandler, MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { Log } from "../util"
import { Flag } from "@/flag/flag"
import { basicAuth } from "hono/basic-auth"
import { cors } from "hono/cors"
import { compress } from "hono/compress"
import * as AuthRateLimit from "./rate-limit"

const log = Log.create({ service: "server" })

export const ErrorMiddleware: ErrorHandler = (err, c) => {
  // Always log the full error server-side. The CLIENT never sees the
  // stack trace — for any unrecognized error we return a generic message
  // (see the fall-through case below). Stack traces expose internal
  // paths, dependency versions, and sometimes user data; leaking them
  // through 500 responses was a small info-disclosure bug.
  log.error("failed", {
    error: err,
  })
  if (err instanceof NamedError) {
    let status: ContentfulStatusCode
    if (err instanceof NotFoundError) status = 404
    else if (err instanceof Provider.ModelNotFoundError) status = 400
    else if (err.name === "ConfigInvalidError") status = 400
    else if (err.name === "ProviderAuthValidationFailed") status = 400
    else if (err.name === "CronValidationError") status = 400
    else if (err.name === "PromptQueueConflict") status = 409
    else if (err.name.startsWith("Worktree")) status = 400
    else status = 500
    // NamedError instances are part of the documented API surface —
    // their `message` is intentionally user-facing. The 500 path below
    // is for *unexpected* errors and gets sanitized differently.
    return c.json(err.toObject(), { status })
  }
  if (err instanceof Session.BusyError) {
    return c.json(new NamedError.Unknown({ message: err.message }).toObject(), { status: 400 })
  }
  if (err instanceof Session.SessionNotFoundError) {
    return c.json({ name: "SessionNotFoundError", data: { message: err.message } }, { status: 404 })
  }
  if (err instanceof HTTPException) return err.getResponse()
  // Unknown error path. Return a generic message + correlation token; the
  // real details stay in the server log. Without this, a stray
  // `throw new Error("connection refused to /Users/devin/...")` would
  // leak filesystem paths and host details to anyone who could trigger
  // it. Token lets support tie a user report to the corresponding log
  // line.
  const correlation = Math.random().toString(36).slice(2, 10)
  log.error("unhandled error", {
    correlation,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  })
  return c.json(new NamedError.Unknown({ message: `Internal server error (ref ${correlation})` }).toObject(), {
    status: 500,
  })
}

// Minimum wall-clock time every auth check takes, in milliseconds. Masks
// any timing-leak surface that might survive constant-time compares
// (response serialization, header parsing, etc). A 50 ms floor is high
// enough to drown out micro-second-scale leaks but small enough that
// legitimate clients don't notice. Set to 0 in tests via the env var.
const MIN_AUTH_LATENCY_MS = (() => {
  const raw = process.env["CODEPLANE_SERVER_MIN_AUTH_LATENCY_MS"]
  if (raw === undefined) return 50
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 50
})()

async function sleepUntilAtLeast(startedAt: number, minMs: number): Promise<void> {
  if (minMs <= 0) return
  const elapsed = Date.now() - startedAt
  if (elapsed >= minMs) return
  await new Promise<void>((resolve) => setTimeout(resolve, minMs - elapsed))
}

export const AuthMiddleware: MiddlewareHandler = async (c, next) => {
  // Allow CORS preflight requests to succeed without auth.
  // Browser clients sending Authorization headers will preflight with OPTIONS.
  if (c.req.method === "OPTIONS") return next()
  const password = Flag.CODEPLANE_SERVER_PASSWORD
  if (!password) return next()
  const username = Flag.CODEPLANE_SERVER_USERNAME ?? "codeplane"
  const startedAt = Date.now()

  const clientKey = clientKeyForRequest(c)

  // Brake brute-force attempts before doing any crypto compare. Once a
  // client crosses the rate-limit threshold, every further attempt during
  // the lockout window is rejected with 429 + Retry-After, no compare
  // happens, no log spam. See rate-limit.ts for the policy.
  const gate = AuthRateLimit.check(clientKey)
  if (!gate.allowed) {
    const retrySeconds = Math.max(1, Math.ceil(gate.retryAfterMs / 1000))
    log.warn("auth rate limit", {
      client: clientKey,
      path: c.req.path,
      retryAfterSeconds: retrySeconds,
    })
    return new Response("Too many authentication attempts. Try again later.", {
      status: 429,
      headers: {
        "retry-after": String(retrySeconds),
        "www-authenticate": `Basic realm="codeplane"`,
      },
    })
  }

  // Accept `auth_token` query credential ONLY on WebSocket upgrade
  // requests. That's the one path where the browser API (WebSocket /
  // EventSource) can't attach an Authorization header — see
  // packages/app/src/components/terminal.tsx for the legitimate caller.
  //
  // Refusing the query-string credential everywhere else closes a leak:
  // URLs propagate through server access logs, browser history, Referer
  // headers when the page loads external resources, intermediate proxy
  // caches, and stack traces. The secret would end up far outside the
  // request itself. Header-based Basic Auth has none of these problems.
  const isWsUpgrade = c.req.header("upgrade")?.toLowerCase() === "websocket"
  if (isWsUpgrade && c.req.query("auth_token")) {
    c.req.raw.headers.set("authorization", `Basic ${c.req.query("auth_token")}`)
  }

  // hono's basicAuth() throws HTTPException(401) on mismatch (caught by
  // ErrorMiddleware) and calls onAuthSuccess on success. We wrap it so
  // we can observe both outcomes and feed them into the rate limiter,
  // while keeping basicAuth's SHA-256 + timingSafeEqual compare path.
  let succeeded = false
  const auth = basicAuth({
    username,
    password,
    onAuthSuccess: () => {
      succeeded = true
    },
  })

  try {
    await auth(c, next)
    if (succeeded) AuthRateLimit.recordSuccess(clientKey)
    return
  } catch (err) {
    if (err instanceof HTTPException && err.status === 401) {
      const entry = AuthRateLimit.recordFailure(clientKey)
      log.warn("auth failure", {
        audit: true,
        client: clientKey,
        path: c.req.path,
        failures: entry.failures,
        locked: entry.blockedUntil > Date.now(),
      })
      // Floor the failed-auth response time so latency can't be used as
      // a side channel. The constant-time compares already handle the
      // byte-by-byte case, but any wall-clock divergence between the
      // "user lookup", "rate limit hit", and "compare failed" branches
      // would otherwise be observable.
      await sleepUntilAtLeast(startedAt, MIN_AUTH_LATENCY_MS)
    }
    throw err
  }
}

function clientKeyForRequest(c: Context): string {
  // Prefer reverse-proxy forwarded IP headers in order of trust. None of
  // these are signed, so a malicious client behind a forgiving proxy can
  // spoof them — but that's the same trust model the rest of the world
  // operates under, and spoofing only helps an attacker dodge their own
  // lockout by rotating fake IPs (which is what the global hard limit
  // and oldest-eviction cap defend against).
  const cf = c.req.header("cf-connecting-ip")
  if (cf) return cf.trim()
  const real = c.req.header("x-real-ip")
  if (real) return real.trim()
  const xff = c.req.header("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  // Fall back to the underlying socket peer when available. Different
  // adapters expose it differently, so we probe a few known shapes.
  const env = c.env as
    | {
        incoming?: { socket?: { remoteAddress?: string } }
        remoteAddress?: string
      }
    | undefined
  const remote = env?.incoming?.socket?.remoteAddress ?? env?.remoteAddress
  return remote || "unknown"
}

export const LoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const skip = c.req.path === "/log"
  if (!skip) {
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
    })
  }
  const timer = log.time("request", {
    method: c.req.method,
    path: c.req.path,
  })
  await next()
  if (!skip) timer.stop()
}

export function CorsMiddleware(opts?: { cors?: string[] }): MiddlewareHandler {
  return cors({
    maxAge: 86_400,
    origin(input) {
      if (!input) return

      if (input.startsWith("http://localhost:")) return input
      if (input.startsWith("http://127.0.0.1:")) return input

      if (/^https:\/\/([a-z0-9-]+\.)*codeplane\.ai$/.test(input)) return input
      if (opts?.cors?.includes(input)) return input
    },
  })
}

export const TextJsonMiddleware: MiddlewareHandler = (c, next) => {
  if (c.req.header("content-type")?.split(";")[0].trim().toLowerCase() === "text/plain") {
    c.req.raw.headers.set("content-type", "application/json")
  }
  return next()
}

const zipped = compress()
export const CompressionMiddleware: MiddlewareHandler = (c, next) => {
  const path = c.req.path
  const method = c.req.method
  if (path === "/event" || path === "/global/event") return next()
  if (method === "POST" && /\/session\/[^/]+\/(message|prompt_async)$/.test(path)) return next()
  return zipped(c, next)
}
