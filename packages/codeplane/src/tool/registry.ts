import { PlanExitTool } from "./plan"
import { Session } from "../session"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { ForgeTool } from "./forge"
import { GitTool } from "./git"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ListTool } from "./list"
import { ProjectTool } from "./project"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import { ToolsTool } from "./tools"
import { WebFetchTool } from "./webfetch"
import { BrowseTool } from "./browse"
import { BrowserTool } from "./browser"
import { ComputerTool } from "./computer"
import { BashInteractiveTool } from "./bash_interactive"
import { SshTool } from "./ssh"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import * as Tool from "./tool"
import { Config } from "../config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@codeplane-ai/plugin"
import { Schema } from "effect"
import z from "zod"
import { ZodOverride } from "@/util/effect-zod"
import { Plugin } from "../plugin"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util"
import { LspTool } from "./lsp"
import * as Truncate from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "@codeplane-ai/shared/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { Ripgrep } from "../file/ripgrep"
import { Format } from "../format"
import { InstanceState } from "@/effect"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "../lsp"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { Bus } from "../bus"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { Git } from "@/git"
import { Auth } from "@/auth"
import { Project } from "@/project"

const log = Log.create({ service: "tool.registry" })

type TaskDef = Tool.InferDef<typeof TaskTool>
type ReadDef = Tool.InferDef<typeof ReadTool>

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
}

type ToolInput = {
  providerID: ProviderID
  modelID: ModelID
  agent: Agent.Info
  sessionPermission?: Permission.Ruleset
}

function isDesktopClient() {
  return Flag.CODEPLANE_CLIENT === "app" || process.env.CODEPLANE_DESKTOP_MANAGED === "1"
}

export type Availability = {
  known?: string[]
  available: string[]
  blocked: Array<{
    id: string
    reason: string
    setup?: string
  }>
}

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  readonly availability: (input: ToolInput) => Effect.Effect<Availability>
  readonly tools: (input: ToolInput) => Effect.Effect<Tool.Def[]>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/ToolRegistry") {}

type Requirements =
  | Config.Service
  | Plugin.Service
  | Question.Service
  | Todo.Service
  | Agent.Service
  | Skill.Service
  | Session.Service
  | Provider.Service
  | LSP.Service
  | Instruction.Service
  | AppFileSystem.Service
  | Auth.Service
  | Bus.Service
  | Git.Service
  | Project.Service
  | HttpClient.HttpClient
  | ChildProcessSpawner
  | Ripgrep.Service
  | Format.Service
  | Truncate.Service

