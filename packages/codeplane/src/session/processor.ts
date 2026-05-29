import { Cause, Deferred, Effect, Layer, Context, Scope } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import * as Session from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import { Log } from "@/util"
import { isRecord } from "@/util/record"
import { SyncEvent } from "@/sync"
import { SessionEvent } from "@/v2/session-event"
import * as DateTime from "effect/DateTime"

const DOOM_LOOP_THRESHOLD = 3
const log = Log.create({ service: "session.processor" })

export type Result = "compact" | "stop" | "continue"

export type Event = LLM.Event

export interface Handle {
  readonly message: MessageV2.Assistant
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
  ) => Effect.Effect<MessageV2.ToolPart | undefined>
  readonly failToolCall: (
    toolCallID: string,
    error: unknown,
    options?: {
      errorText?: string
      metadata?: Record<string, any>
    },
  ) => Effect.Effect<boolean>
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: MessageV2.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
}

type Input = {
  assistantMessage: MessageV2.Assistant
  sessionID: SessionID
  model: Provider.Model
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
}

type ToolCall = {
  partID: MessageV2.ToolPart["id"]
  messageID: MessageV2.ToolPart["messageID"]
  sessionID: MessageV2.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  needsCompaction: boolean
  currentText: MessageV2.TextPart | undefined
  reasoningMap: Record<string, MessageV2.ReasoningPart>
  // Per-step tracking so we can recover answers that GLM-style models emit in
  // the reasoning channel with empty content. Reset on every start-step.
  stepHadText: boolean
  stepReasoningText: string
}

type StreamEvent = Event

