import { afterEach, describe, expect } from "bun:test"
import { chmod, mkdir } from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Project } from "../../src/project"
import { Instance } from "../../src/project/instance"
import { Shell } from "../../src/shell/shell"
import { MessageID, SessionID } from "../../src/session/schema"
import { ProjectTool } from "../../src/tool/project"
import { Tool, Truncate } from "../../src/tool"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
  Shell.resetEnvironment()
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

const withEnv = <A, E, R>(env: NodeJS.ProcessEnv, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]])) as NodeJS.ProcessEnv
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      Shell.acceptable.reset()
      Shell.preferred.reset()
      Shell.resetEnvironment()
      return prev
    }),
    () => effect,
    (prev) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(prev)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
        Shell.acceptable.reset()
        Shell.preferred.reset()
        Shell.resetEnvironment()
      }),
  )

const loginShellFixture = async (dir: string) => {
  const bin = path.join(dir, "login-bin")
  const shell = path.join(dir, "zsh")
  await mkdir(bin, { recursive: true })
  await Bun.write(path.join(bin, "login-only-tool"), "#!/bin/sh\nprintf 'project-login-path-ok\\n'\n")
  await chmod(path.join(bin, "login-only-tool"), 0o755)
  await Bun.write(
    shell,
    [
      "#!/bin/sh",
      "login=0",
      "if [ \"$1\" = \"-l\" ]; then",
      "  login=1",
      "  shift",
      "fi",
      "if [ \"$1\" = \"-c\" ]; then",
      "  shift",
      "  if [ \"$login\" = \"1\" ]; then",
      `    PATH=${JSON.stringify(bin)}:$PATH`,
      "    export PATH",
      "  fi",
      "  exec /bin/sh -c \"$1\"",
      "fi",
      "exec /bin/sh \"$@\"",
      "",
    ].join("\n"),
  )
  await chmod(shell, 0o755)
  return { shell, bin }
}

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
      () =>
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

  if (process.platform !== "win32") {
    it.live("checks and runs commands using login shell PATH from a sanitized app environment", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const fixture = yield* Effect.promise(() => loginShellFixture(dir))

          yield* withEnv(
            { SHELL: fixture.shell, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
            Effect.gen(function* () {
              yield* run({
                operation: "config_set",
                name: "login-path",
                command: "login-only-tool",
                cwd: ".",
                context: false,
              })

              const check = yield* run({ operation: "check", name: "login-path" })
              expect(check.output).toContain("- login-path: callable")

              const result = yield* run({ operation: "run", name: "login-path" })
              expect(result.output).toBe("project-login-path-ok")
            }),
          )
        }),
      ),
    )
  }
})
