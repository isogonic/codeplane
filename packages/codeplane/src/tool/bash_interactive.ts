import { Effect, Schema } from "effect"
import { spawn as ptySpawn } from "#pty"
import * as Tool from "./tool"
import { Question } from "../question"
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

          // Compile prompt regexes; track which ones have already fired so we don't
          // re-ask the user for the same prompt unless the agent re-added it.
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
            let buffer = ""           // sliding window for prompt detection
            let allOutput = ""        // full captured output
            let scanTimer: ReturnType<typeof setTimeout> | undefined
            let killed = false
            let timedOut = false

            const proc = ptySpawn(process.platform === "win32" ? "powershell.exe" : "/bin/sh", process.platform === "win32" ? ["-NoLogo", "-NoProfile", "-Command", command] : ["-c", command], {
              name: "xterm-256color",
              cols: 120,
              rows: 30,
              cwd: params.cwd,
              env: process.env as Record<string, string>,
            })

            const overallTimer = setTimeout(() => {
              timedOut = true
              try { proc.kill("SIGTERM") } catch {}
              setTimeout(() => { try { proc.kill("SIGKILL") } catch {} }, 1500)
            }, timeoutMs)

            const cleanup = () => {
              clearTimeout(overallTimer)
              if (scanTimer) clearTimeout(scanTimer)
              dataDisp.dispose()
              exitDisp.dispose()
              abortListener && ctx.abort.removeEventListener("abort", abortListener)
            }

            const scan = async () => {
              scanTimer = undefined
              const haystack = buffer.replace(STRIP_ANSI_RE, "")
              for (const p of compiled) {
                if (p.fired) continue
                if (!p.re.test(haystack)) continue
                p.fired = true
                buffer = "" // consume the buffer so we don't re-match adjacent text
                try {
                  const answers = await Effect.runPromise(
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
                      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
                    }),
                  )
                  const value = (answers[0]?.[0] ?? "").trim()
                  if (!killed) proc.write(value + "\r")
                } catch (err) {
                  // User rejected the question — abort the command.
                  killed = true
                  try { proc.kill("SIGTERM") } catch {}
                  cleanup()
                  reject(new Error(`User rejected interactive prompt: ${err instanceof Error ? err.message : String(err)}`))
                  return
                }
              }
            }

            const dataDisp = proc.onData((chunk) => {
              allOutput += chunk
              buffer += chunk
              // Cap buffer to keep regex tests cheap; a typical CLI prompt fits well within 4 KB.
              if (buffer.length > 4096) buffer = buffer.slice(-4096)
              if (compiled.length === 0) return
              if (scanTimer) clearTimeout(scanTimer)
              scanTimer = setTimeout(() => { void scan() }, PROMPT_DEBOUNCE_MS)
            })

            const exitDisp = proc.onExit(({ exitCode, signal }) => {
              cleanup()
              if (timedOut) {
                reject(new Error(`bash_interactive timed out after ${timeoutMs}ms`))
                return
              }
              resolve({ output: allOutput, exitCode: exitCode ?? -1, signal })
            })

            const abortListener = () => {
              killed = true
              try { proc.kill("SIGTERM") } catch {}
            }
            ctx.abort.addEventListener("abort", abortListener)
              }),
          )

          const truncatedOutput = result.output.length > 200_000
            ? result.output.slice(-200_000) + "\n\n[…earlier output truncated to keep context small…]"
            : result.output

          const title = params.description ? params.description : command.length > 60 ? command.slice(0, 60) + "…" : command

          return {
            title,
            output: truncatedOutput || `(no output) exit=${result.exitCode}${result.signal ? ` signal=${result.signal}` : ""}`,
            metadata: { exitCode: result.exitCode, signal: result.signal },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
