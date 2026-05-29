import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Git } from "../../src/git"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool, Truncate } from "../../src/tool"
import { ToolsTool } from "../../src/tool/tools"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const availability = {
  known: ["forge", "git", "tools"],
  available: ["git", "tools"],
  blocked: [
    {
      id: "forge",
      reason: "No Git host config exists.",
      setup: 'Use the git tool with operation="config_set" and operation="credential_set".',
    },
  ],
}

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const state = (client: HttpClient.HttpClient, initial: Config.Info, auth: Record<string, Auth.Info>) => {
  let config = initial
  return Layer.mergeAll(
    Agent.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Git.defaultLayer,
    Truncate.defaultLayer,
    Layer.succeed(HttpClient.HttpClient, client),
    Layer.succeed(
      Config.Service,
      Config.Service.of({
        get: () => Effect.succeed(config),
        getRaw: () => Effect.succeed(config),
        getGlobal: () => Effect.succeed(config),
        getGlobalRaw: () => Effect.succeed(config),
        getConsoleState: () =>
          Effect.succeed({ consoleManagedProviders: [], activeOrgName: undefined, switchableOrgCount: 0 }),
        update: (next) =>
          Effect.sync(() => {
            config = { ...config, ...next }
          }),
        updateGlobal: (next) =>
          Effect.sync(() => {
            config = { ...config, ...next, git: { ...(config.git ?? {}), ...(next.git ?? {}) } }
            return config
          }),
        invalidate: () => Effect.void,
        directories: () => Effect.succeed([]),
        waitForDependencies: () => Effect.void,
      }),
    ),
    Layer.succeed(
      Auth.Service,
      Auth.Service.of({
        get: (key) => Effect.succeed(auth[key]),
        all: () => Effect.succeed(auth),
        set: (key, info) =>
          Effect.sync(() => {
            auth[key] = info
          }),
        remove: (key) =>
          Effect.sync(() => {
            delete auth[key]
          }),
      }),
    ),
  )
}

function setup(
  client: HttpClient.HttpClient,
  initial = Config.Info.zod.parse({}),
  auth: Record<string, Auth.Info> = {},
) {
  const it = testEffect(state(client, initial, auth))
  const init = Effect.fn("ToolsToolTest.init")(function* () {
    const info = yield* ToolsTool
    return yield* info.init()
  })
  const run = Effect.fn("ToolsToolTest.run")(function* (
    args: Tool.InferParameters<typeof ToolsTool>,
    next: Tool.Context = ctx,
  ) {
    const tool = yield* init()
    return yield* tool.execute(args, next)
  })
  return { it, run }
}

describe("tool.tools", () => {
  const base = setup(HttpClient.make((req) => Effect.succeed(json(req, {}))))

  base.it.live("reports live callable and blocked native tools", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const result = yield* base.run({ operation: "status" }, { ...ctx, extra: { toolAvailability: availability } })
        expect(result.output).toContain("forge: blocked - No Git host config exists.")
        expect(result.output).toContain('operation="config_set"')
        expect(result.output).toContain("git: ok - callable right now")
        expect(result.output).toContain("## Local requirements")
        expect(result.output).toContain("Forge auth checks: skipped")
      }),
    ),
  )

  const seen: HttpClientRequest.HttpClientRequest[] = []
  const github = setup(
    HttpClient.make((req) =>
      Effect.sync(() => {
        seen.push(req)
        return json(req, { login: "octocat" })
      }),
    ),
    Config.Info.zod.parse({
      git: {
        github: {
          url: "https://github.com",
          provider: "github",
          hosts: ["github.com"],
          credential: { type: "stored", key: "git:github" },
        },
      },
    }),
    {
      "git:github": new Auth.Api({ type: "api", key: "gh-token", metadata: { kind: "git" } }),
    },
  )

  github.it.live("checks configured forge API credentials", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const result = yield* github.run({ operation: "check" }, { ...ctx, extra: { toolAvailability: availability } })
        expect(result.output).toContain("github: ok - stored API credential git:github exists")
        expect(result.output).toContain("forge auth github: ok - https://api.github.com/user returned 200.")
        expect(seen.at(-1)?.headers.authorization).toBe("Bearer gh-token")
      }),
    ),
  )
})
