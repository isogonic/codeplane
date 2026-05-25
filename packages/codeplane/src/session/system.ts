import { Context, Effect, Layer } from "effect"

import { Instance } from "../project/instance"
import { Flag } from "@/flag/flag"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import PROMPT_RICH_BLOCKS from "./prompt/rich-blocks.txt"
import PROMPT_BROWSER_INSPECTION from "./prompt/browser-inspection.txt"
import type { Provider } from "@/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"

function pickBase(model: Provider.Model): string {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return PROMPT_BEAST
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) return PROMPT_CODEX
    return PROMPT_GPT
  }
  if (model.api.id.includes("gemini-")) return PROMPT_GEMINI
  if (model.api.id.includes("claude")) return PROMPT_ANTHROPIC
  if (model.api.id.toLowerCase().includes("trinity")) return PROMPT_TRINITY
  if (model.api.id.toLowerCase().includes("kimi")) return PROMPT_KIMI
  return PROMPT_DEFAULT
}

export function provider(model: Provider.Model) {
  const base = pickBase(model)
  const prompts = [base, PROMPT_RICH_BLOCKS]
  const isDesktop = Flag.CODEPLANE_CLIENT === "app" || process.env.CODEPLANE_DESKTOP_MANAGED === "1"
  if (model.capabilities.input.image && isDesktop) {
    prompts.push(PROMPT_BROWSER_INSPECTION)
  }
  return prompts
}

export interface Interface {
  readonly environment: (model: Provider.Model) => string[]
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return Service.of({
      environment(model) {
        const project = Instance.project
        const hasVision = model.capabilities.input.image
        const isDesktop = Flag.CODEPLANE_CLIENT === "app" || process.env.CODEPLANE_DESKTOP_MANAGED === "1"
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${Instance.directory}`,
            `  Workspace root folder: ${Instance.worktree}`,
            `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
          ...(isDesktop
            ? [
                [
                  `<desktop-visual-tools>`,
                  `You are running in the Codeplane Desktop app.`,
                  `When enabled in Settings and present in your tool list, use \`browser\` for isolated Chrome automation and \`computer\` for native desktop control.`,
                  `Prefer \`browser\` for websites and frontend validation because it provides DOM refs, console logs, JS evaluation, page state, virtual mouse events, and screenshots without moving the user's desktop cursor.`,
                  hasVision
                    ? `Use \`computer\` only for native apps or desktop-level tasks; verify every step with screenshots and ask before sensitive or irreversible actions.`
                    : `Use \`computer\` only when explicit coordinates or a user-provided target make the action safe; this model may not be able to inspect screenshot attachments visually.`,
                  `</desktop-visual-tools>`,
                ].join("\n"),
              ]
            : []),
        ]
      },

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))

export * as SystemPrompt from "./system"
