import { test, expect, mock, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"

// Mirror the SDK's UnauthorizedError so instanceof checks pass.
class MockUnauthorizedError extends Error {
  constructor(message?: string) {
    super(message ?? "Unauthorized")
    this.name = "UnauthorizedError"
  }
}

// Controls whether the mock transport simulates the 401 → auth-redirect flow
// (begin step) or connects cleanly (post-callback reconnect step).
let simulateAuthFlow = true
let connectSucceedsImmediately = false

void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    authProvider:
      | {
          state?: () => Promise<string>
          redirectToAuthorization?: (url: URL) => Promise<void>
          saveCodeVerifier?: (v: string) => Promise<void>
        }
      | undefined
    constructor(_url: URL, options?: { authProvider?: unknown }) {
      this.authProvider = options?.authProvider as typeof this.authProvider
    }
    async start() {
      if (connectSucceedsImmediately) return
      if (simulateAuthFlow && this.authProvider) {
        if (this.authProvider.state) await this.authProvider.state()
        if (this.authProvider.saveCodeVerifier) await this.authProvider.saveCodeVerifier("test-verifier")
        if (this.authProvider.redirectToAuthorization) {
          await this.authProvider.redirectToAuthorization(new URL("https://auth.example.com/authorize?state=test"))
        }
        throw new MockUnauthorizedError()
      }
      throw new MockUnauthorizedError()
    }
    async finishAuth(_code: string) {}
    async close() {}
  },
}))

void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    async start() {
      throw new Error("Mock SSE transport cannot connect")
    }
    async close() {}
  },
}))

void mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(transport: { start: () => Promise<void> }) {
      await transport.start()
    }
    setNotificationHandler() {}
    async listTools() {
      return { tools: [{ name: "test_tool", inputSchema: { type: "object", properties: {} } }] }
    }
    async close() {}
  },
}))

void mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}))

beforeEach(() => {
  simulateAuthFlow = true
  connectSucceedsImmediately = false
})

// Clear the module-global pending-callback registry between tests so a flow
// left waiting by one test can't bleed into the next.
afterEach(async () => {
  const { McpOAuthCallback } = await import("../../src/mcp/oauth-callback")
  await McpOAuthCallback.stop()
})

const { MCP } = await import("../../src/mcp/index")
const { McpAuth } = await import("../../src/mcp/auth")
const { McpOAuthCallback } = await import("../../src/mcp/oauth-callback")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

const SERVER_REDIRECT = "http://localhost:4096/mcp/oauth/callback"

function configWith(name: string) {
  return JSON.stringify({
    $schema: "https://example.invalid/config.json",
    mcp: { [name]: { type: "remote", url: "https://example.com/mcp" } },
  })
}

test("beginAuth returns the server-hosted redirect URI and an authorization URL", async () => {
  await using tmp = await tmpdir({ init: async (dir) => Bun.write(`${dir}/codeplane.json`, configWith("srv")) })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Effect.runPromise(
        MCP.Service.use((mcp) =>
          Effect.gen(function* () {
            const result = yield* mcp.beginAuth("srv", { redirectUri: SERVER_REDIRECT })
            expect("authorizationUrl" in result).toBe(true)
            if ("authorizationUrl" in result) {
              expect(result.authorizationUrl).toBe("https://auth.example.com/authorize?state=test")
              // The provider must echo the server-hosted redirect (not loopback)
              // so the browser is sent back to the codeplane server it's using.
              expect(result.redirectUri).toBe(SERVER_REDIRECT)
            }
          }),
        ).pipe(Effect.provide(MCP.defaultLayer)),
      )
    },
  })
})

test("server-hosted callback completes the flow begun by beginAuth", async () => {
  await using tmp = await tmpdir({ init: async (dir) => Bun.write(`${dir}/codeplane.json`, configWith("done")) })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Effect.runPromise(
        MCP.Service.use((mcp) =>
          Effect.gen(function* () {
            const begun = yield* mcp.beginAuth("done", { redirectUri: SERVER_REDIRECT })
            expect("authorizationUrl" in begun).toBe(true)

            // The unguessable state the flow is waiting on is persisted by startAuth.
            const oauthState = yield* McpAuth.Service.use((auth) => auth.getOAuthState("done")).pipe(
              Effect.provide(McpAuth.defaultLayer),
            )
            expect(typeof oauthState).toBe("string")

            // The post-callback reconnect must succeed.
            connectSucceedsImmediately = true

            // Simulate the provider redirecting the browser to the server-hosted
            // callback route, which routes the query through handleCallbackQuery.
            // The completion fiber registers its callback waiter asynchronously
            // after beginAuth returns; in production the redirect arrives seconds
            // later, but here we may race it, so retry until the waiter exists.
            let outcome = McpOAuthCallback.handleCallbackQuery(
              new URLSearchParams({ code: "auth-code-123", state: oauthState! }),
            )
            for (let i = 0; i < 50 && outcome.status !== 200; i++) {
              yield* Effect.sleep("20 millis")
              outcome = McpOAuthCallback.handleCallbackQuery(
                new URLSearchParams({ code: "auth-code-123", state: oauthState! }),
              )
            }
            expect(outcome.status).toBe(200)

            // The forked completion fiber finishes the exchange + reconnects.
            let status = "needs_auth"
            for (let i = 0; i < 100 && status !== "connected"; i++) {
              yield* Effect.sleep("20 millis")
              const all = yield* mcp.status()
              status = all["done"]?.status ?? "needs_auth"
            }
            expect(status).toBe("connected")
          }),
        ).pipe(Effect.provide(MCP.defaultLayer)),
      )
    },
  })
})

test("handleCallbackQuery rejects a missing state parameter (CSRF)", () => {
  const outcome = McpOAuthCallback.handleCallbackQuery(new URLSearchParams({ code: "x" }))
  expect(outcome.status).toBe(400)
  expect(outcome.body).toContain("state parameter")
})

test("handleCallbackQuery rejects an unknown state parameter (CSRF)", () => {
  const outcome = McpOAuthCallback.handleCallbackQuery(
    new URLSearchParams({ code: "x", state: "never-registered-state" }),
  )
  expect(outcome.status).toBe(400)
  expect(outcome.body).toContain("Invalid or expired state")
})

test("handleCallbackQuery surfaces a provider error with HTTP 200", () => {
  const outcome = McpOAuthCallback.handleCallbackQuery(
    new URLSearchParams({ error: "access_denied", error_description: "User said no", state: "s" }),
  )
  expect(outcome.status).toBe(200)
  expect(outcome.body).toContain("User said no")
})

test("resolveCallback escapes a reflected provider error (no XSS)", () => {
  const outcome = McpOAuthCallback.handleCallbackQuery(
    new URLSearchParams({ error: "<script>alert(1)</script>", state: "s" }),
  )
  expect(outcome.body).not.toContain("<script>alert(1)</script>")
  expect(outcome.body).toContain("&lt;script&gt;")
})
