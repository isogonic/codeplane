import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "../config"
import { Effect, Schema } from "effect"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

function readableError(error: NonNullable<MessageV2.Assistant["error"]>) {
  const message =
    error.data && typeof error.data === "object" && "message" in error.data && typeof error.data.message === "string"
      ? error.data.message
      : undefined
  return message ? `${error.name}: ${message}` : error.name
}

function resultText(result: MessageV2.WithParts) {
  if (result.info.role === "assistant" && result.info.structured !== undefined) {
    return typeof result.info.structured === "string"
      ? result.info.structured
      : JSON.stringify(result.info.structured, null, 2)
  }

  const text = result.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
  if (text) return text

  if (result.info.role === "assistant" && result.info.error) return readableError(result.info.error)

  const tool = result.parts.findLast(
    (part): part is MessageV2.ToolPart & { state: MessageV2.ToolStateError } =>
      part.type === "tool" && part.state.status === "error",
  )
  if (tool) return `Tool ${tool.tool} failed: ${tool.state.error}`

  return ""
}

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      const next = yield* agent.get(params.subagent_type)
      if (!next || (next.mode !== "subagent" && next.mode !== "all")) {
        const available = (yield* agent.list())
          .filter((item) => (item.mode === "subagent" || item.mode === "all") && !item.hidden)
          .map((item) => item.name)
        const hint = available.length ? ` Available subagents: ${available.join(", ")}` : ""
        return yield* Effect.fail(new Error(`Invalid subagent type: ${params.subagent_type}.${hint}`))
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const canTask = next.permission.some((rule) => rule.permission === id)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...(canTodo
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(canTask
              ? []
              : [
                  {
                    permission: id,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const startedAt = Date.now()
      const metadata = (status: "running" | "completed" | "error", completedAt?: number) => ({
        sessionId: nextSession.id,
        agent: next.name,
        model,
        status,
        startedAt,
        ...(completedAt !== undefined ? { completedAt } : {}),
      })

      yield* ctx.metadata({
        title: params.description,
        metadata: metadata("running"),
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const messageID = MessageID.ascending()

      function cancel() {
        ops.cancel(nextSession.id)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", cancel)
        }),
        () =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const result = yield* ops
              .prompt({
                messageID,
                sessionID: nextSession.id,
                model: {
                  modelID: model.modelID,
                  providerID: model.providerID,
                },
                agent: next.name,
                tools: {
                  ...(canTodo ? {} : { todowrite: false }),
                  ...(canTask ? {} : { task: false }),
                  ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                },
                parts,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.gen(function* () {
                    yield* ctx.metadata({
                      title: params.description,
                      metadata: metadata("error", Date.now()),
                    })
                    return yield* Effect.failCause(cause)
                  }),
                ),
              )

            const completedAt = Date.now()
            yield* ctx.metadata({
              title: params.description,
              metadata: metadata("completed", completedAt),
            })

            return {
              title: params.description,
              metadata: metadata("completed", completedAt),
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                "",
                "<task_result>",
                resultText(result),
                "</task_result>",
              ].join("\n"),
            }
          }),
        () =>
          Effect.sync(() => {
            ctx.abort.removeEventListener("abort", cancel)
          }),
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
