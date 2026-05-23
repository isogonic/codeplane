import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { McpOAuthProvider, OAUTH_CALLBACK_PATH, OAUTH_CALLBACK_PORT } from "../../src/mcp/oauth-provider"
import type { McpAuth } from "../../src/mcp/auth"

const auth = {
  all: () => Effect.succeed({}),
  get: () => Effect.succeed(undefined),
  getForUrl: () => Effect.succeed(undefined),
  set: () => Effect.void,
  remove: () => Effect.void,
  updateTokens: () => Effect.void,
  updateClientInfo: () => Effect.void,
  updateCodeVerifier: () => Effect.void,
  clearCodeVerifier: () => Effect.void,
  updateOAuthState: () => Effect.void,
  getOAuthState: () => Effect.succeed(undefined),
  clearOAuthState: () => Effect.void,
  isTokenExpired: () => Effect.succeed(null),
} satisfies McpAuth.Interface

function provider(config: ConstructorParameters<typeof McpOAuthProvider>[2]) {
  return new McpOAuthProvider("demo", "https://mcp.example.com/sse", config, { onRedirect: () => {} }, auth)
}

describe("McpOAuthProvider", () => {
  test("uses callbackPort when redirectUri is omitted", () => {
    expect(provider({ callbackPort: 34567 }).redirectUrl).toBe(`http://127.0.0.1:34567${OAUTH_CALLBACK_PATH}`)
  })

  test("uses default callback port when no OAuth redirect options are configured", () => {
    expect(provider({}).redirectUrl).toBe(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`)
  })

  test("prefers redirectUri over callbackPort", () => {
    expect(provider({ callbackPort: 34567, redirectUri: "http://127.0.0.1:45678/custom" }).redirectUrl).toBe(
      "http://127.0.0.1:45678/custom",
    )
  })

  test("includes requested scope in dynamic client metadata", () => {
    expect(provider({ scope: "tools:read tools:write" }).clientMetadata.scope).toBe("tools:read tools:write")
  })
})
