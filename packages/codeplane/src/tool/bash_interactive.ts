import { Effect, Schema } from "effect"
import { spawn as ptySpawn } from "#pty"
import * as Tool from "./tool"
import { EffectBridge } from "@/effect"
import {
  appendOutput,
  register as registerProc,
  unregister as unregisterProc,
} from "./bash_interactive_runtime"
import DESCRIPTION from "./bash_interactive.txt"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000

// Throttle metadata updates so a fast-talking PTY doesn't spam message.part.updated.
const METADATA_THROTTLE_MS = 80
// Cap how much of the captured PTY output is mirrored back through the
// metadata channel each tick. Keeps update payloads bounded for very
// chatty commands while still showing the live tail in the UI.
const METADATA_OUTPUT_TAIL = 64 * 1024

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command to execute interactively." }),
  timeout: Schema.Number.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(DEFAULT_TIMEOUT_MS))).annotate({
    description: `Milliseconds to allow the command to run (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
  }),
  cwd: Schema.optional(Schema.String).annotate({ description: "Working directory." }),
  description: Schema.optional(Schema.String).annotate({ description: "Short description shown in the UI." }),
})

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v
  }
  out.TERM = out.TERM || "xterm-256color"
  out.CODEPLANE_TERMINAL = "1"
  return out
}

function tail(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(-max)
}

export const BashInteractiveTool = Tool.define(
  "bash_interactive",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const command = params.command
          const callID = ctx.callID
          if (!callID) {
            return {
              title: "bash_interactive",
              output: "bash_interactive must be invoked through a tool call (missing callID).",
              metadata: { command, description: params.description, output: "" },
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

          // Pre-publish the empty body so the renderer can show "$ command"
          // immediately while the PTY warms up — same pattern bash.ts uses.
          yield* ctx.metadata({
            title: params.description ?? command,
            metadata: { command, description: params.description, output: "" },
          })

          // Bridge so the synchronous PTY data callback can call ctx.metadata
          // (an Effect) without losing the workspace/instance context.
          const bridge = yield* EffectBridge.make()

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

          let allOutput = ""
          let lastFlushAt = 0
          let flushTimer: ReturnType<typeof setTimeout> | undefined

          const publishMetadata = () => {
            flushTimer = undefined
            lastFlushAt = Date.now()
            const snapshot = tail(allOutput, METADATA_OUTPUT_TAIL)
            bridge.fork(
              ctx.metadata({
                title: params.description ?? command,
                metadata: { command, description: params.description, output: snapshot },
              }),
            )
          }

          const scheduleFlush = () => {
            const now = Date.now()
            const since = now - lastFlushAt
            if (since >= METADATA_THROTTLE_MS) {
              if (flushTimer) {
                clearTimeout(flushTimer)
                flushTimer = undefined
              }
              publishMetadata()
              return
            }
            if (flushTimer) return
            flushTimer = setTimeout(publishMetadata, METADATA_THROTTLE_MS - since)
          }

          const result = yield* Effect.promise(
            () =>
              new Promise<{ output: string; exitCode: number; signal?: number | string; timedOut: boolean }>((resolve) => {
                let timedOut = false
                let cleaned = false
                const cleanup = () => {
                  if (cleaned) return
                  cleaned = true
                  clearTimeout(overallTimer)
                  if (flushTimer) {
                    clearTimeout(flushTimer)
                    flushTimer = undefined
                  }
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
                  scheduleFlush()
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

          if (result.timedOut) {
            const truncated = tail(result.output, 200_000)
            return {
              title: params.description ?? command.slice(0, 60),
              output: `bash_interactive: timed out after ${timeoutMs}ms\n\n${truncated}`,
              metadata: { command, description: params.description, output: truncated },
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
            metadata: { command, description: params.description, output: truncatedOutput },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// expose for the HTTP /global/bash-interactive/:callID/{stdin,kill} routes
export { writeInput, killProc as kill } from "./bash_interactive_runtime"
