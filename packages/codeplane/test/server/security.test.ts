import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import {
  BodySizeLimitMiddleware,
  IpAllowlistMiddleware,
  OriginValidationMiddleware,
  RequestRateMiddleware,
  SecurityHeadersMiddleware,
  TrustedHostsMiddleware,
  _config,
  _resetRequestRate,
} from "../../src/server/security"
import { Log } from "../../src/util"

void Log.init({ print: false })

const originalEnv = {
  CODEPLANE_SERVER_IP_ALLOWLIST: process.env["CODEPLANE_SERVER_IP_ALLOWLIST"],
  CODEPLANE_SERVER_MAX_BODY_BYTES: process.env["CODEPLANE_SERVER_MAX_BODY_BYTES"],
  CODEPLANE_SERVER_TRUSTED_HOSTS: process.env["CODEPLANE_SERVER_TRUSTED_HOSTS"],
}

afterEach(() => {
  process.env["CODEPLANE_SERVER_IP_ALLOWLIST"] = originalEnv.CODEPLANE_SERVER_IP_ALLOWLIST
  process.env["CODEPLANE_SERVER_MAX_BODY_BYTES"] = originalEnv.CODEPLANE_SERVER_MAX_BODY_BYTES
  process.env["CODEPLANE_SERVER_TRUSTED_HOSTS"] = originalEnv.CODEPLANE_SERVER_TRUSTED_HOSTS
  _resetRequestRate()
})

describe("SecurityHeadersMiddleware", () => {
  test("sets defensive response headers on success responses", async () => {
    const app = new Hono().use(SecurityHeadersMiddleware)
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("x-frame-options")).toBe("DENY")
    expect(res.headers.get("referrer-policy")).toBe("no-referrer")
    expect(res.headers.get("strict-transport-security")).toContain("max-age=")
    expect(res.headers.get("x-xss-protection")).toBe("0")
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin")
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-site")
    expect(res.headers.get("permissions-policy")).toContain("camera=()")
    expect(res.headers.get("server")).toBe("codeplane")
  })
})

describe("OriginValidationMiddleware", () => {
  test("allows GET requests without checking Origin", async () => {
    const app = new Hono().use(OriginValidationMiddleware())
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/", { headers: { origin: "https://evil.example.com" } })
    expect(res.status).toBe(200)
  })

  test("allows POST without Origin header (non-browser client)", async () => {
    const app = new Hono().use(OriginValidationMiddleware())
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", { method: "POST" })
    expect(res.status).toBe(200)
  })

  test("rejects POST from disallowed Origin", async () => {
    const app = new Hono().use(OriginValidationMiddleware())
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", { method: "POST", headers: { origin: "https://evil.example.com" } })
    expect(res.status).toBe(403)
  })

  test("allows POST from localhost any port", async () => {
    const app = new Hono().use(OriginValidationMiddleware())
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", { method: "POST", headers: { origin: "http://localhost:5180" } })
    expect(res.status).toBe(200)
  })

  test("allows POST from 127.0.0.1 any port", async () => {
    const app = new Hono().use(OriginValidationMiddleware())
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", { method: "POST", headers: { origin: "http://127.0.0.1:9999" } })
    expect(res.status).toBe(200)
  })

  test("allows POST from codeplane.ai subdomains over HTTPS", async () => {
    const app = new Hono().use(OriginValidationMiddleware())
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", { method: "POST", headers: { origin: "https://app.codeplane.ai" } })
    expect(res.status).toBe(200)
  })

  test("rejects POST from HTTP codeplane.ai (downgrade)", async () => {
    const app = new Hono().use(OriginValidationMiddleware())
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", { method: "POST", headers: { origin: "http://app.codeplane.ai" } })
    expect(res.status).toBe(403)
  })

  test("allows POST from file:// (desktop shell)", async () => {
    const app = new Hono().use(OriginValidationMiddleware())
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", { method: "POST", headers: { origin: "file://" } })
    expect(res.status).toBe(200)
  })

  test("allows POST from null origin (sandboxed/file:)", async () => {
    const app = new Hono().use(OriginValidationMiddleware())
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", { method: "POST", headers: { origin: "null" } })
    expect(res.status).toBe(200)
  })

  test("validates WebSocket upgrade requests too", async () => {
    const app = new Hono().use(OriginValidationMiddleware())
    app.get("/ws", (c) => c.text("ok"))
    const denied = await app.request("/ws", {
      headers: { upgrade: "websocket", origin: "https://evil.example.com" },
    })
    expect(denied.status).toBe(403)

    const allowed = await app.request("/ws", {
      headers: { upgrade: "websocket", origin: "http://localhost:9000" },
    })
    expect(allowed.status).toBe(200)
  })

  test("respects user-supplied allowlist", async () => {
    const app = new Hono().use(OriginValidationMiddleware({ allowedOrigins: ["https://my-friendly-host.test"] }))
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", {
      method: "POST",
      headers: { origin: "https://my-friendly-host.test" },
    })
    expect(res.status).toBe(200)
  })
})

