import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Project } from "../../src/project"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { ProjectTool } from "../../src/tool/project"
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

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Project.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const init = Effect.fn("ProjectToolTest.init")(function* () {
  const info = yield* ProjectTool
  return yield* info.init()
})

const run = Effect.fn("ProjectToolTest.run")(function* (
  args: Tool.InferParameters<typeof ProjectTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

describe("tool.project", () => {
  it.live("detects package scripts as project commands", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, "package.json"),
            JSON.stringify({
              scripts: {
                typecheck: "tsc --noEmit",
                test: "bun test",
              },
            }),
          ),
        )
        yield* Effect.promise(() => Bun.write(path.join(dir, "bun.lock"), ""))

        const result = yield* run({ operation: "detect" })
        expect(result.output).toContain("typecheck")
        expect(result.output).toContain("bun run typecheck")
        expect(result.output).toContain("test")
      }),
    ),
  )

  it.live("configures editable project commands and includes them in context", () =>
    provideTmpdirInstance(
      (_dir) =>
        Effect.gen(function* () {
          yield* run({
            operation: "config_set",
            name: "typecheck",
            command: "bun typecheck",
            cwd: "packages/codeplane",
            label: "Typecheck Codeplane",
            description: "Run Codeplane package type checking",
            labels: ["quality", "codeplane"],
            context: true,
          })

          const project = Instance.project
          const saved = Project.get(project.id)
          expect(Project.commandText(saved?.commands?.typecheck)).toBe("bun typecheck")

          const result = yield* run({ operation: "context" })
          expect(result.output).toContain("Typecheck Codeplane")
          expect(result.output).toContain("packages/codeplane")
          expect(result.output).toContain("quality, codeplane")
        }),
      { git: true },
    ),
  )

  it.live("runs configured project commands from their configured cwd", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "ok.txt"), "hello"))
        yield* run({
          operation: "config_set",
          name: "read-ok",
          command: "cat ok.txt",
          cwd: ".",
          context: false,
        })

        const result = yield* run({ operation: "run", name: "read-ok" })
        expect(result.output).toBe("hello")
        expect(result.metadata.cwd).toBe(dir)
      }),
    ),
  )
})
