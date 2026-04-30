import path from "path"
import { existsSync } from "fs"
import { Effect, Fiber, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { InstanceState } from "@/effect"
import { Project } from "@/project"
import type { InstanceContext } from "@/project/instance"
import { Shell } from "@/shell/shell"
import { which } from "@/util/which"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./project.txt"
import * as Tool from "./tool"

const operations = ["info", "detect", "commands", "check", "run", "config_set", "config_remove", "context"] as const
const commonKinds = ["start", "dev", "test", "typecheck", "lint", "build", "format", "install", "custom"] as const
const packageManagers = ["bun", "pnpm", "yarn", "npm"] as const

export const CommandConfig = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command to run" }),
  label: Schema.optional(Schema.String).annotate({ description: "Human-readable label shown in the app" }),
  description: Schema.optional(Schema.String).annotate({ description: "What this command is for" }),
  cwd: Schema.optional(Schema.String).annotate({
    description: "Working directory relative to the project worktree or absolute path. Defaults to project root.",
  }),
  env: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Environment variables required for this command to run",
  }),
  labels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Labels/tags for grouping and UI display",
  }),
  kind: Schema.optional(Schema.Literals(commonKinds)).annotate({ description: "Semantic command kind" }),
  context: Schema.optional(Schema.Boolean).annotate({
    description: "Whether this command is included in agent context. Defaults to true.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Run timeout in milliseconds" }),
  interactive: Schema.optional(Schema.Boolean).annotate({
    description: "Whether this command is expected to stay interactive or long-running",
  }),
})