describe("BodySizeLimitMiddleware", () => {
  test("allows GET without checking content-length", async () => {
    const app = new Hono().use(BodySizeLimitMiddleware)
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/", { headers: { "content-length": "9999999999" } })
    expect(res.status).toBe(200)
  })

  test("rejects POST with content-length over the limit", async () => {
    process.env["CODEPLANE_SERVER_MAX_BODY_BYTES"] = "1024"
    const app = new Hono().use(BodySizeLimitMiddleware)
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-length": "10000" },
      body: "x".repeat(2000),
    })
    expect(res.status).toBe(413)
  })

  test("allows POST with content-length under the limit", async () => {
    process.env["CODEPLANE_SERVER_MAX_BODY_BYTES"] = String(1024 * 1024)
    const app = new Hono().use(BodySizeLimitMiddleware)
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-length": "1024" },
    })
    expect(res.status).toBe(200)
  })

  test("uses default cap when env not set", async () => {
    process.env["CODEPLANE_SERVER_MAX_BODY_BYTES"] = undefined
    const app = new Hono().use(BodySizeLimitMiddleware)
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-length": String(_config.DEFAULT_MAX_BODY_BYTES + 1) },
    })
    expect(res.status).toBe(413)
  })

  test("allows POST without content-length (chunked)", async () => {
    const app = new Hono().use(BodySizeLimitMiddleware)
    app.post("/", (c) => c.text("ok"))
    const res = await app.request("/", { method: "POST" })
    expect(res.status).toBe(200)
  })
})

describe("RequestRateMiddleware", () => {
  beforeEach(() => {
    _resetRequestRate()
  })

  test("allows requests below the per-minute cap", async () => {
    const app = new Hono().use(RequestRateMiddleware)
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/", { headers: { "x-real-ip": "10.0.0.1" } })
    expect(res.status).toBe(200)
  })

  test("returns 429 once the cap is exceeded", async () => {
    const app = new Hono().use(RequestRateMiddleware)
    app.get("/", (c) => c.text("ok"))
    let last: Response | undefined
    for (let i = 0; i < _config.REQUEST_MAX_PER_WINDOW + 1; i++) {
      last = await app.request("/", { headers: { "x-real-ip": "10.0.0.2" } })
    }
    expect(last?.status).toBe(429)
    expect(last?.headers.get("retry-after")).not.toBeNull()
  })

  test("counters are per-client", async () => {
    const app = new Hono().use(RequestRateMiddleware)
    app.get("/", (c) => c.text("ok"))

    // Burn through client A's budget.
    for (let i = 0; i < _config.REQUEST_MAX_PER_WINDOW + 1; i++) {
      await app.request("/", { headers: { "x-real-ip": "10.0.0.A" } })
    }
    const blockedA = await app.request("/", { headers: { "x-real-ip": "10.0.0.A" } })
    expect(blockedA.status).toBe(429)

    const stillOkB = await app.request("/", { headers: { "x-real-ip": "10.0.0.B" } })
    expect(stillOkB.status).toBe(200)
  })
})

