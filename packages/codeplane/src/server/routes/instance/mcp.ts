import { Hono } from "hono"
import type { Context } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MCP } from "@/mcp"
import { McpOAuthCallback } from "@/mcp/oauth-callback"
import { ConfigMCP } from "@/config/mcp"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { Effect } from "effect"
import { makeRuntime } from "@/effect/run-service"

const mcpRuntime = makeRuntime(MCP.Service, MCP.defaultLayer)

// Full path of the server-hosted callback route below (mounted under "/mcp").
const CALLBACK_PATH = "/mcp/oauth/callback"

// Build the redirect URI the OAuth provider should return to. The renderer
// passes its own origin so the redirect lands back on the exact host the
// browser is using (works on web + mobile against a remote instance); we
// validate it's a well-formed http(s) URL at the callback path before trusting
// it, and otherwise reconstruct it from the incoming request's host.
function resolveCallbackRedirect(c: Context, clientValue: unknown): string | undefined {
  if (typeof clientValue === "string" && clientValue) {
    try {
      const url = new URL(clientValue)
      if ((url.protocol === "http:" || url.protocol === "https:") && url.pathname === CALLBACK_PATH) {
        return url.toString()
      }
    } catch {
      // fall through to request-derived value
    }
  }
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim()
  const forwardedHost = c.req.header("x-forwarded-host")?.split(",")[0]?.trim()
  const host = forwardedHost || c.req.header("host")
  if (host) return `${proto || "http"}://${host}${CALLBACK_PATH}`
  try {
    return `${new URL(c.req.url).origin}${CALLBACK_PATH}`
  } catch {
    return undefined
  }
}

