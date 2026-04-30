import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Git } from "../../src/git"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { ForgeTool } from "../../src/tool/forge"
import { Tool, Truncate } from "../../src/tool"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
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

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const asks = () => {
  const items: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  return {
    items,
    next: {
      ...ctx,
      ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
        Effect.sync(() => {
          items.push(req)
        }),
    },
  }
}

const state = (client: HttpClient.HttpClient, initial: Config.Info, auth: Record<string, Auth.Info>) => {
  let config = initial
  return {
    layer: Layer.mergeAll(
      Agent.defaultLayer,
      AppFileSystem.defaultLayer,
      CrossSpawnSpawner.defaultLayer,
      Git.defaultLayer,
      Truncate.defaultLayer,
      Layer.succeed(HttpClient.HttpClient, client),
      Layer.succeed(
        Config.Service,
        Config.Service.of({
          get: () => Effect.succeed(config),
          getGlobal: () => Effect.succeed(config),
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
    ),
  }
}

function setup(client: HttpClient.HttpClient, initial: Config.Info, auth: Record<string, Auth.Info>) {
  const s = state(client, initial, auth)
  const it = testEffect(s.layer)
  const init = Effect.fn("ForgeToolTest.init")(function* () {
    const info = yield* ForgeTool
    return yield* info.init()
  })
  const run = Effect.fn("ForgeToolTest.run")(function* (
    args: Tool.InferParameters<typeof ForgeTool>,
    next: Tool.Context = ctx,
  ) {
    const tool = yield* init()
    return yield* tool.execute(args, next)
  })
  return { it, run }
}

describe("tool.forge", () => {
  const githubConfig = Config.Info.zod.parse({
    git: {
      github: {
        url: "https://github.com",
        provider: "github",
        hosts: ["github.com"],
        credential: { type: "stored", key: "git:github" },
      },
    },
  })

  const gitlabConfig = Config.Info.zod.parse({
    git: {
      company: {
        url: "https://gitlab.company.test",
        provider: "gitlab",
        hosts: ["gitlab.company.test"],
        credential: { type: "stored", key: "git:company" },
      },
    },
  })

  const auth = (key: string, token: string) => ({
    [key]: new Auth.Api({ type: "api", key: token, metadata: { kind: "git" } }),
  })

  const seen: HttpClientRequest.HttpClientRequest[] = []

  const github = setup(
    HttpClient.make((req) =>
      Effect.sync(() => {
        seen.push(req)
        return json(req, [{ number: 1, title: "Add feature" }])
      }),
    ),
    githubConfig,
    auth("git:github", "gh-token"),
  )

  github.it.live("lists GitHub pull requests with configured auth and redacted permission metadata", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Git.Service.use((git) =>
            git.run(["remote", "add", "origin", "https://github.com/acme/project.git"], { cwd: dir }),
          )
          const { items, next } = asks()

          const result = yield* github.run({ operation: "pull_request_list", cwd: dir, state: "open" }, next)
          expect(result.output).toContain("Add feature")
          expect(seen.at(-1)?.method).toBe("GET")
          expect(seen.at(-1)?.url).toBe("https://api.github.com/repos/acme/project/pulls?per_page=30&state=open")
          expect(seen.at(-1)?.headers.authorization).toBe("Bearer gh-token")
          expect(items.find((item) => item.permission === "forge")?.metadata.headers).toEqual({
            Accept: "application/json",
            "User-Agent": "codeplane",
            Authorization: "<redacted>",
          })
        }),
      { git: true },
    ),
  )

  const gitlab = setup(
    HttpClient.make((req) =>
      Effect.sync(() => {
        seen.push(req)
        return json(req, { iid: 7, title: "Add feature" })
      }),
    ),
    gitlabConfig,
    auth("git:company", "gl-token"),
  )

  gitlab.it.live("creates GitLab merge requests against self-hosted instances", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Git.Service.use((git) =>
            git.run(["remote", "add", "origin", "git@gitlab.company.test:group/project.git"], { cwd: dir }),
          )

          const result = yield* gitlab.run({
            operation: "pull_request_create",
            cwd: dir,
            title: "Add feature",
            body: "details",
            head: "feature",
            base: "dev",
          })
          expect(result.output).toContain('"iid": 7')
          expect(seen.at(-1)?.method).toBe("POST")
          expect(seen.at(-1)?.url).toBe("https://gitlab.company.test/api/v4/projects/group%2Fproject/merge_requests")
          expect(seen.at(-1)?.headers["private-token"]).toBe("gl-token")
        }),
      { git: true },
    ),
  )
})
