import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Git } from "../../src/git"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { MessageID, SessionID } from "../../src/session/schema"
import { GitTool } from "../../src/tool/git"
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

const state = () => {
  let config = Config.Info.zod.parse({})
  const auth: Record<string, Auth.Info> = {}
  return {
    config: () => config,
    auth: () => auth,
    layer: Layer.mergeAll(
      Agent.defaultLayer,
      AppFileSystem.defaultLayer,
      CrossSpawnSpawner.defaultLayer,
      Git.defaultLayer,
      Truncate.defaultLayer,
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
              config = { ...config, ...next, git: { ...config.git, ...next.git } }
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
      Layer.succeed(
        Question.Service,
        Question.Service.of({
          ask: () => Effect.succeed([]),
          reply: () => Effect.void,
          reject: () => Effect.void,
          list: () => Effect.succeed([]),
        }),
      ),
    ),
  }
}

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

function setup() {
  const s = state()
  const it = testEffect(s.layer)
  const init = Effect.fn("GitToolTest.init")(function* () {
    const info = yield* GitTool
    return yield* info.init()
  })
  const run = Effect.fn("GitToolTest.run")(function* (
    args: Tool.InferParameters<typeof GitTool>,
    next: Tool.Context = ctx,
  ) {
    const tool = yield* init()
    return yield* tool.execute(args, next)
  })
  return { it, run, state: s }
}

describe("tool.git", () => {
  const git = setup()

  git.it.live("runs git status through the git permission", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => Bun.write(path.join(dir, "new.txt"), "hello\n"))
          const { items, next } = asks()

          const result = yield* git.run({ operation: "status", cwd: dir }, next)
          expect(result.output).toContain("new.txt")
          expect(items.find((item) => item.permission === "git")?.patterns).toEqual(["status"])
        }),
      { git: true },
    ),
  )

  git.it.live("supports raw git run arguments", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const result = yield* git.run({ operation: "run", cwd: dir, args: ["rev-parse", "--show-toplevel"] })
          expect(result.output).toBe(dir)
          expect(result.metadata.command).toEqual(["git", "rev-parse", "--show-toplevel"])
        }),
      { git: true },
    ),
  )

  git.it.live("stores host config and redacted credential metadata", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* git.run({
          operation: "credential_set",
          cwd: dir,
          name: "company",
          url: "https://gitlab.company.test",
          provider: "gitlab",
          token: "secret-token",
        })

        const entry = git.state.auth()["git:company"]
        expect(entry?.type).toBe("api")
        if (entry?.type === "api") expect(entry.key).toBe("secret-token")
        expect(git.state.config().git?.company.credential?.key).toBe("git:company")
        expect(git.state.config().git?.company.hosts).toEqual(["gitlab.company.test"])

        const list = yield* git.run({ operation: "credential_list", cwd: dir })
        expect(list.output).toContain("git:company")
        expect(list.output).not.toContain("secret-token")
      }),
    ),
  )

  git.it.live("stores ssh command credentials without writing an auth secret", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* git.run({
          operation: "credential_set",
          cwd: dir,
          name: "ssh-company",
          url: "ssh://git@git.company.test",
          provider: "generic",
          sshCommand: "ssh -i ~/.ssh/id_ed25519_company",
        })

        expect(git.state.auth()["git:ssh-company"]).toBeUndefined()
        expect(git.state.config().git?.["ssh-company"].credential).toEqual({
          type: "ssh",
          sshCommand: "ssh -i ~/.ssh/id_ed25519_company",
          username: undefined,
        })
      }),
    ),
  )
})
