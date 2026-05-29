import { afterEach, describe, expect, test } from "bun:test"
import {
  CodexAuthPlugin,
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  refreshTokensOnce,
  type IdTokenClaims,
} from "../../src/plugin/codex"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

const pluginInput = {
  client: {} as never,
  project: {} as never,
  directory: "",
  worktree: "",
  experimental_workspace: {
    register() {},
  },
  serverUrl: new URL("https://example.com"),
  $: {} as never,
}

function makeModel(id: string) {
  return {
    id,
    providerID: "openai",
    api: { id, url: "", npm: "@ai-sdk/openai" },
    name: id,
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1, output: 1, cache: { read: 1, write: 1 } },
    limit: { context: 1_000_000, input: 1_000_000, output: 128_000 },
    status: "active" as const,
    options: {},
    headers: {},
    release_date: "",
  }
}

describe("plugin.codex", () => {
  test("removes models the Codex backend rejects, keeps supported ones", async () => {
    const hooks = await CodexAuthPlugin(pluginInput)
    // Slugs OpenAI's Codex backend rejects for ChatGPT accounts (verified live).
    const removed = [
      "gpt-5.5-pro",
      "gpt-5-codex",
      "gpt-5.1-codex",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
      "gpt-5.2-codex",
    ]
    // Slugs the backend accepts and we should still offer.
    const kept = ["gpt-5.2", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5"]
    const provider = {
      id: "openai",
      name: "OpenAI",
      source: "api" as const,
      env: [],
      options: {},
      models: Object.fromEntries([...removed, ...kept].map((id) => [id, makeModel(id)])),
    }

    await hooks.auth!.loader!(async () => ({ type: "oauth", refresh: "", access: "", expires: Date.now() }), provider)

    for (const id of removed) expect(provider.models[id], `${id} should be removed`).toBeUndefined()
    for (const id of kept) expect(provider.models[id], `${id} should be kept`).toBeDefined()
  })

  test("keeps a future integer-major model (gpt-6) but still drops older ones", async () => {
    const hooks = await CodexAuthPlugin(pluginInput)
    const provider = {
      id: "openai",
      name: "OpenAI",
      source: "api" as const,
      env: [],
      options: {},
      models: { "gpt-6": makeModel("gpt-6"), "gpt-4o": makeModel("gpt-4o") },
    }

    await hooks.auth!.loader!(async () => ({ type: "oauth", refresh: "", access: "", expires: Date.now() }), provider)

    expect(provider.models["gpt-6"]).toBeDefined()
    expect(provider.models["gpt-4o"]).toBeUndefined()
  })

  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

// Route fetch calls to the token endpoint vs the codex request endpoint.
function stubFetch(opts: {
  onToken: () => Record<string, unknown>
  onRequest?: (url: string, init: RequestInit | undefined) => void
}) {
  let tokenCalls = 0
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = url instanceof URL ? url.toString() : typeof url === "string" ? url : url.url
    if (u.includes("/oauth/token")) {
      tokenCalls++
      await Promise.resolve()
      return new Response(JSON.stringify(opts.onToken()), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    opts.onRequest?.(u, init)
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof globalThis.fetch
  return () => tokenCalls
}

describe("refreshTokensOnce", () => {
  test("single-flights concurrent refreshes, then refreshes again once settled", async () => {
    const tokenCalls = stubFetch({
      onToken: () => ({ access_token: "a", refresh_token: "r", expires_in: 3600 }),
    })
    const [a, b] = await Promise.all([refreshTokensOnce("rt"), refreshTokensOnce("rt")])
    expect(tokenCalls()).toBe(1)
    expect(a).toBe(b)
    // inflight cleared after settle → a fresh call hits the network again
    await refreshTokensOnce("rt")
    expect(tokenCalls()).toBe(2)
  })

  test("a 400 refresh failure throws an actionable, body-bearing error", async () => {
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = url instanceof URL ? url.toString() : typeof url === "string" ? url : url.url
      if (u.includes("/oauth/token")) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
      }
      return new Response("{}", { status: 200 })
    }) as typeof globalThis.fetch

    const err = await refreshTokensOnce("dead-token").then(
      () => undefined,
      (e) => e as Error,
    )
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toContain("reconnect the provider")
    expect(err!.message).toContain("invalid_grant")
  })
})

describe("codex oauth fetch (refresh path)", () => {
  function makeLoaderInput() {
    const setCalls: any[] = []
    const input = {
      ...pluginInput,
      client: { auth: { set: async (a: any) => void setCalls.push(a) } } as never,
    }
    return { input, setCalls }
  }
  const emptyProvider = { id: "openai", name: "OpenAI", source: "api" as const, env: [], options: {}, models: {} }

  test("refreshes an expired token and sends the request with the new bearer", async () => {
    const { input, setCalls } = makeLoaderInput()
    const hooks = await CodexAuthPlugin(input)
    const current: any = { type: "oauth", refresh: "old-refresh", access: "old-access", expires: 0, accountId: "acc" }
    const opts: any = await hooks.auth!.loader!(async () => current, emptyProvider)

    let sent: { url: string; init: RequestInit | undefined } | undefined
    stubFetch({
      onToken: () => ({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
      onRequest: (url, init) => (sent = { url, init }),
    })

    await opts.fetch("https://api.openai.com/v1/responses", { method: "POST", body: "{}" })

    // persisted the rotated credentials
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0].auth.access).toBe("new-access")
    expect(setCalls[0].auth.refresh).toBe("new-refresh")
    // request went to the codex endpoint with the fresh bearer + account header
    expect(sent!.url).toBe("https://chatgpt.com/backend-api/codex/responses")
    const headers = sent!.init!.headers as Headers
    expect(headers.get("authorization")).toBe("Bearer new-access")
    expect(headers.get("chatgpt-account-id")).toBe("acc")
  })

  test("preserves the existing refresh token when the response omits one", async () => {
    const { input, setCalls } = makeLoaderInput()
    const hooks = await CodexAuthPlugin(input)
    const current: any = { type: "oauth", refresh: "old-refresh", access: "old-access", expires: 0 }
    const opts: any = await hooks.auth!.loader!(async () => current, emptyProvider)

    stubFetch({ onToken: () => ({ access_token: "new-access", expires_in: 3600 }) })

    await opts.fetch("https://api.openai.com/v1/responses", { method: "POST", body: "{}" })

    expect(setCalls[0].auth.access).toBe("new-access")
    expect(setCalls[0].auth.refresh).toBe("old-refresh")
  })

  test("concurrent requests on an expired token trigger a single refresh", async () => {
    const { input } = makeLoaderInput()
    const hooks = await CodexAuthPlugin(input)
    const current: any = { type: "oauth", refresh: "old-refresh", access: "old-access", expires: 0 }
    const opts: any = await hooks.auth!.loader!(async () => current, emptyProvider)

    const tokenCalls = stubFetch({
      onToken: () => ({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
    })

    await Promise.all([
      opts.fetch("https://api.openai.com/v1/responses", { method: "POST", body: "{}" }),
      opts.fetch("https://api.openai.com/v1/responses", { method: "POST", body: "{}" }),
    ])

    expect(tokenCalls()).toBe(1)
  })

  test("does not refresh a token that is still comfortably valid", async () => {
    const { input, setCalls } = makeLoaderInput()
    const hooks = await CodexAuthPlugin(input)
    const current: any = {
      type: "oauth",
      refresh: "r",
      access: "valid-access",
      expires: Date.now() + 3600_000,
      accountId: "acc",
    }
    const opts: any = await hooks.auth!.loader!(async () => current, emptyProvider)

    let sent: { init: RequestInit | undefined } | undefined
    const tokenCalls = stubFetch({
      onToken: () => ({ access_token: "should-not-happen", expires_in: 3600 }),
      onRequest: (_url, init) => (sent = { init }),
    })

    await opts.fetch("https://api.openai.com/v1/responses", { method: "POST", body: "{}" })

    expect(tokenCalls()).toBe(0)
    expect(setCalls).toHaveLength(0)
    expect((sent!.init!.headers as Headers).get("authorization")).toBe("Bearer valid-access")
  })
})

describe("codex headless device flow", () => {
  test("stops polling and fails once the device code has expired", async () => {
    let tokenPolls = 0
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = url instanceof URL ? url.toString() : typeof url === "string" ? url : url.url
      if (u.includes("/deviceauth/usercode")) {
        // negative expires_in → the poll deadline is already in the past
        return new Response(
          JSON.stringify({ device_auth_id: "dev-1", user_code: "ABCD-EFGH", interval: "1", expires_in: -1 }),
          { status: 200 },
        )
      }
      if (u.includes("/deviceauth/token")) {
        tokenPolls++
        return new Response("{}", { status: 403 })
      }
      return new Response("{}", { status: 200 })
    }) as typeof globalThis.fetch

    const hooks = await CodexAuthPlugin(pluginInput)
    const method = hooks.auth!.methods!.find((m: any) => m.label.includes("headless")) as any
    const flow = await method.authorize()
    const result = await flow.callback()

    expect(result.type).toBe("failed")
    // deadline is checked before polling, so the token endpoint is never hit
    expect(tokenPolls).toBe(0)
  })
})
