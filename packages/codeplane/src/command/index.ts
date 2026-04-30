import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { EffectBridge } from "@/effect"
import type { InstanceContext } from "@/project/instance"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, Context, Schema } from "effect"
import z from "zod"
import { Config } from "../config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import PROMPT_AUDIT_TETRIS from "./template/audit-tetris.txt"
import PROMPT_BUILD from "./template/build.txt"
import PROMPT_DEV from "./template/dev.txt"
import PROMPT_DOCTOR from "./template/doctor.txt"
import PROMPT_FORGE from "./template/forge.txt"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_GIT from "./template/git.txt"
import PROMPT_PROJECT from "./template/project.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_TEST from "./template/test.txt"
import PROMPT_TOOLS from "./template/tools.txt"
import PROMPT_TYPECHECK from "./template/typecheck.txt"

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: BusEvent.define(
    "command.executed",
    Schema.Struct({
      name: Schema.String,
      sessionID: SessionID,
      arguments: Schema.String,
      messageID: MessageID,
    }),
  ),
}

export const Info = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    source: z.enum(["command", "mcp", "skill"]).optional(),
    // workaround for zod not supporting async functions natively so we use getters
    // https://zod.dev/v4/changelog?id=zfunction
    template: z.promise(z.string()).or(z.string()),
    subtask: z.boolean().optional(),
    hints: z.array(z.string()),
  })
  .meta({
    ref: "Command",
  })

// for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

export function hints(template: string) {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
  return result
}

export const Default = {
  AUDIT_TETRIS: "audit-tetris",
  BUILD: "build",
  DEV: "dev",
  DOCTOR: "doctor",
  FORGE: "forge",
  GIT: "git",
  INIT: "init",
  PROJECT: "project",
  REVIEW: "review",
  TEST: "test",
  TOOLS: "tools",
  TYPECHECK: "typecheck",
} as const

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/Command") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const commands: Record<string, Info> = {}

      commands[Default.AUDIT_TETRIS] = {
        name: Default.AUDIT_TETRIS,
        description: "run a full-stack Tetris local agent audit",
        source: "command",
        get template() {
          return PROMPT_AUDIT_TETRIS
        },
        hints: hints(PROMPT_AUDIT_TETRIS),
      }
      commands[Default.INIT] = {
        name: Default.INIT,
        description: "guided AGENTS.md setup",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      }
      commands[Default.BUILD] = {
        name: Default.BUILD,
        description: "run or configure the project build command",
        source: "command",
        get template() {
          return PROMPT_BUILD
        },
        hints: hints(PROMPT_BUILD),
      }
      commands[Default.DEV] = {
        name: Default.DEV,
        description: "run or configure the project dev/start command",
        source: "command",
        get template() {
          return PROMPT_DEV
        },
        hints: hints(PROMPT_DEV),
      }
      commands[Default.DOCTOR] = {
        name: Default.DOCTOR,
        description: "diagnose native tool availability and credentials",
        source: "command",
        get template() {
          return PROMPT_DOCTOR
        },
        hints: hints(PROMPT_DOCTOR),
      }
      commands[Default.FORGE] = {
        name: Default.FORGE,
        description: "native forge API operations for PRs, issues, CI, and releases",
        source: "command",
        get template() {
          return PROMPT_FORGE
        },
        hints: hints(PROMPT_FORGE),
      }
      commands[Default.GIT] = {
        name: Default.GIT,
        description: "native Git operations and credential setup",
        source: "command",
        get template() {
          return PROMPT_GIT
        },
        hints: hints(PROMPT_GIT),
      }
      commands[Default.PROJECT] = {
        name: Default.PROJECT,
        description: "native project command detection, configuration, and execution",
        source: "command",
        get template() {
          return PROMPT_PROJECT
        },
        hints: hints(PROMPT_PROJECT),
      }
      commands[Default.TOOLS] = {
        name: Default.TOOLS,
        description: "live native tool availability and setup status",
        source: "command",
        get template() {
          return PROMPT_TOOLS
        },
        hints: hints(PROMPT_TOOLS),
      }
      commands[Default.TEST] = {
        name: Default.TEST,
        description: "run or configure the project test command",
        source: "command",
        get template() {
          return PROMPT_TEST
        },
        hints: hints(PROMPT_TEST),
      }
      commands[Default.TYPECHECK] = {
        name: Default.TYPECHECK,
        description: "run or configure the project typecheck command",
        source: "command",
        get template() {
          return PROMPT_TYPECHECK
        },
        hints: hints(PROMPT_TYPECHECK),
      }
      commands[Default.REVIEW] = {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", ctx.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      }

      for (const [name, command] of Object.entries(cfg.command ?? {})) {
        commands[name] = {
          name,
          agent: command.agent,
          model: command.model,
          description: command.description,
          source: "command",
          get template() {
            return command.template
          },
          subtask: command.subtask,
          hints: hints(command.template),
        }
      }

      for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
        commands[name] = {
          name,
          source: "mcp",
          description: prompt.description,
          get template() {
            return bridge.promise(
              mcp
                .getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                )
                .pipe(
                  Effect.map(
                    (template) =>
                      template?.messages
                        .map((message) => (message.content.type === "text" ? message.content.text : ""))
                        .join("\n") || "",
                  ),
                ),
            )
          },
          hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
        }
      }

      for (const item of yield* skill.all()) {
        if (commands[item.name]) continue
        commands[item.name] = {
          name: item.name,
          description: item.description,
          source: "skill",
          get template() {
            return item.content
          },
          hints: [],
        }
      }

      return {
        commands,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.commands[name]
    })

    const list = Effect.fn("Command.list")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.commands)
    })

    return Service.of({ get, list })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(MCP.defaultLayer),
  Layer.provide(Skill.defaultLayer),
)

export * as Command from "."
