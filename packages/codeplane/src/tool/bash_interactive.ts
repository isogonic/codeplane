import { Effect, Schema } from "effect"
import { spawn as ptySpawn } from "#pty"
import * as Tool from "./tool"
import { EffectBridge } from "@/effect"
import { Question } from "../question"
import { appendOutput, register as registerProc, unregister as unregisterProc } from "./bash_interactive_runtime"
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
const OAUTH_AUTHORIZE_RE =
  /https?:\/\/\S*(?:\/oauth\/authorize|\/cai\/oauth\/authorize)\S*(?:code=true|response_type=code)|https?:\/\/\S*(?:code=true|response_type=code)\S*(?:\/oauth\/authorize|\/cai\/oauth\/authorize)/i
const STDIN_PROMPT_LINE_RE =
  /(?:^|\n)\s*([^\n]{0,220}(?:(?:(?:paste|enter|input|type|provide)[^\n]{0,120}(?:code|token|password|otp|passcode))|(?:(?:code|token|password|otp|passcode)[^\n]{0,120}(?:paste|enter|input|type|provide)))[^\n]{0,80}[:>]\s*)$/i
// Bare credential prompt: line ENDS the buffer with a stdin keyword and ":".
// `sudo` prints just "Password:" / "[sudo] password for kim:" with no verb,
// `ssh` prints "Enter passphrase for key '…':", `git` prints "Username for
// 'https://…':" — none of which match STDIN_PROMPT_LINE_RE. The end-of-buffer
// anchor combined with PROMPT_DEBOUNCE_MS gives us a strong "the CLI is
// actually waiting on stdin right now" signal even without a verb.
const STDIN_BARE_PROMPT_LINE_RE =
  /(?:^|\n)\s*([^\n]{0,220}\b(?:password|passphrase|passcode|username|email|otp|pin|secret|api[\s_-]?key|access[\s_-]?key|auth[\s_-]?token|token)\b[^\n]{0,40}[:>]\s*)$/i
const ENTER_PROMPT_RE =
  /(?:^|\n)\s*(press|hit)\s+(enter|return)(?:\s+(?:to|for)\s+(?:retry|try again|continue|proceed|finish|close|dismiss))?[.!?>: ]*$/i