export const Parameters = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "Project command operation to perform" }),
  name: Schema.optional(Schema.String).annotate({
    description: "Project command name, for example start, dev, test, typecheck, lint, build, or custom name.",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "Shell command for config_set." }),
  label: Schema.optional(Schema.String).annotate({ description: "Human-readable label for config_set." }),
  description: Schema.optional(Schema.String).annotate({ description: "What the command is for." }),
  cwd: Schema.optional(Schema.String).annotate({
    description: "Working directory for the command, relative to project root or absolute.",
  }),
  env: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Required environment variables for config_set or run validation.",
  }),
  labels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Labels/tags for config_set.",
  }),
  kind: Schema.optional(Schema.Literals(commonKinds)).annotate({
    description: "Semantic command kind for config_set.",
  }),
  context: Schema.optional(Schema.Boolean).annotate({ description: "Whether to put the command into agent context." }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Run timeout in milliseconds." }),
  interactive: Schema.optional(Schema.Boolean).annotate({ description: "Whether the command is long-running." }),
  args: Schema.optional(Schema.String).annotate({
    description: "Optional shell arguments appended when operation=run.",
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>
type PackageManager = (typeof packageManagers)[number]
type CommandStatus = "callable" | "blocked" | "warning"
type CommandEntry = Project.CommandInfo & {
  source: "configured" | "detected"
  package?: string
  packageManager?: PackageManager
  script?: string
  status?: CommandStatus
  reason?: string
  fix?: string
}

const semanticScripts = {
  start: ["start"],
  dev: ["dev", "serve"],
  test: ["test"],
  typecheck: ["typecheck", "check-types", "tsc"],
  lint: ["lint"],
  build: ["build"],
  format: ["format", "fmt"],
  install: ["install"],
} satisfies Record<string, string[]>

function unique<T>(items: T[]) {
  return items.filter((item, index) => items.indexOf(item) === index)
}

function packageManager(dir: string, root: string): PackageManager {
  const has = (base: string, file: string) => existsSync(path.join(base, file))
  if (has(dir, "bun.lock") || has(dir, "bun.lockb") || has(root, "bun.lock") || has(root, "bun.lockb")) return "bun"
  if (has(dir, "pnpm-lock.yaml") || has(root, "pnpm-lock.yaml")) return "pnpm"
  if (has(dir, "yarn.lock") || has(root, "yarn.lock")) return "yarn"
  return "npm"
}

function runScriptCommand(pm: PackageManager, script: string) {
  if (pm === "bun") return `bun run ${script}`
  if (pm === "pnpm") return `pnpm run ${script}`
  if (pm === "yarn") return `yarn ${script}`
  return `npm run ${script}`
}

function commandBinary(command: string) {
  return command.match(/^\s*(?:env\s+)?([A-Za-z0-9_.:/\\-]+)/)?.[1]
}

function resolveCwd(root: string, cwd: string | undefined) {
  return AppFileSystem.resolve(path.isAbsolute(cwd ?? root) ? (cwd ?? root) : path.join(root, cwd ?? "."))
}

function projectRoot(ctx: InstanceContext) {
  return ctx.project.worktree === "/" ? ctx.directory : ctx.worktree
}

function appendArgs(command: string, args: string | undefined) {
  const extra = args?.trim()
  return extra ? `${command} ${extra}` : command
}

function formatEntry(item: CommandEntry) {
  return [
    `- ${item.name}: ${item.status ?? "callable"} [${item.source}]`,
    `  command: ${item.command}`,
    `  cwd: ${item.cwd ?? "."}`,
    item.label ? `  label: ${item.label}` : undefined,
    item.description ? `  description: ${item.description}` : undefined,
    item.kind ? `  kind: ${item.kind}` : undefined,
    item.labels?.length ? `  labels: ${item.labels.join(", ")}` : undefined,
    item.env?.length ? `  env: ${item.env.join(", ")}` : undefined,
    item.reason ? `  reason: ${item.reason}` : undefined,
    item.fix ? `  fix: ${item.fix}` : undefined,
  ]
    .filter(Boolean)
    .join("\n")
}

function formatCommands(items: CommandEntry[]) {
  if (items.length === 0) return "- none"
  return items.map(formatEntry).join("\n")
}

function configuredCommands(project: Project.Info): CommandEntry[] {
  return Object.entries(project.commands ?? {}).map(([name, command]) => ({
    ...Project.commandInfo(name, command),
    source: "configured" as const,
  }))
}

function commandFromParams(params: Params): Project.ProjectCommand {
  if (!params.command) throw new Error('command is required for operation="config_set"')
  const kind = commonKinds.find((item) => item === params.name)
  return {
    command: params.command,
    label: params.label,
    description: params.description,
    cwd: params.cwd,
    env: params.env,
    labels: params.labels,
    kind: params.kind ?? kind ?? "custom",
    context: params.context,
    timeout: params.timeout,
    interactive: params.interactive,
  }
}

export const ProjectTool = Tool.define<
  typeof Parameters,
  Record<string, unknown>,
  AppFileSystem.Service | ChildProcessSpawner | Project.Service
>(
  "project",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const spawner = yield* ChildProcessSpawner
    const projectSvc = yield* Project.Service

    const currentProject = Effect.fn("ProjectTool.currentProject")(function* () {
      const ctx = yield* InstanceState.context
      return (yield* projectSvc.get(ctx.project.id)) ?? ctx.project
    })

    const detect = Effect.fn("ProjectTool.detect")(function* () {
      const ctx = yield* InstanceState.context
      const root = projectRoot(ctx)
      const files = (yield* fs
        .glob("**/package.json", { cwd: root, absolute: true, include: "file" })
        .pipe(Effect.catch(() => Effect.succeed([] as string[]))))
        .filter(
          (file) =>
            !file.includes(`${path.sep}node_modules${path.sep}`) && !file.includes(`${path.sep}.git${path.sep}`),
        )
        .slice(0, 200)

      const packages = yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (file) {
          const json = yield* fs.readJson(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!json || typeof json !== "object") return
          const data = json as { name?: unknown; scripts?: unknown }
          if (!data.scripts || typeof data.scripts !== "object") return
          const dir = path.dirname(file)
          const rel = path.relative(root, dir) || "."
          const pm = packageManager(dir, root)
          const scripts = Object.entries(data.scripts as Record<string, unknown>).flatMap(([script, value]) => {
            if (typeof value !== "string") return []
            const semantic = Object.entries(semanticScripts).find(([, names]) => names.includes(script))?.[0]
            const packageName = typeof data.name === "string" ? data.name : rel === "." ? "root" : rel
            const name = rel === "." && semantic ? semantic : `${packageName}:${script}`
            return [
              {
                name,
                command: runScriptCommand(pm, script),
                label: semantic ? semantic : script,
                description: `${script} script from ${rel === "." ? "project root" : rel}`,
                cwd: rel,
                env: undefined,
                labels: unique(["package", pm, rel === "." ? "root" : rel]),
                kind: semantic ?? "custom",
                context: semantic ? true : false,
                timeout: undefined,
                interactive: ["start", "dev", "serve"].includes(script),
                source: "detected" as const,
                package: typeof data.name === "string" ? data.name : undefined,
                packageManager: pm,
                script,
              } satisfies CommandEntry,
            ]
          })
          return scripts
        }),
        { concurrency: "unbounded" },
      )

      return packages.flatMap((item) => item ?? []).toSorted((a, b) => a.name.localeCompare(b.name))
    })

    const mergedCommands = Effect.fn("ProjectTool.mergedCommands")(function* () {
      const project = yield* currentProject()
      const configured = configuredCommands(project)
      const seen = new Set(configured.map((item) => item.name))
      const detected = (yield* detect()).filter((item) => !seen.has(item.name))
      return [...configured, ...detected].toSorted((a, b) => a.name.localeCompare(b.name))
    })

    const check = Effect.fn("ProjectTool.check")(function* (items: CommandEntry[]) {
      const ctx = yield* InstanceState.context
      const root = projectRoot(ctx)
      return yield* Effect.forEach(
        items,
        Effect.fnUntraced(function* (item) {
          const cwd = resolveCwd(root, item.cwd)
          const exists = yield* fs.isDir(cwd).pipe(Effect.orElseSucceed(() => false))
          const missingEnv = (item.env ?? []).filter((name: string) => !process.env[name])
          const binary = commandBinary(item.command)
          const missingBinary = binary && !/^\$|\//.test(binary) && !which(binary) ? binary : undefined

          if (!exists) {
            return {
              ...item,
              status: "blocked" as const,
              reason: `cwd does not exist: ${cwd}`,
              fix: "Update the command cwd or create the directory.",
            }
          }
          if (missingEnv.length) {
            return {
              ...item,
              status: "blocked" as const,
              reason: `missing environment variables: ${missingEnv.join(", ")}`,
              fix: `Set ${missingEnv.join(", ")} before running this command.`,
            }
          }
          if (missingBinary) {
            return {
              ...item,
              status: "blocked" as const,
              reason: `${missingBinary} is not available on PATH`,
              fix: `Install ${missingBinary} or update the command.`,
            }
          }
          return {
            ...item,
            status: item.interactive ? ("warning" as const) : ("callable" as const),
            reason: item.interactive ? "command is marked interactive/long-running" : undefined,
            fix: item.interactive
              ? "Use a dev server or interactive terminal flow if this should keep running."
              : undefined,
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const findCommand = Effect.fn("ProjectTool.findCommand")(function* (name: string) {
      const items = yield* mergedCommands()
      const match = items.find((item) => item.name === name || item.kind === name)
      if (match) return match
      const available = items.map((item) => item.name).join(", ")
      throw new Error(`Project command not found: ${name}.${available ? ` Available commands: ${available}` : ""}`)
    })

    const updateCommands = Effect.fn("ProjectTool.updateCommands")(function* (
      next: Record<string, Project.ProjectCommandValue>,
    ) {
      const ctx = yield* InstanceState.context
      return yield* projectSvc.update({
        projectID: ctx.project.id,
        commands: next,
      })
    })

    const runShell = Effect.fn("ProjectTool.runShell")(function* (
      item: CommandEntry,
      params: Params,
      ctx: Tool.Context,
    ) {
      const instance = yield* InstanceState.context
      const cwd = resolveCwd(projectRoot(instance), item.cwd)
      yield* assertExternalDirectoryEffect(ctx, cwd, { kind: "directory" })
      const checked = (yield* check([item]))[0]
      if (checked?.status === "blocked") {
        return yield* Effect.fail(new Error(`${checked.reason}${checked.fix ? ` ${checked.fix}` : ""}`))
      }

      const command = appendArgs(item.command, params.args)
      const timeout = params.timeout ?? item.timeout ?? (item.interactive ? 10_000 : 120_000)
      const shell = Shell.acceptable()
      const run = Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make(command, [], {
              shell,
              cwd,
              extendEnv: true,
              stdin: "ignore",
              detached: process.platform !== "win32",
            }),
          )
          const output = yield* Stream.mkString(Stream.decodeText(handle.all)).pipe(Effect.forkScoped)
          const exit = yield* Effect.raceAll([
            handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
            Effect.sleep(`${timeout} millis`).pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
          ])
          if (exit.kind === "timeout") yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          return { exit, output: yield* Fiber.join(output) }
        }),
      )
      const result = yield* run.pipe(Effect.orDie)
      const metadata =
        result.exit.kind === "timeout" ? `\n\n<project_metadata>Timed out after ${timeout} ms.</project_metadata>` : ""
      if (result.exit.kind === "exit" && result.exit.code !== 0) {
        return yield* Effect.fail(new Error((result.output.trim() || command) + metadata))
      }
      return {
        title: `project ${item.name}`,
        output: (result.output.trim() || `${command} completed`) + metadata,
        metadata: {
          operation: params.operation,
          name: item.name,
          command,
          cwd,
          exitCode: result.exit.kind === "exit" ? result.exit.code : null,
          timedOut: result.exit.kind === "timeout",
        },
      }
    })

    const execute = Effect.fn("ProjectTool.execute")(function* (params: Params, ctx: Tool.Context) {
      yield* ctx.ask({
        permission: "project",
        patterns: [params.operation, params.name ?? "*"],
        always: [params.operation],
        metadata: {
          operation: params.operation,
          name: params.name,
          command: params.command,
          cwd: params.cwd,
        },
      })

      const instance = yield* InstanceState.context
      const project = yield* currentProject()

      switch (params.operation) {
        case "info": {
          return {
            title: "project info",
            output: [
              `<project>${project.id}</project>`,
              `worktree: ${project.worktree}`,
              `directory: ${instance.directory}`,
              `vcs: ${project.vcs ?? "(none)"}`,
              "",
              "Configured commands:",
              formatCommands(configuredCommands(project)),
            ].join("\n"),
            metadata: { operation: params.operation, projectID: project.id },
          }
        }
        case "detect": {
          const detected = yield* detect()
          return {
            title: "project detect",
            output: ["Detected project commands:", formatCommands(detected)].join("\n"),
            metadata: { operation: params.operation, count: detected.length },
          }
        }
        case "commands": {
          const items = yield* check(yield* mergedCommands())
          return {
            title: "project commands",
            output: ["Project commands:", formatCommands(items)].join("\n"),
            metadata: { operation: params.operation, count: items.length },
          }
        }
        case "check": {
          const items = yield* check(params.name ? [yield* findCommand(params.name)] : yield* mergedCommands())
          return {
            title: "project check",
            output: ["Project command checks:", formatCommands(items)].join("\n"),
            metadata: {
              operation: params.operation,
              count: items.length,
              blocked: items.filter((item) => item.status === "blocked").length,
            },
          }
        }
        case "context": {
          const items = (yield* check(yield* mergedCommands())).filter((item) => item.context !== false)
          return {
            title: "project context",
            output: ["Commands currently included in agent context:", formatCommands(items)].join("\n"),
            metadata: { operation: params.operation, count: items.length },
          }
        }
        case "config_set": {
          const name = params.name ?? params.kind
          if (!name) return yield* Effect.fail(new Error('name or kind is required for operation="config_set"'))
          const updated = yield* updateCommands({
            ...(project.commands ?? {}),
            [name]: commandFromParams({ ...params, name }),
          })
          return {
            title: `project command ${name}`,
            output: `Saved project command ${name} for ${updated.worktree}.`,
            metadata: { operation: params.operation, name, projectID: updated.id },
          }
        }
        case "config_remove": {
          if (!params.name) return yield* Effect.fail(new Error('name is required for operation="config_remove"'))
          const { [params.name]: _removed, ...next } = project.commands ?? {}
          const updated = yield* updateCommands(next)
          return {
            title: `project command ${params.name}`,
            output: `Removed project command ${params.name} for ${updated.worktree}.`,
            metadata: { operation: params.operation, name: params.name, projectID: updated.id },
          }
        }
        case "run": {
          if (!params.name) return yield* Effect.fail(new Error('name is required for operation="run"'))
          return yield* runShell(yield* findCommand(params.name), params, ctx)
        }
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) => execute(params, ctx).pipe(Effect.orDie),
    }
  }),
)
