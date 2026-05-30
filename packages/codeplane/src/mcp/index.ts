import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Config } from "../config"
import { ConfigMCP } from "../config/mcp"
import { ConfigVariable } from "../config/variable"
import { Log } from "../util"
import { NamedError } from "@codeplane-ai/shared/util/error"
import { errorMessage } from "../util/error"
import path from "path"
import z from "zod/v4"
import { Installation } from "../installation"
import { InstallationVersion } from "../installation/version"
import { withTimeout } from "@/util/timeout"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import open from "open"
import { Effect, Exit, Fiber, Layer, Option, Context, Schema, Scope, Stream } from "effect"
import { EffectBridge } from "@/effect"
import { InstanceState } from "@/effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { zod as effectZod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { Global } from "@/global"

const log = Log.create({ service: "mcp" })
const DEFAULT_TIMEOUT = 30_000

export const Resource = z
  .object({
    name: z.string(),
    uri: z.string(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    client: z.string(),
  })
  .meta({ ref: "McpResource" })
export type Resource = z.infer<typeof Resource>

export const ToolsChanged = BusEvent.define(
  "mcp.tools.changed",
  Schema.Struct({
    server: Schema.String,
  }),
)

export const BrowserOpenFailed = BusEvent.define(
  "mcp.browser.open.failed",
  Schema.Struct({
    mcpName: Schema.String,
    url: Schema.String,
  }),
)

export const Failed = NamedError.create(
  "MCPFailed",
  z.object({
    name: z.string(),
  }),
)

type MCPClient = Client

const StatusConnected = Schema.Struct({ status: Schema.Literal("connected") }).annotate({
  identifier: "MCPStatusConnected",
})
const StatusDisabled = Schema.Struct({ status: Schema.Literal("disabled") }).annotate({
  identifier: "MCPStatusDisabled",
})
const StatusFailed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).annotate({
  identifier: "MCPStatusFailed",
})
const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") }).annotate({
  identifier: "MCPStatusNeedsAuth",
})
const StatusNeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
}).annotate({ identifier: "MCPStatusNeedsClientRegistration" })

export const Status = Schema.Union([
  StatusConnected,
  StatusDisabled,
  StatusFailed,
  StatusNeedsAuth,
  StatusNeedsClientRegistration,
])
  .annotate({ identifier: "MCPStatus", discriminator: "status" })
  .pipe(withStatics((s) => ({ zod: effectZod(s) })))
export type Status = Schema.Schema.Type<typeof Status>

// Store transports for OAuth servers to allow finishing auth
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport

// Prompt cache types
type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
type McpEntry = NonNullable<Config.Info["mcp"]>[string]

function isMcpConfigured(entry: McpEntry): entry is ConfigMCP.Info {
  return typeof entry === "object" && entry !== null && "type" in entry
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

export type ToolFailureKind =
  | "auth_required"
  | "client_registration_required"
  | "transport_closed"
  | "handler_error"
  | "unknown"

export interface ToolFailure {
  kind: ToolFailureKind
  action: "authorize" | "configure" | "reconnect" | "check_server" | "retry"
  retryable: boolean
  summary: string
  nextStep: string
  error: string
  tool: string
  server?: string
}

const clientRegistrationPattern = /\b(client[_ -]?(registration|id|secret)|invalid_client|oauth client)\b/i
const authPattern = /\b(401|403|unauthorized|forbidden|authorization required|authentication required)\b/i
const transportClosedPattern =
  /\b(transport[-_ ]?closed|connection(?: was)? closed|socket hang up|disconnected|econnreset|broken pipe|stream ended)\b/i
const handlerErrorPattern = /\b(handler[-_ ]?error|handler error|json-rpc error|rpc error|server error)\b/i

export function classifyToolFailure(input: { error: unknown; tool: string; server?: string }): ToolFailure {
  const message = errorMessage(input.error)

  if (clientRegistrationPattern.test(message)) {
    return {
      kind: "client_registration_required",
      action: "configure",
      retryable: false,
      summary: "The MCP server needs client registration details before this tool can run.",
      nextStep: "Ask the user to configure the MCP server's client ID and client secret, then retry the tool.",
      error: message,
      tool: input.tool,
      ...(input.server ? { server: input.server } : {}),
    }
  }

  if (input.error instanceof UnauthorizedError || authPattern.test(message)) {
    return {
      kind: "auth_required",
      action: "authorize",
      retryable: false,
      summary: "The MCP server rejected this tool call because it needs authorization.",
      nextStep: "Ask the user to authorize or sign in to this MCP server, then retry the same tool.",
      error: message,
      tool: input.tool,
      ...(input.server ? { server: input.server } : {}),
    }
  }

  if (transportClosedPattern.test(message)) {
    return {
      kind: "transport_closed",
      action: "reconnect",
      retryable: true,
      summary: "The MCP transport closed before the tool could finish.",
      nextStep: "Retry the tool once. If it fails again, ask the user to reconnect or restart the MCP server before retrying.",
      error: message,
      tool: input.tool,
      ...(input.server ? { server: input.server } : {}),
    }
  }

  if (handlerErrorPattern.test(message)) {
    return {
      kind: "handler_error",
      action: "check_server",
      retryable: false,
      summary: "The MCP server reported an internal handler error while running the tool.",
      nextStep: "Tell the user the MCP server failed internally and ask them to inspect or fix that server before retrying.",
      error: message,
      tool: input.tool,
      ...(input.server ? { server: input.server } : {}),
    }
  }

  return {
    kind: "unknown",
    action: "retry",
    retryable: true,
    summary: "The MCP tool failed with an unclassified error.",
    nextStep: "Retry the tool once. If it still fails, surface the error to the user and ask them to inspect the MCP server.",
    error: message,
    tool: input.tool,
    ...(input.server ? { server: input.server } : {}),
  }
}

// Convert MCP tool definition to AI SDK Tool type
function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Tool {
  const inputSchema = mcpTool.inputSchema

  // Spread first, then override type to ensure it's always "object"
  const schema: JSONSchema7 = {
    ...(inputSchema as JSONSchema7),
    type: "object",
    properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: false,
  }

  return dynamicTool({
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown) => {
      return client.callTool(
        {
          name: mcpTool.name,
          arguments: (args || {}) as Record<string, unknown>,
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          timeout,
        },
      )
    },
  })
}