export const McpRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get MCP status",
        description: "Get the status of all Model Context Protocol (MCP) servers.",
        operationId: "mcp.status",
        responses: {
          200: {
            description: "MCP server status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status.zod)),
              },
            },
          },
        },
      }),
      async (c) => c.json(await mcpRuntime.runPromise((svc) => svc.status())),
    )
    .post(
      "/",
      describeRoute({
        summary: "Add MCP server",
        description: "Dynamically add a new Model Context Protocol (MCP) server to the system.",
        operationId: "mcp.add",
        responses: {
          200: {
            description: "MCP server added successfully",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status.zod)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          config: ConfigMCP.Info.zod,
        }),
      ),
      async (c) =>
        c.json(
          await mcpRuntime.runPromise((svc) =>
            Effect.gen(function* () {
              const { name, config } = c.req.valid("json")
              const result = yield* svc.add(name, config)
              return result.status
            }),
          ),
        ),
    )
    .post(
      "/auth/auto-connect",
      describeRoute({
        summary: "Auto-connect pending MCP OAuth",
        description:
          "Start interactive OAuth flows for remote MCP servers in this instance that have partial stored auth state.",
        operationId: "mcp.auth.autoConnect",
        responses: {
          200: {
            description: "Pending OAuth launches started",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      name: z.string(),
                      authorizationUrl: z.string(),
                      redirectUri: z.string(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => c.json(await mcpRuntime.runPromise((svc) => svc.autoConnectOAuth())),
    )
    .post(
      "/:name/auth",
      describeRoute({
        summary: "Start MCP OAuth",
        description: "Start OAuth authentication flow for a Model Context Protocol (MCP) server.",
        operationId: "mcp.auth.start",
        responses: {
          200: {
            description: "OAuth flow started",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    authorizationUrl: z.string().describe("URL to open in browser for authorization"),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const result = await mcpRuntime.runPromise((svc) =>
          Effect.gen(function* () {
            const supports = yield* svc.supportsOAuth(name)
            if (!supports) return { supports }
            return {
              supports,
              auth: yield* svc.startAuth(name),
            }
          }),
        )
        if (!result.supports) {
          return c.json({ error: `MCP server ${name} does not support OAuth` }, 400)
        }
        return c.json(result.auth)
      },
    )
    .post(
      "/:name/auth/callback",
      describeRoute({
        summary: "Complete MCP OAuth",
        description:
          "Complete OAuth authentication for a Model Context Protocol (MCP) server using the authorization code.",
        operationId: "mcp.auth.callback",
        responses: {
          200: {
            description: "OAuth authentication completed",
            content: {
              "application/json": {
                schema: resolver(MCP.Status.zod),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          code: z.string().describe("Authorization code from OAuth callback"),
        }),
      ),
      async (c) =>
        c.json(
          await mcpRuntime.runPromise((svc) =>
            Effect.gen(function* () {
              const name = c.req.param("name")
              const { code } = c.req.valid("json")
              return yield* svc.finishAuth(name, code)
            }),
          ),
        ),
    )
    .post(
      "/:name/auth/authenticate",
      describeRoute({
        summary: "Authenticate MCP OAuth",
        description: "Start OAuth flow and wait for callback (opens browser)",
        operationId: "mcp.auth.authenticate",
        responses: {
          200: {
            description: "OAuth authentication completed",
            content: {
              "application/json": {
                schema: resolver(MCP.Status.zod),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const result = await mcpRuntime.runPromise((svc) =>
          Effect.gen(function* () {
            const supports = yield* svc.supportsOAuth(name)
            if (!supports) return { supports }
            return {
              supports,
              status: yield* svc.authenticate(name),
            }
          }),
        )
        if (!result.supports) {
          return c.json({ error: `MCP server ${name} does not support OAuth` }, 400)
        }
        return c.json(result.status)
      },
    )
    .post(
      "/:name/auth/begin",
      describeRoute({
        summary: "Begin MCP OAuth",
        description:
          "Begin an interactive OAuth flow for a remote MCP server without blocking. Returns the authorization URL for the client to open (embedded window on desktop, new tab on web/mobile); completion happens when the provider redirects back to the callback. Poll mcp.status for the result.",
        operationId: "mcp.auth.begin",
        responses: {
          200: {
            description: "OAuth flow begun (authorization URL) or already resolved (status)",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    supports: z.boolean(),
                    authorizationUrl: z.string().optional().describe("URL to open for authorization"),
                    redirectUri: z.string().optional().describe("Redirect URI the provider will return to"),
                    status: MCP.Status.zod.optional().describe("Set when the flow resolved without user interaction"),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      validator("query", z.object({ redirectUri: z.string().optional() })),
      async (c) => {
        const name = c.req.valid("param").name
        // The client passes its own origin so the provider redirects straight
        // back to the codeplane server the browser is already talking to —
        // this is what makes the flow work on web + mobile against a remote
        // instance, where a 127.0.0.1 loopback redirect could never land. We
        // fall back to the request's own host when the client omits it.
        const redirectUri = resolveCallbackRedirect(c, c.req.valid("query").redirectUri)
        const result = await mcpRuntime.runPromise((svc) =>
          Effect.gen(function* () {
            const supports = yield* svc.supportsOAuth(name)
            if (!supports) return { supports }
            return { supports, result: yield* svc.beginAuth(name, redirectUri ? { redirectUri } : undefined) }
          }),
        )
        if (!result.supports) {
          return c.json({ error: `MCP server ${name} does not support OAuth` }, 400)
        }
        return c.json({ supports: true as const, ...result.result })
      },
    )
    .get(
      "/oauth/callback",
      describeRoute({
        summary: "MCP OAuth callback",
        description:
          "Server-hosted OAuth redirect target. The authorization server redirects the user's browser here with ?code & ?state; this completes the matching in-flight flow (validated by the unguessable state) and renders a success/failure page. Reachable from web + mobile, unlike the 127.0.0.1 loopback callback.",
        operationId: "mcp.auth.serverCallback",
        responses: {
          200: { description: "Authorization handled (success or provider error)" },
          400: { description: "Missing or invalid state / code" },
        },
      }),
      (c) => {
        const url = new URL(c.req.url)
        const { status, body } = McpOAuthCallback.handleCallbackQuery(url.searchParams)
        return c.html(body, status as 200 | 400)
      },
    )
    .delete(
      "/:name/auth",
      describeRoute({
        summary: "Remove MCP OAuth",
        description: "Remove OAuth credentials for an MCP server",
        operationId: "mcp.auth.remove",
        responses: {
          200: {
            description: "OAuth credentials removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) =>
        c.json(
          await mcpRuntime.runPromise((svc) =>
            Effect.gen(function* () {
              yield* svc.removeAuth(c.req.param("name"))
              return { success: true as const }
            }),
          ),
        ),
    )
    .post(
      "/:name/connect",
      describeRoute({
        description: "Connect an MCP server",
        operationId: "mcp.connect",
        responses: {
          200: {
            description: "MCP server connected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) =>
        c.json(
          await mcpRuntime.runPromise((svc) =>
            Effect.gen(function* () {
              yield* svc.connect(c.req.valid("param").name)
              return true
            }),
          ),
        ),
    )
    .post(
      "/:name/disconnect",
      describeRoute({
        description: "Disconnect an MCP server",
        operationId: "mcp.disconnect",
        responses: {
          200: {
            description: "MCP server disconnected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) =>
        c.json(
          await mcpRuntime.runPromise((svc) =>
            Effect.gen(function* () {
              yield* svc.disconnect(c.req.valid("param").name)
              return true
            }),
          ),
        ),
    ),
)