export class Service extends Context.Service<Service, Interface>()("@codeplane/SessionProcessor") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Session.Service
  | Config.Service
  | Bus.Service
  | Snapshot.Service
  | Agent.Service
  | LLM.Service
  | Permission.Service
  | Plugin.Service
  | SessionSummary.Service
  | SessionStatus.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const snapshot = yield* Snapshot.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const plugin = yield* Plugin.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      const initialSnapshot = yield* snapshot.track()
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: initialSnapshot,
        blocked: false,
        needsCompaction: false,
        currentText: undefined,
        reasoningMap: {},
        stepHadText: false,
        stepReasoningText: "",
      }
      let aborted = false
      const slog = log.clone().tag("session.id", input.sessionID).tag("messageID", input.assistantMessage.id)

      const parse = (e: unknown) =>
        MessageV2.fromError(e, {
          providerID: input.model.providerID,
          aborted,
        })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        delete ctx.toolcalls[toolCallID]
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          delete ctx.toolcalls[toolCallID]
          return
        }
        return { call, part }
      })

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return
        const part = yield* session.updatePart(update(match.part))
        if (match.part.state.status === "running" && part.state.status === "running") {
          SyncEvent.run(SessionEvent.Tool.Progress.Sync, {
            sessionID: ctx.sessionID,
            callID: toolCallID,
            details: {
              ...(part.state.title ? { title: part.state.title } : {}),
              ...(part.state.metadata ?? {}),
            },
            timestamp: DateTime.makeUnsafe(Date.now()),
          })
        }
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return part
      })

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: {
          title: string
          metadata: Record<string, any>
          output: string
          attachments?: MessageV2.FilePart[]
        },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: match.part.state.input,
            output: output.output,
            metadata: output.metadata,
            title: output.title,
            time: { start: match.part.state.time.start, end: Date.now() },
            attachments: output.attachments,
          },
        })
        yield* settleToolCall(toolCallID)
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (
        toolCallID: string,
        error: unknown,
        options?: {
          errorText?: string
          metadata?: Record<string, any>
        },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || !["pending", "running"].includes(match.part.state.status)) return false
        const end = Date.now()
        const start = match.part.state.status === "running" ? match.part.state.time.start : end
        const stateMetadata = "metadata" in match.part.state ? match.part.state.metadata : undefined
        const metadata =
          match.part.tool === "task"
            ? {
                ...stateMetadata,
                ...(options?.metadata ?? {}),
                status: "error",
                completedAt: end,
              }
            : options?.metadata
              ? { ...stateMetadata, ...options.metadata }
              : stateMetadata
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "error",
            input: match.part.state.input,
            error: options?.errorText ?? errorMessage(error),
            metadata,
            time: { start, end },
          },
        })
        if (error instanceof Permission.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        return true
      })

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        switch (value.type) {
          case "start":
            yield* status.set(ctx.sessionID, { type: "busy" })
            return

          case "reasoning-start":
            if (value.id in ctx.reasoningMap) return
            SyncEvent.run(SessionEvent.Reasoning.Started.Sync, {
              sessionID: ctx.sessionID,
              reasoningID: value.id,
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
            ctx.reasoningMap[value.id] = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.reasoningMap[value.id])
            return

          case "reasoning-delta":
            if (!(value.id in ctx.reasoningMap)) return
            SyncEvent.run(SessionEvent.Reasoning.Delta.Sync, {
              sessionID: ctx.sessionID,
              reasoningID: value.id,
              delta: value.text,
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
            ctx.reasoningMap[value.id].text += value.text
            ctx.stepReasoningText += value.text
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id].sessionID,
              messageID: ctx.reasoningMap[value.id].messageID,
              partID: ctx.reasoningMap[value.id].id,
              field: "text",
              delta: value.text,
            })
            return

          case "reasoning-end":
            if (!(value.id in ctx.reasoningMap)) return
            SyncEvent.run(SessionEvent.Reasoning.Ended.Sync, {
              sessionID: ctx.sessionID,
              reasoningID: value.id,
              text: ctx.reasoningMap[value.id].text,
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.reasoningMap[value.id].text = ctx.reasoningMap[value.id].text
            ctx.reasoningMap[value.id].time = { ...ctx.reasoningMap[value.id].time, end: Date.now() }
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePart(ctx.reasoningMap[value.id])
            delete ctx.reasoningMap[value.id]
            return

          case "tool-input-start":
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
            }
            SyncEvent.run(SessionEvent.Tool.Input.Started.Sync, {
              sessionID: ctx.sessionID,
              callID: value.id,
              name: value.toolName,
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
            const part = yield* session.updatePart({
              id: ctx.toolcalls[value.id]?.partID ?? PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "tool",
              tool: value.toolName,
              callID: value.id,
              state: { status: "pending", input: {}, raw: "" },
              metadata: value.providerExecuted ? { providerExecuted: true } : undefined,
            } satisfies MessageV2.ToolPart)
            ctx.toolcalls[value.id] = {
              done: yield* Deferred.make<void>(),
              partID: part.id,
              messageID: part.messageID,
              sessionID: part.sessionID,
            }
            return

          case "tool-input-delta":
            return

          case "tool-input-end": {
            SyncEvent.run(SessionEvent.Tool.Input.Ended.Sync, {
              sessionID: ctx.sessionID,
              callID: value.id,
              text: "",
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
            return
          }

          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
            }
            const toolCall = yield* readToolCall(value.toolCallId)
            SyncEvent.run(SessionEvent.Tool.Called.Sync, {
              sessionID: ctx.sessionID,
              callID: value.toolCallId,
              tool: value.toolName,
              input: value.input,
              provider: {
                executed: toolCall?.part.metadata?.providerExecuted === true,
                ...(value.providerMetadata ? { metadata: value.providerMetadata } : {}),
              },
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
            yield* updateToolCall(value.toolCallId, (match) => ({
              ...match,
              tool: value.toolName,
              state: {
                ...match.state,
                status: "running",
                input: value.input,
                time: { start: Date.now() },
              },
              metadata: match.metadata?.providerExecuted
                ? { ...value.providerMetadata, providerExecuted: true }
                : value.providerMetadata,
            }))

            const parts = MessageV2.parts(ctx.assistantMessage.id)
            const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

            if (
              recentParts.length !== DOOM_LOOP_THRESHOLD ||
              !recentParts.every(
                (part) =>
                  part.type === "tool" &&
                  part.tool === value.toolName &&
                  part.state.status !== "pending" &&
                  JSON.stringify(part.state.input) === JSON.stringify(value.input),
              )
            ) {
              return
            }

            const agent = yield* agents.get(ctx.assistantMessage.agent)
            yield* permission.ask({
              permission: "doom_loop",
              patterns: [value.toolName],
              sessionID: ctx.assistantMessage.sessionID,
              metadata: { tool: value.toolName, input: value.input },
              always: [value.toolName],
              ruleset: agent.permission,
            })
            return
          }

          case "tool-result": {
            const toolCall = yield* readToolCall(value.toolCallId)
            SyncEvent.run(SessionEvent.Tool.Success.Sync, {
              sessionID: ctx.sessionID,
              callID: value.toolCallId,
              output: value.output.output,
              attachments: value.output.attachments?.map((item: MessageV2.FilePart) => ({
                uri: item.url,
                mime: item.mime,
                ...(item.filename ? { name: item.filename } : {}),
                ...(item.source
                  ? {
                      source: {
                        start: item.source.text.start,
                        end: item.source.text.end,
                        text: item.source.text.value,
                      },
                    }
                  : {}),
              })),
              details: value.output.metadata,
              provider: {
                executed: toolCall?.part.metadata?.providerExecuted === true,
              },
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
            yield* completeToolCall(value.toolCallId, value.output)
            return
          }

          case "tool-error": {
            const toolCall = yield* readToolCall(value.toolCallId)
            SyncEvent.run(SessionEvent.Tool.Error.Sync, {
              sessionID: ctx.sessionID,
              callID: value.toolCallId,
              error: errorMessage(value.error),
              provider: {
                executed: toolCall?.part.metadata?.providerExecuted === true,
              },
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
            yield* failToolCall(value.toolCallId, value.error)
            return
          }

          case "error":
            throw value.error

          case "start-step": {
            ctx.stepHadText = false
            ctx.stepReasoningText = ""
            if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
            // The AI SDK fires `start-step` on receipt of the FIRST CHUNK
            // from the model — i.e. just past TTFT. Stamping it here pairs
            // with `finish-step.time.created` to give a per-step streaming
            // wall time that matches the provider's TPS denominator
            // (excludes TTFT, queue, and the surrounding tool-execution
            // wall time between steps).
            const stepStartedAt = Date.now()
            SyncEvent.run(SessionEvent.Step.Started.Sync, {
              sessionID: ctx.sessionID,
              model: {
                id: ctx.model.id,
                providerID: ctx.model.providerID,
                variant: input.assistantMessage.variant,
              },
              timestamp: DateTime.makeUnsafe(stepStartedAt),
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
              time: { created: stepStartedAt },
            })
            return
          }

          case "finish-step": {
            // openai-compatible reasoning models (e.g. z.ai/zhipuai GLM, deepseek, qwen)
            // stream chain-of-thought via `reasoning_content` and the answer via `content`.
            // GLM in particular often emits a short post-tool answer entirely in
            // `reasoning_content`, leaving `content` empty — with reasoning display off the
            // turn looks blank. When such a step ends without continuing to a tool and
            // produced no visible text, surface the reasoning as the answer. Scoped by SDK
            // (not the catalog `interleaved` flag, which is incomplete — e.g. glm-4.6 hits
            // this with interleaved:false), and self-limiting since it only fires when
            // reasoning was actually streamed but no content was.
            if (
              ctx.model.api.npm === "@ai-sdk/openai-compatible" &&
              value.finishReason !== "tool-calls" &&
              value.finishReason !== "error" &&
              !ctx.stepHadText &&
              ctx.stepReasoningText.trim()
            ) {
              const now = Date.now()
              yield* session.updatePart({
                id: PartID.ascending(),
                messageID: ctx.assistantMessage.id,
                sessionID: ctx.assistantMessage.sessionID,
                type: "text",
                text: ctx.stepReasoningText.trim(),
                time: { start: now, end: now },
              })
              ctx.stepHadText = true
            }
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage,
              metadata: value.providerMetadata,
            })
            // Capture the moment the AI SDK declared the step done (last
            // chunk in). Used as the closing bracket for per-step decode
            // duration in session-context-metrics.
            const stepFinishedAt = Date.now()
            SyncEvent.run(SessionEvent.Step.Ended.Sync, {
              sessionID: ctx.sessionID,
              reason: value.finishReason,
              cost: usage.cost,
              tokens: usage.tokens,
              timestamp: DateTime.makeUnsafe(stepFinishedAt),
            })
            ctx.assistantMessage.finish = value.finishReason
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            yield* session.updatePart({
              id: PartID.ascending(),
              reason: value.finishReason,
              snapshot: yield* snapshot.track(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
              time: { created: stepFinishedAt },
            })
            yield* session.updateMessage(ctx.assistantMessage)
            if (ctx.snapshot) {
              const patch = yield* snapshot.patch(ctx.snapshot)
              if (patch.files.length) {
                yield* session.updatePart({
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
              ctx.snapshot = undefined
            }
            // Per-step background summarize. Bounded so a hung small
            // model doesn't accumulate one zombie fiber per finish-step
            // over a long turn. 90s past any reasonable summary latency.
            yield* summary
              .summarize({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.parentID,
              })
              .pipe(
                Effect.timeoutOrElse({
                  duration: "90 seconds",
                  orElse: () => Effect.die(new Error("summarize timed out")),
                }),
                Effect.ignore,
                Effect.forkIn(scope),
              )
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true
            }
            return
          }

          case "text-start":
            SyncEvent.run(SessionEvent.Text.Started.Sync, {
              sessionID: ctx.sessionID,
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
            ctx.currentText = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.currentText)
            return

          case "text-delta":
            if (!ctx.currentText) return
            if (value.text) ctx.stepHadText = true
            ctx.currentText.text += value.text
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: "text",
              delta: value.text,
            })
            return

          case "text-end":
            if (!ctx.currentText) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.currentText.text = ctx.currentText.text
            ctx.currentText.text = (yield* plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                partID: ctx.currentText.id,
              },
              { text: ctx.currentText.text },
            )).text
            SyncEvent.run(SessionEvent.Text.Ended.Sync, {
              sessionID: ctx.sessionID,
              text: ctx.currentText.text,
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePart(ctx.currentText)
            ctx.currentText = undefined
            return

          case "finish":
            return

          default:
            slog.info("unhandled", { event: value.type, value })
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        if (ctx.snapshot) {
          const patch = yield* snapshot.patch(ctx.snapshot)
          if (patch.files.length) {
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
          }
          ctx.snapshot = undefined
        }

        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* session.updatePart(ctx.currentText)
          ctx.currentText = undefined
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now()
          yield* session.updatePart({
            ...part,
            time: { start: part.time.start ?? end, end },
          })
        }
        ctx.reasoningMap = {}

        // Let pending tool calls settle briefly. Task/subagent calls are
        // skipped below (never aborted). Non-task calls complete synchronously
        // so 250ms is a generous safety net.
        for (const [, call] of Object.entries(ctx.toolcalls)) {
          yield* Deferred.await(call.done).pipe(
            Effect.timeoutOrElse({
              duration: "250 millis",
              orElse: () => Effect.void,
            }),
            Effect.ignore,
          )
        }

        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          const match = yield* readToolCall(toolCallID)
          if (!match) continue
          const part = match.part
          // Task/subagent tool calls are long-running and must never be
          // aborted by cleanup — they complete on their own timeline.
          // Only a user cancel or timeout on the subagent itself stops them.
          if (part.tool === "task") continue
          const end = Date.now()
          const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
          const nextMetadata = { ...metadata, interrupted: true }
          yield* session.updatePart({
            ...part,
            state: {
              ...part.state,
              status: "error",
              error: "Tool execution aborted",
              metadata: nextMetadata,
              time: { start: "time" in part.state ? part.state.time.start : end, end },
            },
          })
        }
        ctx.toolcalls = {}
        ctx.assistantMessage.time.completed = Date.now()
        yield* session.updateMessage(ctx.assistantMessage)
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        slog.error("process", { error: errorMessage(e), stack: e instanceof Error ? e.stack : undefined })
        const error = parse(e)
        if (MessageV2.ContextOverflowError.isInstance(error)) {
          ctx.needsCompaction = true
          yield* bus.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
          return
        }
        ctx.assistantMessage.error = error
        yield* bus.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
        })
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
        slog.info("process")
        ctx.needsCompaction = false
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            ctx.currentText = undefined
            ctx.reasoningMap = {}
            const stream = llm.stream(streamInput)

            yield* stream.pipe(
              Stream.tap((event) => handleEvent(event)),
              Stream.takeUntil(() => ctx.needsCompaction),
              Stream.runDrain,
            )
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.retry(
              SessionRetry.policy({
                parse,
                set: (info) => {
                  SyncEvent.run(SessionEvent.Retried.Sync, {
                    sessionID: ctx.sessionID,
                    attempt: info.attempt,
                    error: {
                      message: info.message,
                      isRetryable: true,
                    },
                    timestamp: DateTime.makeUnsafe(Date.now()),
                  })
                  return status.set(ctx.sessionID, {
                    type: "retry",
                    attempt: info.attempt,
                    message: info.message,
                    next: info.next,
                  })
                },
              }),
            ),
            Effect.catch(halt),
            Effect.ensuring(cleanup()),
          )

          if (ctx.needsCompaction) return "compact"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      })

      return {
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        failToolCall,
        completeToolCall,
        process,
      } satisfies Handle
    })

    return Service.of({ create })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(LLM.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
  ),
)

export * as SessionProcessor from "./processor"