function defs(key: string, client: MCPClient, timeout?: number) {
  return Effect.tryPromise({
    try: () => withTimeout(client.listTools(), timeout ?? DEFAULT_TIMEOUT),
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  }).pipe(
    Effect.map((result) => result.tools),
    Effect.catch((err) => {
      log.error("failed to get tools from client", { key, error: err })
      return Effect.succeed(undefined)
    }),
  )
}

function fetchFromClient<T extends { name: string }>(
  clientName: string,
  client: Client,
  listFn: (c: Client) => Promise<T[]>,
  label: string,
) {
  return Effect.tryPromise({
    try: () => listFn(client),
    catch: (e: any) => {
      log.error(`failed to get ${label}`, { clientName, error: e.message })
      return e
    },
  }).pipe(
    Effect.map((items) => {
      const out: Record<string, T & { client: string }> = {}
      const sanitizedClient = sanitize(clientName)
      for (const item of items) {
        out[sanitizedClient + ":" + sanitize(item.name)] = { ...item, client: clientName }
      }
      return out
    }),
    Effect.orElseSucceed(() => undefined),
  )
}

interface CreateResult {
  mcpClient?: MCPClient
  status: Status
  defs?: MCPToolDef[]
}

interface AuthResult {
  authorizationUrl: string
  oauthState: string
  redirectUri: string
  client?: MCPClient
}

export interface InteractiveAuthLaunch {
  name: string
  authorizationUrl: string
  redirectUri: string
}

interface InteractiveAuthFlow extends InteractiveAuthLaunch {
  oauthState: string
  fiber: Fiber.Fiber<Status, never>
}

// --- Effect Service ---

interface State {
  status: Record<string, Status>
  clients: Record<string, MCPClient>
  defs: Record<string, MCPToolDef[]>
  pendingOAuthTransports: Map<string, TransportWithAuth>
  interactiveAuths: Map<string, InteractiveAuthFlow>
  scope: Scope.Scope
  toolCache: Record<string, { defs: MCPToolDef[]; timeout: number | undefined; tools: Record<string, Tool> }>
  toolsCache?: { version: number; timeoutKey: string; tools: Record<string, Tool> }
  toolVersion: number
}

