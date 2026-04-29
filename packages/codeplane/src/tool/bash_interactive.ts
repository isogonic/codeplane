import { Effect, Schema } from "effect"
import { spawn as ptySpawn } from "#pty"
import * as Tool from "./tool"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { GlobalBus } from "../bus/global"
import { InstanceState } from "@/effect"
import {
  appendOutput,
  killProc,
  register as registerProc,
  unregister as unregisterProc,
} from "./bash_interactive_runtime"
import DESCRIPTION from "./bash_interactive.txt"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command to execute interactively." }),
  timeout: Schema.Number.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(DEFAULT_TIMEOUT_MS))).annotate({
    description: `Milliseconds to allow the command to run (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
  }),
  cwd: Schema.optional(Schema.String).annotate({ description: "Working directory." }),
  description: Schema.optional(Schema.String).annotate({ description: "Short description shown in the UI." }),
})

// Bus events the frontend renderer subscribes to so it can show live PTY
// output and know when the command exited.
export const InteractiveStarted = BusEvent.define(
  "bash_interactive.started",
  Schema.Struct({
    sessionID: Schema.String,
    callID: Schema.String,
    command: Schema.String,
  }),
)
export const InteractiveChunk = BusEvent.define(
  "bash_interactive.chunk",
  Schema.Struct({
    sessionID: Schema.String,
    callID: Schema.String,
    chunk: Schema.String,
  }),
)
export const InteractiveExited = BusEvent.define(
  "bash_interactive.exited",
  Schema.Struct({
    sessionID: Schema.String,
    callID: Schema.String,
    exitCode: Schema.Number,
  }),
)

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v
  }
  out.TERM = out.TERM || "xterm-256color"
  out.CODEPLANE_TERMINAL = "1"
  return out
}

export const BashInteractiveTool = Tool.define(
  "bash_interactive",
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // Capture instance values up-front so we can emit chunk events to
          // the global bus directly from the (synchronous) PTY data callback
          // without needing an Effect context.
          const instanceCtx = yield* InstanceState.context
          const directory = instanceCtx.directory
          const projectID = instanceCtx.project.id
          const workspace = yield* InstanceState.workspaceID
          const command = params.command
          const callID = ctx.callID
          if (!callID) {
            return {
              title: "bash_interactive",
              output: "bash_interactive must be invoked through a tool call (missing callID).",
              metadata: {},
            }
          }

          const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(params.timeout ?? DEFAULT_TIMEOUT_MS)))
          const cwd = params.cwd && params.cwd.length > 0 ? params.cwd : process.cwd()
          const env = sanitizeEnv(process.env)

          yield* ctx.ask({
            permission: "bash",
            patterns: [command],
            always: [],
            metadata: { command, description: params.description, interactive: true },
          })

          const isWindows = process.platform === "win32"
          const file = isWindows ? "powershell.exe" : "/bin/sh"
          const args = isWindows ? ["-NoLogo", "-NoProfile", "-Command", command] : ["-c", command]

          const proc = ptySpawn(file, args, {
            name: "xterm-256color",
            cols: 120,
            rows: 30,
            cwd,
            env,
          })

          registerProc(callID, { proc, sessionID: ctx.sessionID })

          // Tell the frontend a new interactive session is running so it can
          // mount the live terminal renderer for this tool call.
          yield* bus.publish(InteractiveStarted, {
            sessionID: ctx.sessionID,
            callID,
            command,
          })

          const result = yield* Effect.promise(
            () =>
              new Promise<{ output: string; exitCode: number; signal?: number | string; timedOut: boolean }>((resolve) => {
                let allOutput = ""
                let timedOut = false
                let cleaned = false
                const cleanup = () => {
                  if (cleaned) return
                  cleaned = true
                  clearTimeout(overallTimer)
                  try { dataDisp.dispose() } catch {}
                  try { exitDisp.dispose() } catch {}
                  try { ctx.abort.removeEventListener("abort", abortListener) } catch {}
                }

                const overallTimer = setTimeout(() => {
                  timedOut = true
                  try { proc.kill("SIGTERM") } catch {}
                  setTimeout(() => { try { proc.kill("SIGKILL") } catch {} }, 1500)
                }, timeoutMs)

                const dataDisp = proc.onData((chunk) => {
                  allOutput += chunk
                  appendOutput(callID, chunk)
                  // Synchronous JS callback — emit straight to GlobalBus so
                  // SSE subscribers see the chunk without round-tripping
                  // through the Effect runtime (where the context required
                  // by bus.publish is not available from this callback).
                  GlobalBus.emit("event", {
                    directory,
                    project: projectID,
                    workspace,
                    payload: {
                      type: InteractiveChunk.type,
                      properties: {
                        sessionID: ctx.sessionID,
                        callID,
                        chunk,
                      },
                    },
                  })
                })

                const exitDisp = proc.onExit(({ exitCode, signal }) => {
                  cleanup()
                  resolve({ output: allOutput, exitCode: exitCode ?? -1, signal, timedOut })
                })

                const abortListener = () => {
                  try { proc.kill("SIGTERM") } catch {}
                }
                ctx.abort.addEventListener("abort", abortListener)
              }),
          )

          unregisterProc(callID)
          // Final exited event — the frontend renderer detaches its input bar.
          yield* bus.publish(InteractiveExited, {
            sessionID: ctx.sessionID,
            callID,
            exitCode: result.exitCode,
          })

          if (result.timedOut) {
            return {
              title: params.description ?? command.slice(0, 60),
              output: `bash_interactive: timed out after ${timeoutMs}ms\n\n${result.output.slice(-200_000)}`,
              metadata: {},
            }
          }

          const truncatedOutput =
            result.output.length > 200_000
              ? result.output.slice(-200_000) + "\n\n[…earlier output truncated…]"
              : result.output

          return {
            title: params.description ? params.description : command.length > 60 ? command.slice(0, 60) + "…" : command,
            output:
              truncatedOutput ||
              `(no output) exit=${result.exitCode}${result.signal ? ` signal=${result.signal}` : ""}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// expose for the HTTP /global/bash-interactive/:callID/stdin route
export { writeInput, killProc as kill } from "./bash_interactive_runtime"