describe("TrustedHostsMiddleware", () => {
  test("passes through when trusted hosts env is unset", async () => {
    process.env["CODEPLANE_SERVER_TRUSTED_HOSTS"] = undefined
    const app = new Hono().use(TrustedHostsMiddleware)
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/", { headers: { host: "anything.example.com" } })
    expect(res.status).toBe(200)
  })

  test("rejects untrusted Host header when allowlist is set", async () => {
    process.env["CODEPLANE_SERVER_TRUSTED_HOSTS"] = "codeplane.example.com"
    const app = new Hono().use(TrustedHostsMiddleware)
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/", { headers: { host: "evil.example.com" } })
    expect(res.status).toBe(421)
  })

  test("allows trusted Host header", async () => {
    process.env["CODEPLANE_SERVER_TRUSTED_HOSTS"] = "codeplane.example.com"
    const app = new Hono().use(TrustedHostsMiddleware)
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/", { headers: { host: "codeplane.example.com" } })
    expect(res.status).toBe(200)
  })

  test("allows trusted Host even when the request includes a port", async () => {
    process.env["CODEPLANE_SERVER_TRUSTED_HOSTS"] = "codeplane.example.com"
    const app = new Hono().use(TrustedHostsMiddleware)
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/", { headers: { host: "codeplane.example.com:8443" } })
    expect(res.status).toBe(200)
  })

  test("always allows loopback hosts regardless of allowlist", async () => {
    process.env["CODEPLANE_SERVER_TRUSTED_HOSTS"] = "codeplane.example.com"
    const app = new Hono().use(TrustedHostsMiddleware)
    app.get("/", (c) => c.text("ok"))
    for (const host of ["localhost:5180", "127.0.0.1:9000", "localhost", "127.0.0.1"]) {
      const res = await app.request("/", { headers: { host } })
      expect(res.status).toBe(200)
    }
  })

  test("rejects requests without a Host header when allowlist is set", async () => {
    process.env["CODEPLANE_SERVER_TRUSTED_HOSTS"] = "codeplane.example.com"
    const app = new Hono().use(TrustedHostsMiddleware)
    app.get("/", (c) => c.text("ok"))
    // hono's test request always sets Host; pass empty explicitly to
    // simulate a malformed client.
    const res = await app.request(new Request("http://internal/", { headers: { host: "" } }))
    // hono normalizes empty host back to the URL host; just assert it
    // doesn't return 200 against a non-loopback URL.
    expect([400, 421]).toContain(res.status === 200 ? -1 : res.status)
  })
})

describe("IpAllowlistMiddleware", () => {
  test("passes through when allowlist env is unset", async () => {
    process.env["CODEPLANE_SERVER_IP_ALLOWLIST"] = undefined
    const app = new Hono().use(IpAllowlistMiddleware)
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/", { headers: { "x-real-ip": "anything" } })
    expect(res.status).toBe(200)
  })

  test("rejects clients not on the list", async () => {
    process.env["CODEPLANE_SERVER_IP_ALLOWLIST"] = "10.0.0.10,10.0.0.11"
    const app = new Hono().use(IpAllowlistMiddleware)
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/", { headers: { "x-real-ip": "10.0.0.99" } })
    expect(res.status).toBe(403)
  })

  test("allows clients on the list", async () => {
    process.env["CODEPLANE_SERVER_IP_ALLOWLIST"] = "10.0.0.10,10.0.0.11"
    const app = new Hono().use(IpAllowlistMiddleware)
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/", { headers: { "x-real-ip": "10.0.0.11" } })
    expect(res.status).toBe(200)
  })

  test("handles whitespace and empty entries in the env var", async () => {
    process.env["CODEPLANE_SERVER_IP_ALLOWLIST"] = " 10.0.0.10 ,,10.0.0.11 "
    const app = new Hono().use(IpAllowlistMiddleware)
    app.get("/", (c) => c.text("ok"))
    const res = await app.request("/", { headers: { "x-real-ip": "10.0.0.10" } })
    expect(res.status).toBe(200)
  })
})