export interface Interface {
  readonly status: () => Effect.Effect<Record<string, Status>>
  readonly clients: () => Effect.Effect<Record<string, MCPClient>>
  readonly tools: () => Effect.Effect<Record<string, Tool>>
  readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>
  readonly resources: () => Effect.Effect<Record<string, ResourceInfo & { client: string }>>
  readonly add: (name: string, mcp: ConfigMCP.Info) => Effect.Effect<{ status: Record<string, Status> | Status }>
  readonly connect: (name: string) => Effect.Effect<void>
  readonly disconnect: (name: string) => Effect.Effect<void>
  readonly getPrompt: (
    clientName: string,
    name: string,
    args?: Record<string, string>,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["getPrompt"]>> | undefined>
  readonly readResource: (
    clientName: string,
    resourceUri: string,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["readResource"]>> | undefined>
  readonly startAuth: (mcpName: string) => Effect.Effect<{ authorizationUrl: string; oauthState: string }>
  readonly authenticate: (mcpName: string) => Effect.Effect<Status>
  readonly autoConnectOAuth: () => Effect.Effect<InteractiveAuthLaunch[]>
  readonly finishAuth: (mcpName: string, authorizationCode: string) => Effect.Effect<Status>
  readonly removeAuth: (mcpName: string) => Effect.Effect<void>
  readonly supportsOAuth: (mcpName: string) => Effect.Effect<boolean>
  readonly hasStoredTokens: (mcpName: string) => Effect.Effect<boolean>
  readonly getAuthStatus: (mcpName: string) => Effect.Effect<AuthStatus>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/MCP") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const auth = yield* McpAuth.Service
    const bus = yield* Bus.Service

    type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

    /**
     * Connect a client via the given transport with resource safety:
     * on failure the transport is closed; on success the caller owns it.
     */
    const connectTransport = (transport: Transport, timeout: number) =>
      Effect.acquireUseRelease(
        Effect.succeed(transport),
        (t) =>
          Effect.tryPromise({
            try: () => {
              const client = new Client({ name: "codeplane", version: InstallationVersion })
              return withTimeout(client.connect(t), timeout).then(() => client)
            },
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          }),
        (t, exit) => (Exit.isFailure(exit) ? Effect.tryPromise(() => t.close()).pipe(Effect.ignore) : Effect.void),
      )

    const DISABLED_RESULT: CreateResult = { status: { status: "disabled" } }

    const connectRemote = Effect.fn("MCP.connectRemote")(function* (
      key: string,
      mcp: ConfigMCP.Info & { type: "remote" },
      pendingOAuthTransports: Map<string, TransportWithAuth>,
    ) {
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      let authProvider: McpOAuthProvider | undefined

      if (!oauthDisabled) {
        authProvider = new McpOAuthProvider(
          key,
          mcp.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
            callbackPort: oauthConfig?.callbackPort,
            redirectUri: oauthConfig?.redirectUri,
          },
          {
            onRedirect: async (url) => {
              log.info("oauth redirect requested", { key, url: url.toString() })
            },
          },
          auth,
        )
      }

      const transports: Array<{ name: string; transport: TransportWithAuth }> = [
        {
          name: "StreamableHTTP",
          transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
        {
          name: "SSE",
          transport: new SSEClientTransport(new URL(mcp.url), {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
      ]

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      let lastStatus: Status | undefined

      for (const { name, transport } of transports) {
        const result = yield* connectTransport(transport, connectTimeout).pipe(
          Effect.map((client) => ({ client, transportName: name })),
          Effect.catch((error) => {
            const lastError = error instanceof Error ? error : new Error(String(error))
            const isAuthError =
              error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))

            if (isAuthError) {
              log.info("mcp server requires authentication", { key, transport: name })

              if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
                lastStatus = {
                  status: "needs_client_registration" as const,
                  error: "Server does not support dynamic client registration. Please provide clientId in config.",
                }
                log.warn("mcp server requires pre-registered client id", { key })
                return Effect.succeed(undefined)
              }

              pendingOAuthTransports.set(key, transport)
              lastStatus = { status: "needs_auth" as const }
              log.warn("mcp server requires authentication", { key })
              return Effect.succeed(undefined)
            }

            log.debug("transport connection failed", {
              key,
              transport: name,
              url: mcp.url,
              error: lastError.message,
            })
            lastStatus = { status: "failed" as const, error: lastError.message }
            return Effect.succeed(undefined)
          }),
        )
        if (result) {
          log.info("connected", { key, transport: result.transportName })
          return { client: result.client as MCPClient | undefined, status: { status: "connected" } as Status }
        }
        // If this was an auth error, stop trying other transports
        if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") break
      }

      return {
        client: undefined as MCPClient | undefined,
        status: (lastStatus ?? { status: "failed", error: "Unknown error" }) as Status,
      }
    })

    const connectLocal = Effect.fn("MCP.connectLocal")(function* (
      key: string,
      mcp: ConfigMCP.Info & { type: "local" },
    ) {
      const [cmd, ...args] = mcp.command
      const cwd = yield* InstanceState.directory
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env: {
          ...process.env,
          ...(cmd === "codeplane" ? { BUN_BE_BUN: "1" } : {}),
          ...mcp.environment,
        },
      })
      transport.stderr?.on("data", (chunk: Buffer) => {
        log.info(`mcp stderr: ${chunk.toString()}`, { key })
      })

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      return yield* connectTransport(transport, connectTimeout).pipe(
        Effect.map((client): { client: MCPClient | undefined; status: Status } => ({
          client,
          status: { status: "connected" },
        })),
        Effect.catch((error): Effect.Effect<{ client: MCPClient | undefined; status: Status }> => {
          const msg = error instanceof Error ? error.message : String(error)
          log.error("local mcp startup failed", { key, command: mcp.command, cwd, error: msg })
          return Effect.succeed({ client: undefined, status: { status: "failed", error: msg } })
        }),
      )
    })

