import { Effect, Schema } from "effect"
import { spawn as ptySpawn } from "#pty"
import * as Tool from "./tool"
import { Question } from "../question"
import { EffectBridge } from "@/effect"
import DESCRIPTION from "./bash_interactive.txt"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const PROMPT_DEBOUNCE_MS = 250
const STRIP_ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g

const PromptEntry = Schema.Struct({
  pattern: Schema.String.annotate({
    description:
      "JS regex source (no leading/trailing slashes) matched case-insensitively against new output. When matched, the user is asked the corresponding question and the answer is written to the command's stdin.",
  }),
  question: Schema.String.annotate({
    description: "Plain-language question shown to the user when this pattern matches.",
  }),
  header: Schema.optional(Schema.String).annotate({
    description: "Short header (max 30 chars) shown above the question.",
  }),
})

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command to execute interactively." }),
  prompts: Schema.Array(PromptEntry)
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed([] as ReadonlyArray<typeof PromptEntry.Type>)))
    .annotate({
      description:
        "Optional list of prompt patterns the agent expects the command to print. Each fires at most once per match — re-add to handle repeats.",
    }),
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
  // Make sure interactive CLIs see a real terminal.
  out.TERM = out.TERM || "xterm-256color"
  out.CODEPLANE_TERMINAL = "1"
  return out
}

export const BashInteractiveTool = Tool.define(
  "bash_interactive",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const command = params.command
          const prompts = params.prompts ?? []
          const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(params.timeout ?? DEFAULT_TIMEOUT_MS)))
          const cwd = params.cwd && params.cwd.length > 0 ? params.cwd : process.cwd()
          const env = sanitizeEnv(process.env)

          yield* ctx.ask({
            permission: "bash",
            patterns: [command],
            always: [],
            metadata: {
              command,
              description: params.description,
              prompts: prompts.map((p) => p.pattern),
            },
          })

          // Need an EffectBridge so callbacks fired by the PTY (which run
          // outside any Effect runtime) can call Question.Service with the
          // right workspace / instance context restored. Without this,
          // question.ask runs without the Bus context and the dialog never
          // appears in the UI.
          const bridge = yield* EffectBridge.make()

          const compiled = prompts.map((p, i) => ({
            id: i,
            re: new RegExp(p.pattern, "i"),
            question: p.question,
            header: p.header,
            fired: false,
          }))

          const result = yield* Effect.promise(
            () =>
              new Promise<{ output: string; exitCode: number; signal?: number | string }>((resolve, reject) => {
                let buffer = ""
                let allOutput = ""
                let scanTimer: ReturnType<typeof setTimeout> | undefined
                let killed = false
                let timedOut = false
                let scanning = false
                let queued = false

                const isWindows = process.platform === "win32"
                const file = isWindows ? "powershell.exe" : "/bin/sh"
                const args = isWindows ? ["-NoLogo", "-NoProfile", "-Command", command] : ["-c", command]

                let proc: ReturnType<typeof ptySpawn>
                try {
                  proc = ptySpawn(file, args, {
                    name: "xterm-256color",
                    cols: 120,
                    rows: 30,
                    cwd,
                    env,
                  })
                } catch (err) {
                  reject(err instanceof Error ? err : new Error(String(err)))
                  return
                }

                const overallTimer = setTimeout(() => {
                  timedOut = true
                  try {
                    proc.kill("SIGTERM")
                  } catch {}
                  setTimeout(() => {
                    try {
                      proc.kill("SIGKILL")
                    } catch {}
                  }, 1500)
                }, timeoutMs)

                let cleaned = false
                const cleanup = () => {
                  if (cleaned) return
                  cleaned = true
                  clearTimeout(overallTimer)
                  if (scanTimer) clearTimeout(scanTimer)
                  try {
                    dataDisp.dispose()
                  } catch {}
                  try {
                    exitDisp.dispose()
                  } catch {}
                  try {
                    ctx.abort.removeEventListener("abort", abortListener)
                  } catch {}
                }

                const scan = async (): Promise<void> => {
                  if (scanning) {
                    queued = true
                    return
                  }
                  scanning = true
                  try {
                    const haystack = buffer.replace(STRIP_ANSI_RE, "")
                    for (const p of compiled) {
                      if (p.fired) continue
                      if (!p.re.test(haystack)) continue
                      p.fired = true
                      buffer = ""
                      try {
                        const answers = await bridge.promise(
                          question.ask({
                            sessionID: ctx.sessionID,
                            questions: [
                              {
                                question: p.question,
                                header: (p.header ?? p.question).slice(0, 30),
                                options: [],
                                multiple: false,
                              },
                            ],
                            tool: ctx.callID
                              ? { messageID: ctx.messageID, callID: ctx.callID }
                              : undefined,
                          }),
                        )
                        const value = (answers[0]?.[0] ?? "").trim()
                        if (!killed) {
                          try {
                            proc.write(value + "\r")
                          } catch {}
                        }
                      } catch (err) {
                        killed = true
                        try {
                          proc.kill("SIGTERM")
                        } catch {}
                        cleanup()
                        reject(
                          new Error(
                            `bash_interactive: user rejected prompt: ${
                              err instanceof Error ? err.message : String(err)
                            }`,
                          ),
                        )
                        return
                      }
                    }
                  } finally {
                    scanning = false
                  }
                  if (queued) {
                    queued = false
                    void scan()
                  }
                }

                const dataDisp = proc.onData((chunk) => {
                  allOutput += chunk
                  buffer += chunk
                  if (buffer.length > 4096) buffer = buffer.slice(-4096)
                  if (compiled.length === 0) return
                  if (scanTimer) clearTimeout(scanTimer)
                  scanTimer = setTimeout(() => {
                    void scan()
                  }, PROMPT_DEBOUNCE_MS)
                })

                const exitDisp = proc.onExit(({ exitCode, signal }) => {
                  cleanup()
                  if (timedOut) {
                    reject(new Error(`bash_interactive: timed out after ${timeoutMs}ms`))
                    return
                  }
                  resolve({ output: allOutput, exitCode: exitCode ?? -1, signal })
                })

                const abortListener = () => {
                  killed = true
                  try {
                    proc.kill("SIGTERM")
                  } catch {}
                }
                ctx.abort.addEventListener("abort", abortListener)
              }),
          )

          const truncatedOutput =
            result.output.length > 200_000
              ? result.output.slice(-200_000) + "\n\n[…earlier output truncated…]"
              : result.output

          const title = params.description
            ? params.description
            : command.length > 60
              ? command.slice(0, 60) + "…"
              : command

          return {
            title,
            output:
              truncatedOutput ||
              `(no output) exit=${result.exitCode}${result.signal ? ` signal=${result.signal}` : ""}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
