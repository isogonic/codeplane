import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Command } from "../../src/command"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { MCP } from "../../src/mcp"
import { Skill } from "../../src/skill"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    Command.layer.pipe(
      Layer.provide(Layer.mock(Config.Service)({ get: () => Effect.succeed(Config.Info.zod.parse({})) })),
      Layer.provide(
        Layer.succeed(
          MCP.Service,
          MCP.Service.of({
            status: () => Effect.succeed({}),
            clients: () => Effect.succeed({}),
            tools: () => Effect.succeed({}),
            prompts: () => Effect.succeed({}),
            resources: () => Effect.succeed({}),
            add: () => Effect.succeed({ status: {} }),
            connect: () => Effect.void,
            disconnect: () => Effect.void,
            getPrompt: () => Effect.succeed(undefined),
            readResource: () => Effect.succeed(undefined),
            startAuth: () => Effect.die("unexpected auth"),
            authenticate: () => Effect.die("unexpected auth"),
            finishAuth: () => Effect.die("unexpected auth"),
            removeAuth: () => Effect.void,
            supportsOAuth: () => Effect.succeed(false),
            hasStoredTokens: () => Effect.succeed(false),
            getAuthStatus: () => Effect.succeed("not_authenticated" as const),
          }),
        ),
      ),
      Layer.provide(
        Layer.succeed(
          Skill.Service,
          Skill.Service.of({
            get: () => Effect.succeed(undefined),
            all: () => Effect.succeed([]),
            dirs: () => Effect.succeed([]),
            available: () => Effect.succeed([]),
          }),
        ),
      ),
    ),
  ),
)

describe("Command", () => {
  it.live("includes the built-in git, forge, project, tools, doctor, audit, and project-runner commands", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const command = yield* Command.Service
        const auditTetris = yield* command.get("audit-tetris")
        const git = yield* command.get("git")
        const forge = yield* command.get("forge")
        const project = yield* command.get("project")
        const tools = yield* command.get("tools")
        const doctor = yield* command.get("doctor")
        const typecheck = yield* command.get("typecheck")
        const test = yield* command.get("test")
        const build = yield* command.get("build")
        const dev = yield* command.get("dev")
        expect(auditTetris?.description).toContain("Tetris")
        expect(yield* Effect.promise(async () => auditTetris?.template)).toContain("full-stack Tetris agent audit")
        expect(git?.description).toContain("Git")
        expect(yield* Effect.promise(async () => git?.template)).toContain("native git tool")
        expect(forge?.description).toContain("forge")
        expect(yield* Effect.promise(async () => forge?.template)).toContain("native forge tool")
        expect(project?.description).toContain("project command")
        expect(yield* Effect.promise(async () => project?.template)).toContain("native project tool")
        expect(tools?.description).toContain("tool availability")
        expect(yield* Effect.promise(async () => tools?.template)).toContain("native tools tool")
        expect(doctor?.description).toContain("diagnose")
        expect(yield* Effect.promise(async () => doctor?.template)).toContain('operation="doctor"')
        expect(yield* Effect.promise(async () => typecheck?.template)).toContain('name="typecheck"')
        expect(yield* Effect.promise(async () => test?.template)).toContain('name="test"')
        expect(yield* Effect.promise(async () => build?.template)).toContain('name="build"')
        expect(yield* Effect.promise(async () => dev?.template)).toContain('name="dev"')
      }),
    ),
  )
})