    const resolveMcpConfig = Effect.fnUntraced(function* (mcp: ConfigMCP.Info) {
      return (yield* Effect.promise(() =>
        ConfigVariable.resolveUnknown({
          value: mcp,
          type: "path",
          path: path.join(Global.Path.config, "codeplane.jsonc"),
        }),
      )) as ConfigMCP.Info
    })

    const create = Effect.fn("MCP.create")(function* (
      key: string,
      mcp: ConfigMCP.Info,
      pendingOAuthTransports: Map<string, TransportWithAuth>,
    ) {
      if (mcp.enabled === false) {
        log.info("mcp server disabled", { key })
        return DISABLED_RESULT
      }

      log.info("found", { key, type: mcp.type })

      const { client: mcpClient, status } =
        mcp.type === "remote"
          ? yield* connectRemote(key, mcp as ConfigMCP.Info & { type: "remote" }, pendingOAuthTransports)
          : yield* connectLocal(key, mcp as ConfigMCP.Info & { type: "local" })

      if (!mcpClient) {
        return { status } satisfies CreateResult
      }

      const listed = yield* defs(key, mcpClient, mcp.timeout)
      if (!listed) {
        yield* Effect.tryPromise(() => mcpClient.close()).pipe(Effect.ignore)
        return { status: { status: "failed", error: "Failed to get tools" } } satisfies CreateResult
      }

      log.info("create() successfully created client", { key, toolCount: listed.length })
      return { mcpClient, status, defs: listed } satisfies CreateResult
    })
    const cfgSvc = yield* Config.Service

    const descendants = Effect.fnUntraced(
      function* (pid: number) {
        if (process.platform === "win32") return [] as number[]
        const pids: number[] = []
        const queue = [pid]
        while (queue.length > 0) {
          const current = queue.shift()!
          const handle = yield* spawner.spawn(ChildProcess.make("pgrep", ["-P", String(current)], { stdin: "ignore" }))
          const text = yield* Stream.mkString(Stream.decodeText(handle.stdout))
          yield* handle.exitCode
          for (const tok of text.split("\n")) {
            const cpid = parseInt(tok, 10)
            if (!isNaN(cpid) && !pids.includes(cpid)) {
              pids.push(cpid)
              queue.push(cpid)
            }
          }
        }
        return pids
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed([] as number[])),
    )

    function invalidateTools(s: State) {
      s.toolVersion++
      delete s.toolsCache
    }

