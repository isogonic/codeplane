import { describe, expect, test } from "bun:test"
import { McpRoutes } from "../../src/server/routes/instance/mcp"
import { Log } from "../../src/util"

void Log.init({ print: false })

// The server-hosted callback route (GET /mcp/oauth/callback, here mounted at the
// McpRoutes root so the path is /oauth/callback) is the redirect target that
// makes MCP OAuth work on web + mobile. It resolves the in-flight flow purely
// from the unguessable state and never needs instance context, so we can drive
// it directly through the Hono app.
describe("mcp oauth server-hosted callback route", () => {
  const app = McpRoutes()

  test("renders a 400 failure page when the state is unknown (CSRF defense)", async () => {
    const res = await app.request("/oauth/callback?code=abc&state=not-a-real-state")
    expect(res.status).toBe(400)
    expect(res.headers.get("content-type")).toContain("text/html")
    expect(await res.text()).toContain("Invalid or expired state")
  })

  test("renders a 400 failure page when the state is missing", async () => {
    const res = await app.request("/oauth/callback?code=abc")
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("state parameter")
  })

  test("surfaces a provider error with HTTP 200 and escapes reflected HTML", async () => {
    const res = await app.request("/oauth/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E&state=s")
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).not.toContain("<script>alert(1)</script>")
    expect(body).toContain("&lt;script&gt;")
  })
})
