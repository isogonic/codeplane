import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { PublicUIMiddleware } from "../../src/server/routes/ui"

// PublicUIMiddleware serves the public web-UI shell BEFORE the auth gate.
// These tests pin the security boundary: only static shell assets and
// top-level document navigations are handled pre-auth; every API/data
// request must fall through to the (downstream) auth gate + routes.
//
// In the test build there's no embedded UI bundle and no CODEPLANE_DEV_UI_URL,
// so a request the middleware DECIDES to handle resolves to a 503 ("built
// without an embedded web UI"). A request it lets through reaches the
// sentinel route below and returns 200 "GATED". That difference is exactly
// what we assert: handled (shell/asset) vs passed-through (API).
function makeApp() {
  const app = new Hono()
  app.use(PublicUIMiddleware)
  app.all("/*", (c) => c.text("GATED"))
  return app
}

async function classify(path: string, headers?: Record<string, string>, method = "GET") {
  const res = await makeApp().request(path, { method, headers })
  if (res.status === 200 && (await res.clone().text()) === "GATED") return "gated"
  return "ui"
}

describe("PublicUIMiddleware", () => {
  test("static assets are served pre-auth", async () => {
    expect(await classify("/assets/index-abc123.js")).toBe("ui")
    expect(await classify("/favicon.ico")).toBe("ui")
    expect(await classify("/manifest.webmanifest")).toBe("ui")
    expect(await classify("/logo.svg")).toBe("ui")
    expect(await classify("/sounds/ping.wav")).toBe("ui")
  })

  test("document navigations to SPA routes are served the shell pre-auth", async () => {
    const nav = { "sec-fetch-dest": "document", accept: "text/html" }
    expect(await classify("/", nav)).toBe("ui")
    expect(await classify("/settings", nav)).toBe("ui")
    expect(await classify("/settings/models", nav)).toBe("ui")
    expect(await classify("/notifications", nav)).toBe("ui")
    // A project deep link (/:dir/session/:id) is an SPA route, not API.
    expect(await classify("/my-project/session/abc", nav)).toBe("ui")
  })

  test("API requests are NEVER served by the public middleware (stay gated)", async () => {
    // No Sec-Fetch / html accept → clearly an XHR/fetch.
    expect(await classify("/global/config")).toBe("gated")
    expect(await classify("/session")).toBe("gated")
    expect(await classify("/provider/auth")).toBe("gated")
    expect(await classify("/config/providers")).toBe("gated")
    expect(await classify("/mcp")).toBe("gated")
    expect(await classify("/path")).toBe("gated")
  })

  test("even a document navigation to an API path stays gated (no data leak)", async () => {
    // A browser pointed straight at an API URL must not bypass auth.
    const nav = { "sec-fetch-dest": "document", accept: "text/html" }
    expect(await classify("/global/config", nav)).toBe("gated")
    expect(await classify("/session", nav)).toBe("gated")
    expect(await classify("/experimental/console", nav)).toBe("gated")
  })

  test("non-GET/HEAD requests are always gated", async () => {
    const nav = { "sec-fetch-dest": "document", accept: "text/html" }
    expect(await classify("/", nav, "POST")).toBe("gated")
    expect(await classify("/settings", nav, "DELETE")).toBe("gated")
  })

  test("a fetch for a SPA route (no document dest) stays gated", async () => {
    // Sec-Fetch-Dest=empty is an app fetch, not a navigation; it must not be
    // answered with the shell. Real asset fetches use the extension allowlist.
    expect(await classify("/settings", { "sec-fetch-dest": "empty" })).toBe("gated")
  })
})