    function watch(s: State, name: string, client: MCPClient, bridge: EffectBridge.Shape, timeout?: number) {
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        log.info("tools list changed notification received", { server: name })
        if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

        const listed = await bridge.promise(defs(name, client, timeout))
        if (!listed) return
        if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

        s.defs[name] = listed
        delete s.toolCache[name]
        invalidateTools(s)
        await bridge.promise(bus.publish(ToolsChanged, { server: name }).pipe(Effect.ignore))
      })
    }

    const state = yield* InstanceState.make<State>(
      Effect.fn("MCP.state")(function* () {
        const cfg = yield* cfgSvc.get()
        const bridge = yield* EffectBridge.make()
        const config = cfg.mcp ?? {}
        const s: State = {
          status: {},
          clients: {},
          defs: {},
          pendingOAuthTransports: new Map(),
          interactiveAuths: new Map(),
          scope: yield* Scope.make(),
          toolCache: {},
          toolVersion: 0,
        }

        yield* Effect.forEach(
          Object.entries(config),
          ([key, mcp]) =>
            Effect.gen(function* () {
              if (!isMcpConfigured(mcp)) {
                log.error("Ignoring MCP config entry without type", { key })
                return
              }

              if (mcp.enabled === false) {
                s.status[key] = { status: "disabled" }
                return
              }

              const result = yield* create(key, mcp, s.pendingOAuthTransports).pipe(Effect.catch(() => Effect.void))
              if (!result) return

              s.status[key] = result.status
              if (result.mcpClient) {
                s.clients[key] = result.mcpClient
                s.defs[key] = result.defs!
                watch(s, key, result.mcpClient, bridge, mcp.timeout)
              }
            }),
          { concurrency: "unbounded" },
        )

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* Scope.close(s.scope, Exit.void)
            yield* Effect.forEach(
              Object.values(s.clients),
              (client) =>
                Effect.gen(function* () {
                  const pid = client.transport instanceof StdioClientTransport ? client.transport.pid : null
                  if (typeof pid === "number") {
                    const pids = yield* descendants(pid)
                    for (const dpid of pids) {
                      try {
                        process.kill(dpid, "SIGTERM")
                      } catch {}
                    }
                  }
                  yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
                }),
              { concurrency: "unbounded" },
            )
            s.pendingOAuthTransports.clear()
            s.interactiveAuths.clear()
          }),
        )

        return s
      }),
    )

    function closeClient(s: State, name: string) {
      const client = s.clients[name]
      delete s.defs[name]
      delete s.toolCache[name]
      invalidateTools(s)
      if (!client) return Effect.void
      // Kill the server's whole descendant tree, not just the server process —
      // a per-server disconnect/reconnect otherwise orphans the server's own
      // subprocesses (grandchildren). Mirrors the shutdown finalizer, which
      // already does this; closeClient previously only called client.close().
      return Effect.gen(function* () {
        const pid = client.transport instanceof StdioClientTransport ? client.transport.pid : null
        if (typeof pid === "number") {
          const pids = yield* descendants(pid)
          for (const dpid of pids) {
            try {
              process.kill(dpid, "SIGTERM")
            } catch {}
          }
        }
        yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
      })
    }

    const storeClient = Effect.fnUntraced(function* (
      s: State,
      name: string,
      client: MCPClient,
      listed: MCPToolDef[],
      timeout?: number,
    ) {
      const bridge = yield* EffectBridge.make()
      yield* closeClient(s, name)
      s.status[name] = { status: "connected" }
      s.clients[name] = client
      s.defs[name] = listed
      watch(s, name, client, bridge, timeout)
      return s.status[name]!
    })

    const status = Effect.fn("MCP.status")(function* () {
      const s = yield* InstanceState.get(state)

      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const result: Record<string, Status> = {}

      for (const [key, mcp] of Object.entries(config)) {
        if (!isMcpConfigured(mcp)) continue
        result[key] = s.status[key] ?? { status: "disabled" }
      }

      return result
    })

    const clients = Effect.fn("MCP.clients")(function* () {
      const s = yield* InstanceState.get(state)
      return s.clients
    })

    const createAndStore = Effect.fn("MCP.createAndStore")(function* (name: string, mcp: ConfigMCP.Info) {
      const s = yield* InstanceState.get(state)
      const result = yield* create(name, yield* resolveMcpConfig(mcp), s.pendingOAuthTransports)

      s.status[name] = result.status
      if (!result.mcpClient) {
        yield* closeClient(s, name)
        delete s.clients[name]
        return result.status
      }

      return yield* storeClient(s, name, result.mcpClient, result.defs!, mcp.timeout)
    })

    const add = Effect.fn("MCP.add")(function* (name: string, mcp: ConfigMCP.Info) {
      yield* createAndStore(name, mcp)
      const s = yield* InstanceState.get(state)
      return { status: s.status }
    })

    const connect = Effect.fn("MCP.connect")(function* (name: string) {
      const mcp = yield* getMcpConfig(name)
      if (!mcp) {
        log.error("MCP config not found or invalid", { name })
        return
      }
      yield* createAndStore(name, { ...mcp, enabled: true })
    })

    const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      yield* closeClient(s, name)
      delete s.clients[name]
      s.status[name] = { status: "disabled" }
    })

    const tools = Effect.fn("MCP.tools")(function* () {
      const s = yield* InstanceState.get(state)

      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const defaultTimeout = cfg.experimental?.mcp_timeout

      const connectedClients = Object.entries(s.clients).flatMap(([clientName, client]) => {
        if (s.status[clientName]?.status !== "connected") return []
        const mcpConfig = config[clientName]
        const entry = mcpConfig && isMcpConfigured(mcpConfig) ? mcpConfig : undefined
        return [{ clientName, client, timeout: entry?.timeout ?? defaultTimeout }]
      })

      const timeoutKey = connectedClients.map((item) => [item.clientName, item.timeout ?? ""].join("\x00")).join("\x1f")
      if (s.toolsCache?.version === s.toolVersion && s.toolsCache.timeoutKey === timeoutKey) {
        return s.toolsCache.tools
      }

      yield* Effect.forEach(
        connectedClients,
        (item) =>
          Effect.gen(function* () {
            const listed = s.defs[item.clientName]
            if (!listed) {
              log.warn("missing cached tools for connected server", { clientName: item.clientName })
              return
            }

            const cached = s.toolCache[item.clientName]
            if (cached?.defs === listed && cached.timeout === item.timeout) {
              return
            }
            const tools: Record<string, Tool> = {}
            for (const mcpTool of listed) {
              tools[sanitize(item.clientName) + "_" + sanitize(mcpTool.name)] = convertMcpTool(
                mcpTool,
                item.client,
                item.timeout,
              )
            }
            s.toolCache[item.clientName] = { defs: listed, timeout: item.timeout, tools }
          }),
        { concurrency: "unbounded" },
      )

      const result = Object.assign(
        {},
        ...connectedClients.map((item) => s.toolCache[item.clientName]?.tools ?? {}),
      ) as Record<string, Tool>
      s.toolsCache = { version: s.toolVersion, timeoutKey, tools: result }
      return result
    })

    function collectFromConnected<T extends { name: string }>(
      s: State,
      listFn: (c: Client) => Promise<T[]>,
      label: string,
    ) {
      return Effect.forEach(
        Object.entries(s.clients).filter(([name]) => s.status[name]?.status === "connected"),
        ([clientName, client]) =>
          fetchFromClient(clientName, client, listFn, label).pipe(Effect.map((items) => Object.entries(items ?? {}))),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((results) => Object.fromEntries<T & { client: string }>(results.flat())))
    }

    const prompts = Effect.fn("MCP.prompts")(function* () {
      const s = yield* InstanceState.get(state)
      return yield* collectFromConnected(s, (c) => c.listPrompts().then((r) => r.prompts), "prompts")
    })

    const resources = Effect.fn("MCP.resources")(function* () {
      const s = yield* InstanceState.get(state)
      return yield* collectFromConnected(s, (c) => c.listResources().then((r) => r.resources), "resources")
    })

    const withClient = Effect.fnUntraced(function* <A>(
      clientName: string,
      fn: (client: MCPClient) => Promise<A>,
      label: string,
      meta?: Record<string, unknown>,
    ) {
      const s = yield* InstanceState.get(state)
      const client = s.clients[clientName]
      if (!client) {
        log.warn(`client not found for ${label}`, { clientName })
        return undefined
      }
      return yield* Effect.tryPromise({
        try: () => fn(client),
        catch: (e: any) => {
          log.error(`failed to ${label}`, { clientName, ...meta, error: e?.message })
          return e
        },
      }).pipe(Effect.orElseSucceed(() => undefined))
    })

    const getPrompt = Effect.fn("MCP.getPrompt")(function* (
      clientName: string,
      name: string,
      args?: Record<string, string>,
    ) {
      return yield* withClient(clientName, (client) => client.getPrompt({ name, arguments: args }), "getPrompt", {
        promptName: name,
      })
    })

    const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
      return yield* withClient(clientName, (client) => client.readResource({ uri: resourceUri }), "readResource", {
        resourceUri,
      })
    })

    const getMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
      const cfg = yield* cfgSvc.get()
      const mcpConfig = cfg.mcp?.[mcpName]
      if (!mcpConfig || !isMcpConfigured(mcpConfig)) return undefined
      return mcpConfig
    })

    const oauthCallbackKey = Effect.fnUntraced(function* (mcpName: string) {
      return `${yield* InstanceState.directory}\x00${mcpName}`
    })

    const startAuth = Effect.fn("MCP.startAuth")(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) throw new Error(`MCP server ${mcpName} not found or disabled`)
      if (mcpConfig.type !== "remote") throw new Error(`MCP server ${mcpName} is not a remote server`)
      if (mcpConfig.oauth === false) throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)

      // OAuth config is optional - if not provided, we'll use auto-discovery
      const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined
      const s = yield* InstanceState.get(state)

      // Start the callback server with custom redirectUri if configured
      yield* Effect.promise(() => McpOAuthCallback.ensureRunning(oauthConfig?.redirectUri))

      const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      yield* auth.updateOAuthState(mcpName, oauthState)
      let capturedUrl: URL | undefined
      const authProvider = new McpOAuthProvider(
        mcpName,
        mcpConfig.url,
        {
          clientId: oauthConfig?.clientId,
          clientSecret: oauthConfig?.clientSecret,
          scope: oauthConfig?.scope,
          redirectUri: oauthConfig?.redirectUri,
        },
        {
          onRedirect: async (url) => {
            capturedUrl = url
          },
        },
        auth,
      )

      const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), { authProvider })

      return yield* Effect.tryPromise({
        try: () => {
          const client = new Client({ name: "codeplane", version: InstallationVersion })
          return client
            .connect(transport)
            .then(() => ({
              authorizationUrl: "",
              oauthState,
              redirectUri: authProvider.redirectUrl,
              client,
            }) satisfies AuthResult)
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) => {
          if (error instanceof UnauthorizedError && capturedUrl) {
            s.pendingOAuthTransports.set(mcpName, transport)
            return Effect.succeed({
              authorizationUrl: capturedUrl.toString(),
              oauthState,
              redirectUri: authProvider.redirectUrl,
            } satisfies AuthResult)
          }
          return Effect.die(error)
        }),
      )
    })

    const beginInteractiveAuth = Effect.fn("MCP.beginInteractiveAuth")(function* (mcpName: string) {
      const s = yield* InstanceState.get(state)
      const existing = s.interactiveAuths.get(mcpName)
      if (existing) return { flow: existing } as const

      const result = yield* startAuth(mcpName)
      if (!result.authorizationUrl) {
        const client = "client" in result ? result.client : undefined
        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) {
          yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          return { status: { status: "failed", error: "MCP config not found after auth" } as Status } as const
        }

        const listed = client ? yield* defs(mcpName, client, mcpConfig.timeout) : undefined
        if (!client || !listed) {
          yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          return { status: { status: "failed", error: "Failed to get tools" } as Status } as const
        }

        yield* auth.clearOAuthState(mcpName)
        return { status: yield* storeClient(s, mcpName, client, listed, mcpConfig.timeout) } as const
      }

      const callbackKey = yield* oauthCallbackKey(mcpName)
      const complete: Effect.Effect<Status, never, never> = Effect.gen(function* () {
        const code = yield* Effect.promise(() => McpOAuthCallback.waitForCallback(result.oauthState, callbackKey))
        const storedState = yield* auth.getOAuthState(mcpName)
        if (storedState !== result.oauthState) {
          yield* auth.clearOAuthState(mcpName)
          return { status: "failed", error: "OAuth state mismatch - potential CSRF attack" } as Status
        }
        yield* auth.clearOAuthState(mcpName)
        return yield* finishAuth(mcpName, code)
      }).pipe(
        Effect.catch((error) => Effect.succeed({ status: "failed", error: errorMessage(error) } as Status)),
        Effect.tap((next) =>
          Effect.sync(() => {
            if (next.status !== "connected") s.status[mcpName] = next
          }),
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            McpOAuthCallback.cancelPending(callbackKey)
            yield* auth.clearOAuthState(mcpName).pipe(Effect.ignore)
            yield* auth.clearCodeVerifier(mcpName).pipe(Effect.ignore)
            s.pendingOAuthTransports.delete(mcpName)
            s.interactiveAuths.delete(mcpName)
          }),
        ),
      )

      const launch = {
        name: mcpName,
        authorizationUrl: result.authorizationUrl,
        redirectUri: result.redirectUri,
        oauthState: result.oauthState,
        fiber: yield* complete.pipe(Effect.forkIn(s.scope)),
      } satisfies InteractiveAuthFlow
      s.interactiveAuths.set(mcpName, launch)
      return { flow: launch } as const
    })

    const hasPartialStoredAuth = Effect.fnUntraced(function* (
      mcpName: string,
      mcpConfig: ConfigMCP.Info & { type: "remote" },
    ) {
      const entry = yield* auth.getForUrl(mcpName, mcpConfig.url)
      if (!entry?.clientInfo) return false
      if (entry.tokens?.accessToken) return false
      if (entry.clientInfo.clientSecretExpiresAt && entry.clientInfo.clientSecretExpiresAt < Date.now() / 1000) {
        return false
      }
      return true
    })

    const authenticate = Effect.fn("MCP.authenticate")(function* (mcpName: string) {
      const result = yield* beginInteractiveAuth(mcpName)
      if ("status" in result && result.status) return result.status

      log.info("opening browser for oauth", {
        mcpName,
        url: result.flow.authorizationUrl,
        state: result.flow.oauthState,
      })

      yield* Effect.tryPromise(() => open(result.flow.authorizationUrl)).pipe(
        Effect.flatMap((subprocess) =>
          Effect.callback<void, Error>((resume) => {
            const timer = setTimeout(() => resume(Effect.void), 500)
            subprocess.on("error", (err) => {
              clearTimeout(timer)
              resume(Effect.fail(err))
            })
            subprocess.on("exit", (code) => {
              if (code !== null && code !== 0) {
                clearTimeout(timer)
                resume(Effect.fail(new Error(`Browser open failed with exit code ${code}`)))
              }
            })
          }),
        ),
        Effect.catch(() => {
          log.warn("failed to open browser, user must open URL manually", { mcpName })
          return bus.publish(BrowserOpenFailed, { mcpName, url: result.flow.authorizationUrl }).pipe(Effect.ignore)
        }),
      )

      return yield* Fiber.join(result.flow.fiber).pipe(
        Effect.orElseSucceed(() => ({ status: "failed", error: "OAuth flow interrupted" }) as Status),
      )
    })

    const autoConnectOAuth = Effect.fn("MCP.autoConnectOAuth")(function* () {
      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const launches = yield* Effect.forEach(
        Object.entries(config),
        ([name, mcp]) =>
          Effect.gen(function* () {
            if (!isMcpConfigured(mcp)) return undefined
            if (mcp.type !== "remote") return undefined
            if (mcp.enabled === false || mcp.oauth === false) return undefined
            if (!(yield* hasPartialStoredAuth(name, mcp))) return undefined

            const result = yield* beginInteractiveAuth(name)
            if ("status" in result) return undefined
            return {
              name,
              authorizationUrl: result.flow.authorizationUrl,
              redirectUri: result.flow.redirectUri,
            } satisfies InteractiveAuthLaunch
          }),
        { concurrency: "unbounded" },
      )
      return launches.filter((entry): entry is InteractiveAuthLaunch => !!entry)
    })

    const finishAuth = Effect.fn("MCP.finishAuth")(function* (mcpName: string, authorizationCode: string) {
      const s = yield* InstanceState.get(state)
      const transport = s.pendingOAuthTransports.get(mcpName)
      if (!transport) throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)

      const result = yield* Effect.tryPromise({
        try: () => transport.finishAuth(authorizationCode).then(() => true as const),
        catch: (error) => {
          log.error("failed to finish oauth", { mcpName, error })
          return error
        },
      }).pipe(Effect.option)

      if (Option.isNone(result)) {
        return { status: "failed", error: "OAuth completion failed" } as Status
      }

      yield* auth.clearCodeVerifier(mcpName)
      s.pendingOAuthTransports.delete(mcpName)

      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) return { status: "failed", error: "MCP config not found after auth" } as Status

      return yield* createAndStore(mcpName, mcpConfig)
    })

    const removeAuth = Effect.fn("MCP.removeAuth")(function* (mcpName: string) {
      const s = yield* InstanceState.get(state)
      const flow = s.interactiveAuths.get(mcpName)
      if (flow) {
        yield* Fiber.interrupt(flow.fiber).pipe(Effect.ignore)
      }
      yield* auth.remove(mcpName)
      McpOAuthCallback.cancelPending(yield* oauthCallbackKey(mcpName))
      s.pendingOAuthTransports.delete(mcpName)
      s.interactiveAuths.delete(mcpName)
      log.info("removed oauth credentials", { mcpName })
    })

    const supportsOAuth = Effect.fn("MCP.supportsOAuth")(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) return false
      return mcpConfig.type === "remote" && mcpConfig.oauth !== false
    })

    const hasStoredTokens = Effect.fn("MCP.hasStoredTokens")(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName)
      return !!entry?.tokens
    })

    const getAuthStatus = Effect.fn("MCP.getAuthStatus")(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName)
      if (!entry?.tokens) return "not_authenticated" as AuthStatus
      const expired = yield* auth.isTokenExpired(mcpName)
      return (expired ? "expired" : "authenticated") as AuthStatus
    })

    return Service.of({
      status,
      clients,
      tools,
      prompts,
      resources,
      add,
      connect,
      disconnect,
      getPrompt,
      readResource,
      startAuth,
      authenticate,
      autoConnectOAuth,
      finishAuth,
      removeAuth,
      supportsOAuth,
      hasStoredTokens,
      getAuthStatus,
    })
  }),
)

export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

// --- Per-service runtime ---

export const defaultLayer = layer.pipe(
  Layer.provide(McpAuth.layer),
  Layer.provide(Bus.layer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as MCP from "."
