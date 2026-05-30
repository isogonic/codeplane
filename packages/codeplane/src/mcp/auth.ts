import path from "path"
import z from "zod"
import { Global } from "../global"
import { Effect, Layer, Context, Semaphore } from "effect"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"

// Single global mcp-auth.json ⇒ one process-wide lock serializes its writes,
// so concurrent OAuth connections (multiple MCP servers authing in parallel)
// don't read-modify-write over each other and lose tokens/registrations.
const writeLock = Semaphore.makeUnsafe(1)

export const Tokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
})
export type Tokens = z.infer<typeof Tokens>

export const ClientInfo = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  clientIdIssuedAt: z.number().optional(),
  clientSecretExpiresAt: z.number().optional(),
})
export type ClientInfo = z.infer<typeof ClientInfo>

export const Entry = z.object({
  tokens: Tokens.optional(),
  clientInfo: ClientInfo.optional(),
  codeVerifier: z.string().optional(),
  oauthState: z.string().optional(),
  serverUrl: z.string().optional(),
})
export type Entry = z.infer<typeof Entry>

function filepath() {
  return path.join(Global.Path.data, "mcp-auth.json")
}

export interface Interface {
  readonly all: () => Effect.Effect<Record<string, Entry>>
  readonly get: (mcpName: string) => Effect.Effect<Entry | undefined>
  readonly getForUrl: (mcpName: string, serverUrl: string) => Effect.Effect<Entry | undefined>
  readonly set: (mcpName: string, entry: Entry, serverUrl?: string) => Effect.Effect<void>
  readonly remove: (mcpName: string) => Effect.Effect<void>
  readonly updateTokens: (mcpName: string, tokens: Tokens, serverUrl?: string) => Effect.Effect<void>
  readonly updateClientInfo: (mcpName: string, clientInfo: ClientInfo, serverUrl?: string) => Effect.Effect<void>
  readonly updateCodeVerifier: (mcpName: string, codeVerifier: string) => Effect.Effect<void>
  readonly clearCodeVerifier: (mcpName: string) => Effect.Effect<void>
  readonly updateOAuthState: (mcpName: string, oauthState: string) => Effect.Effect<void>
  readonly getOAuthState: (mcpName: string) => Effect.Effect<string | undefined>
  readonly clearOAuthState: (mcpName: string) => Effect.Effect<void>
  readonly isTokenExpired: (mcpName: string) => Effect.Effect<boolean | null>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/McpAuth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const all = Effect.fn("McpAuth.all")(function* () {
      return yield* fs.readJson(filepath()).pipe(
        Effect.map((data) => data as Record<string, Entry>),
        Effect.catch(() => Effect.succeed({} as Record<string, Entry>)),
      )
    })

    const get = Effect.fn("McpAuth.get")(function* (mcpName: string) {
      const data = yield* all()
      return data[mcpName]
    })

    const getForUrl = Effect.fn("McpAuth.getForUrl")(function* (mcpName: string, serverUrl: string) {
      const entry = yield* get(mcpName)
      if (!entry) return undefined
      if (!entry.serverUrl) return undefined
      if (entry.serverUrl !== serverUrl) return undefined
      return entry
    })

    // Serialize the whole read-modify-write under one lock so concurrent
    // mutators (set/remove/updateField/clearField) can't clobber each other.
    const mutate = (fn: (data: Record<string, Entry>) => void) =>
      writeLock.withPermits(1)(
        Effect.gen(function* () {
          const data = yield* all()
          fn(data)
          yield* fs.writeJson(filepath(), data, 0o600).pipe(Effect.orDie)
        }),
      )

    const set = Effect.fn("McpAuth.set")(function* (mcpName: string, entry: Entry, serverUrl?: string) {
      if (serverUrl) entry.serverUrl = serverUrl
      yield* mutate((data) => {
        data[mcpName] = entry
      })
    })

    const remove = Effect.fn("McpAuth.remove")(function* (mcpName: string) {
      yield* mutate((data) => {
        delete data[mcpName]
      })
    })

    const updateField = <K extends keyof Entry>(field: K, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string, value: NonNullable<Entry[K]>, serverUrl?: string) {
        yield* mutate((data) => {
          const entry = data[mcpName] ?? {}
          entry[field] = value
          if (serverUrl) entry.serverUrl = serverUrl
          data[mcpName] = entry
        })
      })

    const clearField = <K extends keyof Entry>(field: K, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string) {
        yield* mutate((data) => {
          const entry = data[mcpName]
          if (entry) delete entry[field]
        })
      })

    const updateTokens = updateField("tokens", "updateTokens")
    const updateClientInfo = updateField("clientInfo", "updateClientInfo")
    const updateCodeVerifier = updateField("codeVerifier", "updateCodeVerifier")
    const updateOAuthState = updateField("oauthState", "updateOAuthState")
    const clearCodeVerifier = clearField("codeVerifier", "clearCodeVerifier")
    const clearOAuthState = clearField("oauthState", "clearOAuthState")

    const getOAuthState = Effect.fn("McpAuth.getOAuthState")(function* (mcpName: string) {
      const entry = yield* get(mcpName)
      return entry?.oauthState
    })

    const isTokenExpired = Effect.fn("McpAuth.isTokenExpired")(function* (mcpName: string) {
      const entry = yield* get(mcpName)
      if (!entry?.tokens) return null
      if (!entry.tokens.expiresAt) return false
      return entry.tokens.expiresAt < Date.now() / 1000
    })

    return Service.of({
      all,
      get,
      getForUrl,
      set,
      remove,
      updateTokens,
      updateClientInfo,
      updateCodeVerifier,
      clearCodeVerifier,
      updateOAuthState,
      getOAuthState,
      clearOAuthState,
      isTokenExpired,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as McpAuth from "./auth"
