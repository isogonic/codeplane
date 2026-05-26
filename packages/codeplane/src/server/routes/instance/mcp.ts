import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MCP } from "@/mcp"
import { ConfigMCP } from "@/config/mcp"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { Effect } from "effect"
import { makeRuntime } from "@/effect/run-service"

const mcpRuntime = makeRuntime(MCP.Service, MCP.defaultLayer)

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
