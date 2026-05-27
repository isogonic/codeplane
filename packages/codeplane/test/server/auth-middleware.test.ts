import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { Flag } from "../../src/flag/flag"
import { AuthMiddleware, ErrorMiddleware } from "../../src/server/middleware"
import * as AuthRateLimit from "../../src/server/rate-limit"
import { Log } from "../../src/util"

void Log.init({ print: false })

const original = {
  CODEPLANE_SERVER_PASSWORD: Flag.CODEPLANE_SERVER_PASSWORD,
  CODEPLANE_SERVER_USERNAME: Flag.CODEPLANE_SERVER_USERNAME,
}

function makeApp() {
  const app = new Hono().onError(ErrorMiddleware).use(AuthMiddleware)
  app.get("/ping", (c) => c.text("pong"))
  app.get("/pty/abc/connect", (c) => c.text("ws-ok"))
  return app
}

function authHeader(user: string, pass: string) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`
}

const STRONG = "test-strong-password-1234"

beforeEach(() => {
  AuthRateLimit.reset()
})

afterEach(() => {
  Flag.CODEPLANE_SERVER_PASSWORD = original.CODEPLANE_SERVER_PASSWORD
  Flag.CODEPLANE_SERVER_USERNAME = original.CODEPLANE_SERVER_USERNAME
  AuthRateLimit.reset()
})

describe("AuthMiddleware", () => {
  test("no password = open", async () => {
    Flag.CODEPLANE_SERVER_PASSWORD = undefined
    const res = await makeApp().request("/ping")
    expect(res.status).toBe(200)
  })

  test("with password, valid header passes", async () => {
    Flag.CODEPLANE_SERVER_PASSWORD = STRONG
    const res = await makeApp().request("/ping", {
      headers: { authorization: authHeader("codeplane", STRONG) },
    })
    expect(res.status).toBe(200)
  })

  test("with password, missing header returns 401", async () => {
    Flag.CODEPLANE_SERVER_PASSWORD = STRONG
    const res = await makeApp().request("/ping")
    expect(res.status).toBe(401)
  })

  test("with password, wrong header returns 401", async () => {
    Flag.CODEPLANE_SERVER_PASSWORD = STRONG
    const res = await makeApp().request("/ping", {
      headers: { authorization: authHeader("codeplane", "wrong-but-also-long-enough") },
    })
    expect(res.status).toBe(401)
  })

  test("auth_token query param is REJECTED on plain HTTP requests", async () => {
    Flag.CODEPLANE_SERVER_PASSWORD = STRONG
    const token = Buffer.from(`codeplane:${STRONG}`).toString("base64")
    const res = await makeApp().request(`/ping?auth_token=${encodeURIComponent(token)}`)
    expect(res.status).toBe(401)
  })

  test("auth_token query param IS honored on WebSocket upgrade requests", async () => {
    Flag.CODEPLANE_SERVER_PASSWORD = STRONG
    const token = Buffer.from(`codeplane:${STRONG}`).toString("base64")
    const res = await makeApp().request(`/pty/abc/connect?auth_token=${encodeURIComponent(token)}`, {
      headers: { upgrade: "websocket" },
    })
    expect(res.status).toBe(200)
  })

  test("OPTIONS preflight bypasses auth (CORS support)", async () => {
    Flag.CODEPLANE_SERVER_PASSWORD = STRONG
    const res = await makeApp().request("/ping", { method: "OPTIONS" })
    // The dummy route doesn't handle OPTIONS, but the middleware should let
    // the request pass through — so we expect anything other than 401.
    expect(res.status).not.toBe(401)
  })

  test("after enough failures, further attempts get 429 with Retry-After", async () => {
    Flag.CODEPLANE_SERVER_PASSWORD = STRONG
    const app = makeApp()
    const bad = () =>
      app.request("/ping", {
        headers: {
          authorization: authHeader("codeplane", "no-good-but-long-enough-here"),
          // Static client key so all requests count against the same limiter
          // bucket — without this they'd all fall back to "unknown" anyway,
          // but the explicit header makes the test less load-bearing on
          // internals.
          "x-real-ip": "10.0.0.99",
        },
      })

    // Trip past the soft limit + one to provoke the first lockout.
    for (let i = 0; i < AuthRateLimit.config.SOFT_LIMIT + 1; i++) {
      const r = await bad()
      expect(r.status).toBe(401)
    }

    const blocked = await bad()
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("retry-after")).not.toBeNull()
  })

  test("successful auth clears prior failures for that client", async () => {
    Flag.CODEPLANE_SERVER_PASSWORD = STRONG
    const app = makeApp()
    const ip = "10.0.0.42"

    for (let i = 0; i < AuthRateLimit.config.SOFT_LIMIT; i++) {
      const r = await app.request("/ping", {
        headers: { authorization: authHeader("codeplane", "wrong-but-long-enough"), "x-real-ip": ip },
      })
      expect(r.status).toBe(401)
    }

    const ok = await app.request("/ping", {
      headers: { authorization: authHeader("codeplane", STRONG), "x-real-ip": ip },
    })
    expect(ok.status).toBe(200)

    // The bad-streak should have been cleared by the success, so we can
    // make many more bad requests without immediately tripping the lockout.
    const r = await app.request("/ping", {
      headers: { authorization: authHeader("codeplane", "wrong-but-long-enough"), "x-real-ip": ip },
    })
    expect(r.status).toBe(401)
  })

  test("rate limiter is per-client (different IPs are independent)", async () => {
    Flag.CODEPLANE_SERVER_PASSWORD = STRONG
    const app = makeApp()

    // Use up client A's budget.
    for (let i = 0; i < AuthRateLimit.config.SOFT_LIMIT + 1; i++) {
      await app.request("/ping", {
        headers: { authorization: authHeader("codeplane", "x".repeat(20)), "x-real-ip": "10.0.0.1" },
      })
    }
    const a = await app.request("/ping", {
      headers: { authorization: authHeader("codeplane", "x".repeat(20)), "x-real-ip": "10.0.0.1" },
    })
    expect(a.status).toBe(429)

    // Client B should still get the regular 401 (and is welcome to try).
    const b = await app.request("/ping", {
      headers: { authorization: authHeader("codeplane", "x".repeat(20)), "x-real-ip": "10.0.0.2" },
    })
    expect(b.status).toBe(401)
  })

  test("custom username is honored", async () => {
    Flag.CODEPLANE_SERVER_PASSWORD = STRONG
    Flag.CODEPLANE_SERVER_USERNAME = "alice"
    const res = await makeApp().request("/ping", {
      headers: { authorization: authHeader("alice", STRONG) },
    })
    expect(res.status).toBe(200)

    const wrongUser = await makeApp().request("/ping", {
      headers: { authorization: authHeader("codeplane", STRONG) },
    })
    expect(wrongUser.status).toBe(401)
  })
})
