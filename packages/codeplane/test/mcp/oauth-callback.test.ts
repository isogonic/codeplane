import { test, expect, describe, afterEach } from "bun:test"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { parseRedirectUri } from "../../src/mcp/oauth-provider"

describe("parseRedirectUri", () => {
  test("returns defaults when no URI provided", () => {
    const result = parseRedirectUri()
    expect(result.port).toBe(19876)
    expect(result.path).toBe("/mcp/oauth/callback")
  })

  test("parses port and path from URI", () => {
    const result = parseRedirectUri("http://127.0.0.1:8080/oauth/callback")
    expect(result.port).toBe(8080)
    expect(result.path).toBe("/oauth/callback")
  })

  test("returns defaults for invalid URI", () => {
    const result = parseRedirectUri("not-a-valid-url")
    expect(result.port).toBe(19876)
    expect(result.path).toBe("/mcp/oauth/callback")
  })
})

describe("McpOAuthCallback.ensureRunning", () => {
  afterEach(async () => {
    await McpOAuthCallback.stop()
  })

  test("starts server with custom redirectUri port and path", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18000/custom/callback")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })
})

describe("McpOAuthCallback.escapeHtml", () => {
  test("neutralizes a reflected script payload", () => {
    const escaped = McpOAuthCallback.escapeHtml(`<script>alert('xss')</script>`)
    expect(escaped).not.toContain("<script>")
    expect(escaped).toBe("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;")
  })

  test("escapes all HTML-significant characters", () => {
    expect(McpOAuthCallback.escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;")
  })

  test("leaves a benign provider error message intact", () => {
    expect(McpOAuthCallback.escapeHtml("access_denied")).toBe("access_denied")
  })
})