export const layer: Layer.Layer<Service, never, Requirements> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const skill = yield* Skill.Service
    const truncate = yield* Truncate.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const read = yield* ReadTool
    const list = yield* ListTool
    const projecttool = yield* ProjectTool
    const gittool = yield* GitTool
    const forgetool = yield* ForgeTool
    const toolstatus = yield* ToolsTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const lsptool = yield* LspTool
    const plan = yield* PlanExitTool
    const webfetch = yield* WebFetchTool
    const websearch = yield* WebSearchTool
    const browse = yield* BrowseTool
    const browser_tool = yield* BrowserTool
    const computer = yield* (ComputerTool as unknown as Effect.Effect<Tool.Info<any, any>, never, never>)
    const bashInteractive = yield* BashInteractiveTool
    const bash = yield* BashTool
    const ssh = yield* SshTool
    const codesearch = yield* CodeSearchTool
    const globtool = yield* GlobTool
    const writetool = yield* WriteTool
    const edit = yield* EditTool
    const greptool = yield* GrepTool
    const patchtool = yield* ApplyPatchTool
    const skilltool = yield* SkillTool
    const agent = yield* Agent.Service

    const descriptionCache = new Map<string, string>()
    const cache = (key: string, build: () => string) => {
      const cached = descriptionCache.get(key)
      if (cached !== undefined) return cached
      if (descriptionCache.size > 512) descriptionCache.clear()
      const result = build()
      descriptionCache.set(key, result)
      return result
    }
    const permissionKey = (rules: Permission.Ruleset) =>
      rules.map((rule) => [rule.permission, rule.pattern, rule.action].join("\x1d")).join("\x1e")

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const custom: Tool.Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          // Plugin tools define their args as a raw Zod shape. Wrap the
          // derived Zod object in a `Schema.declare` so it slots into the
          // Schema-typed framework, and annotate with `ZodOverride` so the
          // walker emits the original Zod object for LLM JSON Schema.
          const zodParams = z.object(def.args)
          const parameters = Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success).annotate({
            [ZodOverride]: zodParams,
          })
          return {
            id,
            parameters,
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  ask: (req) => toolCtx.ask(req),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const info = yield* agent.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: "",
                  output: out.truncated ? out.content : output,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath }),
                  },
                }
              }),
          }
        }

        const dirs = yield* config.directories()
        const matches = dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
        )
        if (matches.length) yield* config.waitForDependencies()
        custom.push(
          ...(yield* Effect.forEach(
            matches,
            (match) =>
              Effect.gen(function* () {
                const namespace = path.basename(match, path.extname(match))
                try {
                  const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
                  return Object.entries<ToolDefinition>(mod).map(([id, def]) =>
                    fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def),
                  )
                } catch (err) {
                  log.error("failed to load custom tool file, skipping", { match, error: err })
                  return []
                }
              }),
            { concurrency: "unbounded" },
          )).flat(),
        )

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            try {
              custom.push(fromPlugin(id, def))
            } catch (err) {
              log.error("failed to register plugin tool, skipping", { tool: id, error: err })
            }
          }
        }

        yield* config.get()
        const questionEnabled = ["app", "cli"].includes(Flag.CODEPLANE_CLIENT) || Flag.CODEPLANE_ENABLE_QUESTION_TOOL

        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          bash: Tool.init(bash),
          read: Tool.init(read),
          list: Tool.init(list),
          project: Tool.init(projecttool),
          git: Tool.init(gittool),
          forge: Tool.init(forgetool),
          tools: Tool.init(toolstatus),
          glob: Tool.init(globtool),
          grep: Tool.init(greptool),
          edit: Tool.init(edit),
          write: Tool.init(writetool),
          task: Tool.init(task),
          fetch: Tool.init(webfetch),
          browse: Tool.init(browse),
          browser: Tool.init(browser_tool),
          computer: Tool.init(computer),
          bashInteractive: Tool.init(bashInteractive),
          ssh: Tool.init(ssh),
          todo: Tool.init(todo),
          search: Tool.init(websearch),
          code: Tool.init(codesearch),
          skill: Tool.init(skilltool),
          patch: Tool.init(patchtool),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          plan: Tool.init(plan),
        })

        return {
          custom,
          builtin: [
            tool.invalid,
            ...(questionEnabled ? [tool.question] : []),
            tool.bash,
            tool.read,
            tool.list,
            tool.project,
            tool.tools,
            tool.git,
            tool.forge,
            tool.glob,
            tool.grep,
            tool.edit,
            tool.write,
            tool.task,
            tool.fetch,
            tool.browse,
            ...(isDesktopClient() ? [tool.browser] : []),
            ...(isDesktopClient() ? [tool.computer] : []),
            tool.bashInteractive,
            tool.ssh,
            tool.todo,
            tool.search,
            tool.code,
            tool.skill,
            tool.patch,
            ...(Flag.CODEPLANE_EXPERIMENTAL_LSP_TOOL ? [tool.lsp] : []),
            ...(Flag.CODEPLANE_EXPERIMENTAL_PLAN_MODE && Flag.CODEPLANE_CLIENT === "cli" ? [tool.plan] : []),
          ],
          task: tool.task,
          read: tool.read,
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...s.custom] as Tool.Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const describeSkill = Effect.fn("ToolRegistry.describeSkill")(function* (agent: Agent.Info) {
      const all = yield* skill.all()
      const key = [
        "skill",
        permissionKey(agent.permission),
        all.map((item) => [item.name, item.description, item.location].join("\x1d")).join("\x1e"),
      ].join("\x1f")
      return cache(key, () => {
        const list = all
          .filter((item) => Permission.evaluate("skill", item.name, agent.permission).action !== "deny")
          .toSorted((a, b) => a.name.localeCompare(b.name))
        if (list.length === 0) return "No skills are currently available."
        return [
          "Load a specialized skill that provides domain-specific instructions and workflows.",
          "",
          "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
          "",
          "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
          "",
          'Tool output includes a `<skill_content name="...">` block with the loaded content.',
          "",
          "The following skills provide specialized sets of instructions for particular tasks",
          "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
          "",
          Skill.fmt(list, { verbose: false }),
        ].join("\n")
      })
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
      const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
      const key = [
        "task",
        permissionKey(agent.permission),
        items.map((item) => [item.name, item.mode, item.description ?? ""].join("\x1d")).join("\x1e"),
      ].join("\x1f")
      return cache(key, () => {
        const list = items
          .filter((item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny")
          .toSorted((a, b) => a.name.localeCompare(b.name))
        const description = list
          .map(
            (item) =>
              `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
          )
          .join("\n")
        return ["Available agent types and the tools they have access to:", description].join("\n")
      })
    })

    const candidateTools = Effect.fn("ToolRegistry.candidateTools")(function* (
      input: ToolInput,
      toolConfig: Record<string, boolean> | undefined,
    ) {
      const usePatch =
        input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4")

      return (yield* all()).filter((tool) => {
        if (tool.id === CodeSearchTool.id || tool.id === WebSearchTool.id) {
          return input.providerID === ProviderID.codeplane || Flag.CODEPLANE_ENABLE_EXA
        }

        if (tool.id === BrowserTool.id) {
          if (toolConfig?.browser !== true) return false
          if (!isDesktopClient()) return false
          return true
        }

        if (tool.id === ComputerTool.id) {
          if (toolConfig?.computer !== true) return false
          if (!isDesktopClient()) return false
          return true
        }

        if (tool.id === ApplyPatchTool.id) return usePatch
        if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch

        return true
      })
    })

    const candidateBlockReason = (tool: Tool.Def, input: ToolInput, toolConfig: Record<string, boolean> | undefined) => {
      const usePatch =
        input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4")
      if (tool.id === BrowserTool.id) {
        if (toolConfig?.browser !== true) {
          return {
            id: tool.id,
            reason: "Browser use is disabled in Settings.",
            setup: "Enable Browser use in Desktop Settings → General.",
          }
        }
        if (!isDesktopClient()) {
          return {
            id: tool.id,
            reason: "Browser control is only available in the desktop app.",
            setup: "Launch Codeplane Desktop to use this feature.",
          }
        }
      }
      if (tool.id === ComputerTool.id) {
        if (toolConfig?.computer !== true) {
          return {
            id: tool.id,
            reason: "Computer use is disabled in Settings.",
            setup: "Enable Computer use in Desktop Settings → General.",
          }
        }
        if (!isDesktopClient()) {
          return {
            id: tool.id,
            reason: "Computer use is only available in the desktop app.",
            setup: "Launch Codeplane Desktop to use this feature.",
          }
        }
      }
      if (tool.id === CodeSearchTool.id || tool.id === WebSearchTool.id) {
        if (input.providerID === ProviderID.codeplane || Flag.CODEPLANE_ENABLE_EXA) return
        return {
          id: tool.id,
          reason: "Unavailable for the current provider unless Exa/search support is enabled.",
          setup: "Use the codeplane provider or enable CODEPLANE_ENABLE_EXA.",
        }
      }
      if (tool.id === ApplyPatchTool.id && !usePatch) {
        return {
          id: tool.id,
          reason: "The current model uses edit/write for file changes instead of apply_patch.",
          setup: "Use edit or write for file changes with this model.",
        }
      }
      if ((tool.id === EditTool.id || tool.id === WriteTool.id) && usePatch) {
        return {
          id: tool.id,
          reason: "The current model uses apply_patch for file changes instead of edit/write.",
          setup: "Use apply_patch for file changes with this model.",
        }
      }
    }

    const forgeUnavailable = Effect.fn("ToolRegistry.forgeUnavailable")(function* () {
      const items = Object.entries((yield* config.get()).git ?? {})
      if (items.length === 0) {
        return {
          reason: "No Git host config exists.",
          setup:
            'Use the git tool with operation="config_set" and operation="credential_set" to add a GitHub, GitLab, Bitbucket, Azure DevOps, or generic forge instance.',
        }
      }

      const reasons = yield* Effect.forEach(
        items,
        Effect.fnUntraced(function* ([name, item]) {
          const credential = item.credential
          if (credential?.type === "env" && credential.env) {
            if (process.env[credential.env]) return
            return `${name} reads ${credential.env}, but that environment variable is not set.`
          }
          if (credential?.type === "stored" && credential.key) {
            const stored = yield* auth.get(credential.key).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (stored?.type === "api" && stored.key) return
            return `${name} references ${credential.key}, but no API credential is stored there.`
          }
          if (credential?.type === "ssh") {
            return `${name} uses SSH credentials, which work for git transport but not forge HTTP APIs.`
          }
          return `${name} has no forge API credential.`
        }),
        { concurrency: "unbounded" },
      )

      if (reasons.some((reason) => reason === undefined)) return
      return {
        reason: reasons.filter(Boolean).join(" "),
        setup:
          'Use the git tool with operation="credential_set" and a token or tokenEnv on one configured host to enable forge.',
      }
    })

    const blockReason = Effect.fn("ToolRegistry.blockReason")(function* (tool: Tool.Def, input: ToolInput) {
      const ruleset = Permission.merge(input.agent.permission, input.sessionPermission ?? [])
      if (Permission.disabled([tool.id], ruleset).has(tool.id)) {
        return {
          id: tool.id,
          reason: "Denied by the current agent or session permission rules.",
          setup: "Change the agent/session permission config if this tool should be callable.",
        }
      }
      if (tool.id === ForgeTool.id) {
        const unavailable = yield* forgeUnavailable()
        if (unavailable) return { id: tool.id, ...unavailable }
      }
    })

    const splitAvailability = Effect.fn("ToolRegistry.splitAvailability")(function* (input: ToolInput) {
      const cfg = yield* config.get()
      const [known, candidates] = yield* Effect.all([all(), candidateTools(input, cfg.tools)], { concurrency: "unbounded" })
      const candidateIDs = new Set(candidates.map((tool) => tool.id))
      const checked = yield* Effect.forEach(
        known,
        Effect.fnUntraced(function* (tool) {
          const unavailable = candidateIDs.has(tool.id) ? undefined : candidateBlockReason(tool, input, cfg.tools)
          return { tool, blocked: unavailable ?? (yield* blockReason(tool, input)) }
        }),
        { concurrency: "unbounded" },
      )
      return {
        known,
        tools: checked.flatMap((item) => (item.blocked ? [] : [item.tool])),
        blocked: checked.flatMap((item) => (item.blocked ? [item.blocked] : [])),
      }
    })

    const availability: Interface["availability"] = Effect.fn("ToolRegistry.availability")(function* (input) {
      const result = yield* splitAvailability(input)
      return {
        known: result.known.map((tool) => tool.id).toSorted((a, b) => a.localeCompare(b)),
        available: result.tools.map((tool) => tool.id).toSorted((a, b) => a.localeCompare(b)),
        blocked: result.blocked.toSorted((a, b) => a.id.localeCompare(b.id)),
      }
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const filtered = (yield* splitAvailability(input)).tools

      return yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool: Tool.Def) {
          using _ = log.time(tool.id)
          const output = {
            description: tool.description,
            parameters: tool.parameters,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          return {
            id: tool.id,
            description: [
              output.description,
              tool.id === TaskTool.id ? yield* describeTask(input.agent) : undefined,
              tool.id === SkillTool.id ? yield* describeSkill(input.agent) : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: output.parameters,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError,
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { task: s.task, read: s.read }
    })

    return Service.of({ ids, all, named, availability, tools })
  }),
) as Layer.Layer<Service, never, Requirements>

export const defaultLayer: Layer.Layer<Service, never, never> = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Question.defaultLayer),
    Layer.provide(Todo.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Project.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
  ),
) as Layer.Layer<Service, never, never>