const URL_CONTINUATION_RE = /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/
const URL_WRAP_RE = /^[?&=#%_.-]|^.{24,}$/
const PromptEntry = Schema.Struct({
  pattern: Schema.String.annotate({
    description: "JS regex source (no leading/trailing slashes) matched case-insensitively against new output.",
  }),
  question: Schema.String.annotate({
    description:
      "Plain-language question shown to the user when this prompt needs a human decision. Still required when answer is set so the intent is documented.",
  }),
  header: Schema.optional(Schema.String).annotate({
    description: "Short header (max 30 chars) shown above the question.",
  }),
  answer: Schema.optional(Schema.String).annotate({
    description:
      "Optional agent-known answer to write directly into the PTY when the pattern matches. Use an empty string to press Enter/select the CLI default. If omitted, the user is asked via the question dock.",
  }),
})

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command to execute interactively." }),
  prompts: Schema.Array(PromptEntry)
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed([] as ReadonlyArray<typeof PromptEntry.Type>)))
    .annotate({
      description:
        "REQUIRED for any flow that pauses for input. Probe the command first with `bash` to discover what prompts it prints, then declare each one here. If the agent already knows the response, set `answer` and the tool writes it into the terminal. If `answer` is omitted, the tool asks the user via the standard question dock and writes that answer into the terminal. The user never types directly into the terminal.",
    }),
  timeout: Schema.Number.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(DEFAULT_TIMEOUT_MS))).annotate(
    {
      description: `Milliseconds to allow the command to run (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
    },
  ),
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

function extractBrowserOAuthUrl(value: string): string | undefined {
  const lines = value
    .replace(STRIP_ANSI_RE, "")
    .replace(/\r/g, "")
    .split("\n")

  for (let i = 0; i < lines.length; i++) {
    const start = lines[i]?.search(/https?:\/\//i) ?? -1
    if (start < 0) continue

    let url = lines[i]!.slice(start).trim()
    for (const line of lines.slice(i + 1)) {
      const next = line.trim()
      if (!next || !URL_CONTINUATION_RE.test(next) || !URL_WRAP_RE.test(next)) break
      url += next
    }

    url = url.replace(/[.,;:!?)\]}'"]+$/, "")
    if (OAUTH_AUTHORIZE_RE.test(url)) return url
  }
}

function autoStdinPrompt(value: string): string | undefined {
  const stripped = value.replace(STRIP_ANSI_RE, "").replace(/\r/g, "\n")
  const match = stripped.match(STDIN_PROMPT_LINE_RE) ?? stripped.match(STDIN_BARE_PROMPT_LINE_RE)
  return match?.[1]?.trim()
}

function autoEnterPrompt(value: string): boolean {
  return ENTER_PROMPT_RE.test(value.replace(STRIP_ANSI_RE, "").replace(/\r/g, "\n"))
}

function autoStdinHeader(prompt: string): string {
  if (/passphrase/i.test(prompt)) return "Passphrase"
  if (/password/i.test(prompt)) return "Password"
  if (/token/i.test(prompt)) return "Token"
  if (/(otp|passcode|\bpin\b|code)/i.test(prompt)) return "Auth code"
  if (/username/i.test(prompt)) return "Username"
  if (/email/i.test(prompt)) return "Email"
  if (/secret|api[\s_-]?key|access[\s_-]?key/i.test(prompt)) return "Credential"
  return "Input"
}

export const BashInteractiveTool = Tool.define(
  "bash_interactive",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      // Bash has its own per-call timeout (`params.timeout`, max 10 min) and
      // its own SIGTERM/SIGKILL escalation. The wrapper timeout is purely a
      // safety net for the case where the inner cleanup itself hangs — give
      // it 30 s of slack past MAX_TIMEOUT_MS so it never preempts a
      // legitimately-running command.
      timeoutMs: MAX_TIMEOUT_MS + 30_000,
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

          // Bridge so synchronous PTY callbacks can run Effects without
          // losing the workspace / instance context.
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

          // Compile prompts up-front. `fired` ensures each prompt responds at
          // most once per match; the agent re-adds the entry to handle a
          // repeated prompt.
          const compiled = prompts.map((p, i) => ({
            id: i,
            re: new RegExp(p.pattern, "i"),
            question: p.question,
            header: p.header,
            answer: p.answer,
            fired: false,
          }))

          let allOutput = ""
          let scanBuffer = ""
          let scanTimer: ReturnType<typeof setTimeout> | undefined
          let scanning = false
          let scanQueued = false
          let killed = false
          let userRejected = false
          let oauthPrompted = false

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

          const writeInputToPty = (value: string) => {
            if (killed) return
            // Sanitize paste/input text. Empty string is meaningful: it sends
            // Enter to accept the highlighted/default option in menu CLIs.
            const clean = value.replace(/\s+/g, " ").trim()
            // Consume the prompt that triggered this input before writing.
            // Some CLIs print the next prompt synchronously as soon as Enter is
            // sent; clearing after proc.write can erase that prompt and freeze.
            scanBuffer = ""
            // Real terminals send \r when Enter is pressed; the PTY's TTY
            // discipline translates CR→NL via ICRNL for cooked-mode reads.
            try {
              proc.write(clean + "\r")
            } catch {}
          }

          // cleanup() inside the Promise toggles this so the question catch
          // handlers can tell whether a question rejection is the user
          // actively dismissing or the orphan-cleanup fired after the proc has
          // already exited. Wrapped in an object so both sides share it.
          const cleanedRef: { cleaned: boolean } = { cleaned: false }

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
              writeInputToPty((answers[0]?.[0] ?? "").trim())
              return true
            } catch {
              // If the proc has already exited (stop button, timeout, abort,
              // natural exit), the rejection that just unblocked us is the
              // orphan-cleanup the tool itself fired — not the user actively
              // hitting Dismiss. Don't mis-report that as a user dismissal.
              if (cleanedRef.cleaned) return false
              userRejected = true
              killed = true
              try {
                proc.kill("SIGTERM")
              } catch {}
              return false
            }
          }

          const askOAuthCode = async (url: string) => {
            try {
              const answers = await bridge.promise(
                question.ask({
                  sessionID: ctx.sessionID,
                  questions: [
                    {
                      question: [
                        "Complete this CLI sign-in in the browser.",
                        "",
                        "If the browser did not open, open this URL:",
                        url,
                        "",
                        "If the browser shows an authorization code, paste it here.",
                        "The agent will send that code into the running terminal.",
                        "",
                        "If sign-in completes automatically without showing a code, leave this unanswered; the prompt will close when the terminal exits.",
                      ].join("\n"),
                      header: "Auth code",
                      options: [],
                      multiple: false,
                      custom: true,
                    },
                  ],
                  tool: { messageID: ctx.messageID, callID },
                }),
              )
              const code = (answers[0]?.[0] ?? "").trim()
              if (code) writeInputToPty(code)
              return true
            } catch {
              if (cleanedRef.cleaned) return false
              userRejected = true
              killed = true
              try {
                proc.kill("SIGTERM")
              } catch {}
              return false
            }
          }

          const recentOutputSnapshot = () => {
            const recent = tail(allOutput.replace(STRIP_ANSI_RE, ""), 2048)
            const lines = recent.split(/\r?\n/).filter((line) => line.trim().length > 0)
            return {
              tail: lines.slice(-6).join("\n"),
            }
          }

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
                const autoPrompt = autoStdinPrompt(haystack)
                const next = compiled.find((p) => !p.fired && p.re.test(haystack))
                if (autoPrompt && next) {
                  next.fired = true
                  scanBuffer = ""

                  if (next.answer !== undefined) {
                    writeInputToPty(next.answer)
                    continue
                  }

                  const { tail: head } = recentOutputSnapshot()
                  const enriched = head
                    ? `${next.question}\n\n— Recent terminal output —\n${head}\n\nThe agent will send your answer into the running terminal.`
                    : `${next.question}\n\nThe agent will send your answer into the running terminal.`
                  const ok = await askInput(enriched, next.header ?? next.question)
                  if (!ok) return
                  continue
                }

                if (autoPrompt) {
                  scanBuffer = ""
                  const { tail: head } = recentOutputSnapshot()
                  const enriched = head
                    ? `The command is waiting for terminal input at this prompt: ${autoPrompt}\n\n— Recent terminal output —\n${head}\n\nThe agent will send your answer into the running terminal.`
                    : `The command is waiting for terminal input at this prompt: ${autoPrompt}\n\nThe agent will send your answer into the running terminal.`
                  const ok = await askInput(enriched, autoStdinHeader(autoPrompt))
                  if (!ok) return
                  continue
                }

                if (autoEnterPrompt(haystack)) {
                  scanBuffer = ""
                  oauthPrompted = false
                  writeInputToPty("")
                  continue
                }

                const oauthUrl = oauthPrompted ? undefined : extractBrowserOAuthUrl(haystack)
                if (oauthUrl) {
                  oauthPrompted = true
                  scanBuffer = ""
                  const ok = await askOAuthCode(oauthUrl)
                  if (!ok) return
                  continue
                }

                if (!next) break
                next.fired = true
                scanBuffer = ""

                if (next.answer !== undefined) {
                  writeInputToPty(next.answer)
                  continue
                }

                const { tail: head } = recentOutputSnapshot()
                const enriched = head
                  ? `${next.question}\n\n— Recent terminal output —\n${head}\n\nThe agent will send your answer into the running terminal.`
                  : `${next.question}\n\nThe agent will send your answer into the running terminal.`
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
              new Promise<{ output: string; exitCode: number; signal?: number | string; timedOut: boolean }>(
                (resolve) => {
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

                  const dataDisp = proc.onData((chunk) => {
                    allOutput += chunk
                    appendOutput(callID, chunk)
                    scheduleFlush()

                    scanBuffer += chunk
                    if (scanBuffer.length > PROMPT_BUFFER_CAP) scanBuffer = scanBuffer.slice(-PROMPT_BUFFER_CAP)
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
                    try {
                      proc.kill("SIGTERM")
                    } catch {}
                  }
                  ctx.abort.addEventListener("abort", abortListener)
                },
              ),
          )

          unregisterProc(callID)
          // If the PTY exited (kill button, natural exit, abort, timeout)
          // while a question was still showing in the chat dock, reject every
          // pending question associated with this tool call so it disappears.
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
          // reaches the renderer before we return.
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
          // the agent doesn't mis-attribute the failure.
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
