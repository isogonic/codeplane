import * as Tool from "./tool"
import type * as Truncate from "./truncate"
import DESCRIPTION from "./task.txt"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "../config"
import { Permission } from "../permission"
import { Cause, Effect, Schema, Scope } from "effect"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  /**
   * Subtask prompts surface `Session.BusyError` if their child session is
   * already at queue capacity. Callers (the task tool's executor) must
   * either retry, surface the error to the model, or fail the parent.
   */
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts, Session.BusyError>
  /**
   * Forks a subtask prompt in the background without blocking. Returns
   * immediately. Used for spawn-action subagents that run independently
   * while the parent continues working. Errors in the child are silently
   * caught (the parent checks status via the check action).
   */
  forkPrompt(input: SessionPrompt.PromptInput): Effect.Effect<void, never, Scope.Scope>
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

  return "(subagent completed with no output)"
}

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  action: Schema.optional(Schema.String).annotate({
    description:
      "How to execute: 'run' blocks until complete (default), 'spawn' starts in background and returns task_id immediately so you can continue working, 'check' polls a spawned task by task_id and returns status or final result",
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "For 'check' action: the task_id of a previously spawned task. For 'run' action: resume an existing task session instead of creating a new one.",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const buildPerms = (next: Agent.Info, canTask: boolean, canTodo: boolean, cfg: { experimental?: { primary_tools?: string[] } }) => [
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
    ]

    const metadata = (
      sessionId: string,
      agentName: string,
      model: { providerID: string; modelID: string },
      status: "running" | "completed" | "error",
      startedAt: number,
      completedAt?: number,
    ) => ({
      sessionId,
      agent: agentName,
      model,
      status,
      startedAt,
      ...(completedAt !== undefined ? { completedAt } : {}),
    })

    const checkTask = Effect.fn("TaskTool.checkTask")(function* (
      taskSessionID: SessionID,
      parentSessionID: SessionID,
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const childSession = yield* sessions.get(taskSessionID)
      if (childSession.parentID !== parentSessionID) {
        return yield* Effect.fail(new Error(`task_id ${taskSessionID} is not a child of session ${parentSessionID}`))
      }
      const msgs = yield* sessions.messages({ sessionID: taskSessionID })

      const lastAssistant = [...msgs].reverse().find((m) => m.info.role === "assistant")
      if (!lastAssistant) {
        return {
          output: `task_id: ${taskSessionID}\n\nStatus: starting up — no messages yet. Check again soon.`,
          title: `Check: ${params.description}`,
          metadata: { sessionId: taskSessionID, status: "running", activeTools: [] as string[] },
        }
      }

      const assistantInfo = lastAssistant.info as MessageV2.Assistant
      if (assistantInfo.error || typeof assistantInfo.time.completed === "number" || assistantInfo.finish) {
        const text = resultText(lastAssistant)
        return {
          output: [
            `task_id: ${taskSessionID}`,
            "",
            "<task_result>",
            text || "(subagent finished with no text output)",
            "</task_result>",
          ].join("\n"),
          title: `Check: ${params.description}`,
          metadata: { sessionId: taskSessionID, status: "completed" },
        }
      }

      const runningParts = lastAssistant.parts.filter(
        (p) => p.type === "tool" && p.state.status === "running",
      )
      const runningTools = runningParts.map((p) =>
        p.type === "tool" ? p.tool : "unknown",
      )

      return {
        output: [
          `task_id: ${taskSessionID}`,
          "",
          `Status: still running. ${runningTools.length > 0 ? `Active tools: ${runningTools.join(", ")}` : "Processing..."}`,
          "",
          "The subagent is still working. Use this task_id to check again later.",
        ].join("\n"),
        title: `Check: ${params.description}`,
        metadata: { sessionId: taskSessionID, status: "running", activeTools: runningTools },
      }
    })

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const action = params.action ?? "run"

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

      const enabled = (tool: string) => !Permission.disabled([tool], next.permission).has(tool)
      const canTask = enabled(id)
      const canTodo = enabled("todowrite")

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const taskID = params.task_id
      const existingSession = taskID
        ? yield* sessions
            .get(SessionID.make(taskID))
            .pipe(
              Effect.catchCause((cause) => {
                const error = Cause.squash(cause)
                if (error instanceof Session.SessionNotFoundError) return Effect.succeed(undefined)
                return Effect.failCause(cause)
              }),
            )
        : undefined
      if (existingSession?.id === ctx.sessionID) {
        return yield* Effect.fail(new Error(`Invalid task_id: ${taskID} is not a task session for ${ctx.sessionID}`))
      }

      // --- CHECK action: poll a spawned task without blocking ---
      if (action === "check") {
        if (!taskID) return yield* Effect.fail(new Error("check action requires task_id"))
        const sid = SessionID.make(taskID)
        return yield* checkTask(sid, SessionID.make(ctx.sessionID), params, ctx)
      }

      const taskSession = existingSession?.parentID === ctx.sessionID ? existingSession : undefined
      const nextSession =
        taskSession ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: buildPerms(next, canTask, canTodo, cfg),
        }))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const startedAt = Date.now()
      const mkMeta = (status: "running" | "completed" | "error", completedAt?: number) =>
        metadata(nextSession.id, next.name, model, status, startedAt, completedAt)

      yield* ctx.metadata({
        title: params.description,
        metadata: mkMeta("running"),
      })

      const messageID = MessageID.ascending()

      const promptInput = {
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
      }

      // --- SPAWN action: fire-and-forget, return task_id immediately ---
      if (action === "spawn") {
        const parts = yield* ops.resolvePromptParts(params.prompt)
        yield* ops.forkPrompt({ ...promptInput, parts })

        return {
          title: params.description,
          metadata: mkMeta("running"),
          output: [
            `task_id: ${nextSession.id}`,
            "",
            `Subagent "${params.subagent_type}" spawned in background. It is now running independently.`,
            `Use \`task(action="check", task_id="${nextSession.id}")\` to poll its status later.`,
            `You can continue working on other things while it runs. The subagent will never be interrupted.`,
          ].join("\n"),
        }
      }

      // --- RUN action (default): block until subagent completes ---
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
              .prompt({ ...promptInput, parts })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.gen(function* () {
                    yield* ctx.metadata({
                      title: params.description,
                      metadata: mkMeta("error", Date.now()),
                    })
                    return yield* Effect.failCause(cause)
                  }),
                ),
              )

            const completedAt = Date.now()
            yield* ctx.metadata({
              title: params.description,
              metadata: mkMeta("completed", completedAt),
            })

            return {
              title: params.description,
              metadata: mkMeta("completed", completedAt),
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
      timeoutMs: null,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(
          Effect.catch((error) => {
            if (error instanceof Session.BusyError) {
              return Effect.succeed({
                title: params.description ?? "Subagent",
                metadata: { status: "error" },
                output: `Subagent session is busy (queue full). The child session already has a prompt being processed. Try again with a new task_id or wait for the current task to finish.`,
              })
            }
            return Effect.die(error)
          }),
          Effect.orDie,
        ),
    }
  }) as any,
) as Effect.Effect<
  Tool.Info<typeof Parameters, any>,
  never,
  Agent.Service | Config.Service | Session.Service | Truncate.Service
> & { id: typeof id }
