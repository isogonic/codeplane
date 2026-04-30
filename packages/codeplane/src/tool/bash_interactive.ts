import { Effect, Schema } from "effect"
import { spawn as ptySpawn } from "#pty"
import * as Tool from "./tool"
import { EffectBridge } from "@/effect"
import { Question } from "../question"
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
// metadata channel each tick — keeps update payloads bounded for very
// chatty commands while still showing the live tail in the UI.
const METADATA_OUTPUT_TAIL = 64 * 1024
// Wait for output to settle before scanning for prompt patterns. Stops us
// firing the prompt dialog mid-line (e.g. before the trailing "?" arrives).
const PROMPT_DEBOUNCE_MS = 250
// Cap the regex haystack so pattern matching stays cheap on long output.
const PROMPT_BUFFER_CAP = 4096
// Strip ANSI escapes ONLY for prompt detection — the captured output keeps
// them so the renderer can show colored prompts faithfully.
const STRIP_ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g

const PromptEntry = Schema.Struct({
  pattern: Schema.String.annotate({
    description:
      "JS regex source (no leading/trailing slashes) matched case-insensitively against new output. When matched, the user is asked the corresponding question via the chat dialog and the answer is written into the PTY's stdin.",
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
        "REQUIRED for any flow that pauses for user input. Probe the command first with `bash` to discover what prompts it prints, then declare each one here. Each entry fires at most once per match — re-add it to handle repeats. The pattern is matched against new PTY output (case-insensitive); on match the tool pauses, asks the user the question via the standard chat dialog, and writes the answer + \\r into the PTY's stdin. The user's input never reaches the terminal directly — it goes through this tool, so the agent stays in the loop.",
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
    const question = yield* Question.Service

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
          const prompts = params.prompts ?? []

          yield* ctx.ask({
            permission: "bash",
            patterns: [command],
            always: [],
            metadata: {
              command,
              description: params.description,
              interactive: true,
              prompts: prompts.map((p) => p.pattern),
            },
          })

          // Pre-publish the empty body so the renderer can show "$ command"
          // immediately while the PTY warms up — same pattern bash.ts uses.
          yield* ctx.metadata({
            title: params.description ?? command,
            metadata: { command, description: params.description, output: "" },
          })

          // Bridge so the synchronous PTY data callback can call ctx.metadata
          // and Question.Service.ask (Effects) without losing the workspace
          // / instance context.
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

          // Compile prompts up-front. `fired` ensures each prompt asks at
          // most once per match; the agent re-adds the entry to handle a
          // repeated prompt.
          const compiled = prompts.map((p, i) => ({
            id: i,
            re: new RegExp(p.pattern, "i"),
            question: p.question,
            header: p.header,
            fired: false,
          }))

          let allOutput = ""
          let scanBuffer = ""
          let scanTimer: ReturnType<typeof setTimeout> | undefined
          let scanning = false
          let scanQueued = false
          let killed = false
          let userRejected = false

          let lastFlushAt = 0
          let lastFlushedLen = 0
          let flushTimer: ReturnType<typeof setTimeout> | undefined

          const publishMetadata = () => {
            flushTimer = undefined
            lastFlushAt = Date.now()
            lastFlushedLen = allOutput.length
            const snapshot = tail(allOutput, METADATA_OUTPUT_TAIL)
            bridge.fork(
              ctx.metadata({
                title: params.description ?? command,
                metadata: { command, description: params.description, output: snapshot },
              }),
            )
          }
          const finalFlush = () => {
            if (allOutput.length === lastFlushedLen) return
            const snapshot = tail(allOutput, METADATA_OUTPUT_TAIL)
            lastFlushedLen = allOutput.length
            // Use bridge.promise so we can await the final metadata write and
            // guarantee the renderer sees the trailing chunk before the tool
            // returns its result.
            return bridge.promise(
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

          // The renderer ALWAYS shows an inline `›` input bar at the
          // bottom of the bash_interactive box while running; that bar
          // POSTs to /global/bash-interactive/:callID/stdin (which calls
          // writeInput on the bash_interactive_runtime). So even when no
          // declared prompt matches, the user has a guaranteed input
          // path right there in the terminal. We deliberately do NOT
          // fire an idle-fallback question dialog on top of it — having
          // both at once was the "double input, neither works"
          // confusion the user reported. Declared prompts still raise
          // a chat question because they carry agent-supplied context;
          // everything else flows through the inline bar.

          const writeInputToPty = (value: string) => {
            if (killed) return
            // Sanitize — paste from email/Slack/iMessage often comes with
            // stray newlines, tabs, or smart-quote whitespace. Collapse
            // every whitespace run to a single space then trim.
            const clean = value.replace(/\s+/g, " ").trim()
            // Real terminals send \r when Enter is pressed; the PTY's TTY
            // discipline translates CR→NL via ICRNL for cooked-mode reads.
            // Send only \r — sending an additional \n later was causing
            // commands with multiple `read` steps (re-prompt flows) to
            // consume the extra newline as an empty answer for the next
            // prompt. Stick with the single-CR convention `expect`/
            // `pexpect` use; works for shell `read`, inquirer/prompts,
            // readline, and the common interactive CLIs.
            try { proc.write(clean + "\r") } catch {}
            // Don't auto-reset declared-prompt latches here. The CLI's
            // PTY echo + autocomplete redraws often replay the original
            // prompt text on the same line as the user's input ("Paste
            // code here > ABCD-1234"), and resetting fired would loop
            // the question dialog endlessly. Re-prompts after rejection
            // are handled by the agent providing multiple `prompts`
            // entries, OR the idle fallback eventually firing — both
            // safer than blanket resetting.
            scanBuffer = ""
          }

          const askInput = async (question_: string, header: string) => {
            try {
              const answers = await bridge.promise(
                question.ask({
                  sessionID: ctx.sessionID,
                  questions: [
                    {
                      question: question_,
                      header: header.slice(0, 30) || "Input",
                      options: [],
                      multiple: false,
                      custom: true,
                    },
                  ],
                  tool: { messageID: ctx.messageID, callID },
                }),
              )
              const value = (answers[0]?.[0] ?? "").trim()
              writeInputToPty(value)
              // Consume the buffer so the post-input echo + new output
              // starts a clean scan window for the next declared prompt.
              scanBuffer = ""
              return true
            } catch {
              // If the proc has already exited (stop button, timeout, abort,
              // natural exit), the rejection that just unblocked us is the
              // orphan-cleanup the tool itself fired — not the user actively
              // hitting Dismiss. Don't mis-report that as a user dismissal.
              if (cleanedRef.cleaned) return false
              userRejected = true
              killed = true
              try { proc.kill("SIGTERM") } catch {}
              return false
            }
          }

          const recentOutputSnapshot = () => {
            const recent = tail(allOutput.replace(STRIP_ANSI_RE, ""), 2048)
            const lines = recent.split(/\r?\n/).filter((l) => l.trim().length > 0)
            return {
              lastLine: lines[lines.length - 1] ?? "",
              tail: lines.slice(-6).join("\n"),
            }
          }

          // cleanup() inside the Promise toggles this so the askInput
          // catch handler can tell whether a question rejection is the
          // user actively dismissing or the orphan-cleanup the tool fires
          // when the proc has already exited. Wrapped in an object so both
          // sides share the reference.
          const cleanedRef: { cleaned: boolean } = { cleaned: false }

          // Kicks off prompt scanning; reentrant — if a chunk arrives while we
          // are awaiting the user's answer to a previous prompt, queue another
          // scan to run after the current one resolves.
          const scan = async () => {
            if (scanning) {
              scanQueued = true
              return
            }
            scanning = true
            try {
              while (true) {
                const haystack = scanBuffer.replace(STRIP_ANSI_RE, "")
                const next = compiled.find((p) => !p.fired && p.re.test(haystack))
                if (!next) break
                next.fired = true
                scanBuffer = ""
                // Show recent terminal output as context so the user knows
                // what they're answering and why.
                const { tail: head } = recentOutputSnapshot()
                const enriched = head
                  ? `${next.question}\n\n— Recent terminal output —\n${head}\n\nYour answer goes into the running terminal.`
                  : `${next.question}\n\nYour answer goes into the running terminal.`
                const ok = await askInput(enriched, next.header ?? next.question)
                if (!ok) return
              }
            } finally {
              scanning = false
              if (scanQueued) {
                scanQueued = false
                void scan()
              }
            }
          }

          const result = yield* Effect.promise(
            () =>
              new Promise<{ output: string; exitCode: number; signal?: number | string; timedOut: boolean }>((resolve) => {
                let timedOut = false
                const cleanup = () => {
                  if (cleanedRef.cleaned) return
                  cleanedRef.cleaned = true
                  clearTimeout(overallTimer)
                  if (flushTimer) {
                    clearTimeout(flushTimer)
                    flushTimer = undefined
                  }
                  if (scanTimer) {
                    clearTimeout(scanTimer)
                    scanTimer = undefined
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

                  scanBuffer += chunk
                  if (scanBuffer.length > PROMPT_BUFFER_CAP) scanBuffer = scanBuffer.slice(-PROMPT_BUFFER_CAP)
                  if (compiled.length === 0) return
                  if (scanTimer) clearTimeout(scanTimer)
                  scanTimer = setTimeout(() => {
                    scanTimer = undefined
                    void scan()
                  }, PROMPT_DEBOUNCE_MS)
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
          // If the PTY exited (kill button, natural exit, abort, timeout)
          // while a question was still showing in the chat dock, that
          // dialog would otherwise sit there forever waiting for an answer
          // the tool can no longer use. Reject every pending question
          // associated with this tool call so the dialog disappears and
          // the awaiting bridge.promise(question.ask) settles cleanly.
          yield* Effect.catch(
            Effect.gen(function* () {
              const all = yield* question.list()
              for (const item of all) {
                if (item.tool?.callID === callID) {
                  yield* question.reject(item.id)
                }
              }
            }),
            () => Effect.void,
          )
          // Make sure any output produced after the last throttled flush
          // (typical for short-lived commands that exit before the throttle
          // window elapses) reaches the renderer before we return.
          yield* Effect.promise(() => Promise.resolve(finalFlush()).catch(() => {}))

          if (userRejected) {
            const truncated = tail(result.output, 200_000)
            return {
              title: params.description ?? command.slice(0, 60),
              output: `bash_interactive: user dismissed the prompt; the command was aborted.\n\n${truncated}`,
              metadata: { command, description: params.description, output: truncated },
            }
          }

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

          // SIGTERM with no natural-exit path through ctx.abort means the
          // user clicked the stop / kill button. Surface that explicitly so
          // the agent doesn't loop "the command must have crashed, let me
          // retry" — the user actively stopped it.
          if (result.signal === "SIGTERM" && !ctx.abort.aborted) {
            return {
              title: params.description ?? command.slice(0, 60),
              output: `bash_interactive: stopped by user (SIGTERM via kill button)\n\n${truncatedOutput}`,
              metadata: { command, description: params.description, output: truncatedOutput },
            }
          }

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

// expose for the HTTP /global/bash-interactive/:callID/kill route
export { killProc as kill } from "./bash_interactive_runtime"
