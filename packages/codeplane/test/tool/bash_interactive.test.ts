import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { BashInteractiveTool } from "../../src/tool/bash_interactive"
import { Truncate } from "../../src/tool"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { Plugin } from "../../src/plugin"
import { Bus } from "../../src/bus"
import { Question } from "../../src/question"
import { GlobalBus } from "../../src/bus/global"
import { SessionID, MessageID } from "../../src/session/schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Plugin.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    Bus.layer,
    Question.defaultLayer,
  ),
)

function initTool() {
  return runtime.runPromise(BashInteractiveTool.pipe(Effect.flatMap((info) => info.init())))
}

describe("bash_interactive", () => {
  // The PTY-backed tool only runs on POSIX; bun-pty isn't loaded for the
  // test runner on win32 in CI.
  if (process.platform === "win32") return

  test(
    "streams live output through ctx.metadata so the renderer can show it before the PTY exits",
    async () => {
      const tool = await initTool()
      await using sandbox = await tmpdir()
      const dir = sandbox.path

      const metadataCalls: Array<{ output?: string; command?: string }> = []
      let askCalled = false

      const result = await Instance.provide({
        directory: dir,
        fn: () =>
          runtime.runPromise(
            tool.execute(
              { command: "printf 'first\\n'; sleep 0.05; printf 'second\\n'", timeout: 5_000, prompts: [] } as any,
              {
                sessionID: SessionID.make("ses_test"),
                messageID: MessageID.make("msg_test"),
                callID: "call_test",
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: ({ metadata }: { metadata?: { output?: string; command?: string } }) =>
                  Effect.sync(() => {
                    if (metadata) metadataCalls.push(metadata)
                  }),
                ask: () =>
                  Effect.sync(() => {
                    askCalled = true
                  }),
              } as any,
            ),
          ),
      })

      expect(askCalled).toBe(true)

      expect(metadataCalls.length).toBeGreaterThanOrEqual(1)
      expect(metadataCalls[0]?.output).toBe("")
      expect(metadataCalls[0]?.command).toBe("printf 'first\\n'; sleep 0.05; printf 'second\\n'")

      const outputs = metadataCalls.map((m) => m.output ?? "").filter((o) => o.length > 0)
      expect(outputs.length).toBeGreaterThanOrEqual(1)
      const lastOutput = outputs[outputs.length - 1]
      expect(lastOutput).toContain("first")
      expect(lastOutput).toContain("second")

      expect(result.output).toContain("first")
      expect(result.output).toContain("second")
      expect((result.metadata as any).output).toContain("first")
      expect((result.metadata as any).output).toContain("second")
    },
    20_000,
  )

  test(
    "prompts: when a pattern matches the PTY output, asks the user via Question.Service and writes the answer back into stdin",
    async () => {
      const tool = await initTool()
      await using sandbox = await tmpdir()
      const dir = sandbox.path

      const sessionID = SessionID.make("ses_prompts_test")
      const messageID = MessageID.make("msg_prompts_test")
      const callID = "call_prompts_test"

      const askedQuestions: string[] = []
      // The SSE stream subscribes to GlobalBus.on("event"). To prove the
      // question reaches the UI, capture every payload emitted to GlobalBus
      // and assert "question.asked" shows up with the right shape.
      const globalEvents: any[] = []
      const captureGlobal = (evt: any) => globalEvents.push(evt)
      GlobalBus.on("event", captureGlobal)

      // The Bus + Question services are instance-scoped, so the responder
      // and the tool execution must live inside the same Instance.provide
      // call, otherwise their PubSubs are different.
      const result = await Instance.provide({
        directory: dir,
        fn: () =>
          runtime.runPromise(
            Effect.gen(function* () {
              const q = yield* Question.Service
              const bus = yield* Bus.Service

              let answered = 0
              // Bind the current Instance ALS so the deferred reply runs
              // inside the same instance context the responder lives in.
              const reply = Instance.bind((requestID: any) =>
                runtime.runPromise(q.reply({ requestID, answers: [["alpha"]] })),
              )
              const unsubscribe = yield* bus.subscribeCallback(Question.Event.Asked, (payload) => {
                const req = payload.properties
                if (req.sessionID !== sessionID) return
                if (answered >= 1) return
                answered++
                askedQuestions.push(req.questions[0]?.question ?? "")
                setTimeout(() => {
                  void reply(req.id)
                }, 5)
              })

              try {
                const command = "printf 'Code: '; read code; printf 'GOT=%s\\n' \"$code\""
                return yield* tool.execute(
                  {
                    command,
                    timeout: 10_000,
                    prompts: [
                      {
                        pattern: "Code:",
                        question: "Enter the verification code",
                        header: "Code",
                      },
                    ],
                  } as any,
                  {
                    sessionID,
                    messageID,
                    callID,
                    agent: "build",
                    abort: new AbortController().signal,
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  } as any,
                )
              } finally {
                unsubscribe()
              }
            }),
          ),
      })

      try {
        // The tool wraps the agent's question with additional context
        // (recent output + a note that the answer goes into the running
        // terminal), so use toContain instead of strict equality.
        expect(askedQuestions.length).toBe(1)
        expect(askedQuestions[0]).toContain("Enter the verification code")
        expect(result.output).toContain("GOT=alpha")

        // Critical: the question.asked event MUST reach GlobalBus. The SSE
        // stream subscribes to GlobalBus and forwards to the UI; if the event
        // never lands here, the UI question dock can never show up.
        const askedOnGlobalBus = globalEvents.filter((e) => e?.payload?.type === "question.asked")
        expect(askedOnGlobalBus.length).toBeGreaterThanOrEqual(1)
        const first = askedOnGlobalBus[0]
        expect(first.payload.properties.sessionID).toBe(sessionID)
        expect(first.payload.properties.tool?.callID).toBe(callID)
        expect(first.payload.properties.questions?.[0]?.question).toContain("Enter the verification code")
      } finally {
        GlobalBus.off("event", captureGlobal)
      }
    },
    20_000,
  )

  test(
    "idle fallback: when no declared prompt matches, after IDLE_FALLBACK_MS the tool asks the user generically — so a wrong/missing pattern never strands the user",
    async () => {
      const tool = await initTool()
      await using sandbox = await tmpdir()
      const dir = sandbox.path

      const sessionID = SessionID.make("ses_idle_test")
      const messageID = MessageID.make("msg_idle_test")
      const callID = "call_idle_test"

      const askedQuestions: string[] = []

      const result = await Instance.provide({
        directory: dir,
        fn: () =>
          runtime.runPromise(
            Effect.gen(function* () {
              const q = yield* Question.Service
              const bus = yield* Bus.Service

              let answered = 0
              const reply = Instance.bind((requestID: any) =>
                runtime.runPromise(q.reply({ requestID, answers: [["fallback-typed"]] })),
              )
              const unsubscribe = yield* bus.subscribeCallback(Question.Event.Asked, (payload) => {
                const req = payload.properties
                if (req.sessionID !== sessionID) return
                if (answered >= 1) return
                answered++
                askedQuestions.push(req.questions[0]?.question ?? "")
                setTimeout(() => {
                  void reply(req.id)
                }, 5)
              })

              try {
                // Print a custom prompt the agent did NOT declare (so the
                // declared-prompt scan misses), then read whatever the user
                // sends and echo it back.
                const command = "printf 'Some weird prompt> '; read x; printf 'GOT=%s\\n' \"$x\""
                return yield* tool.execute(
                  {
                    command,
                    timeout: 15_000,
                    // Empty prompts on purpose — exercises the idle fallback.
                    prompts: [],
                  } as any,
                  {
                    sessionID,
                    messageID,
                    callID,
                    agent: "build",
                    abort: new AbortController().signal,
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  } as any,
                )
              } finally {
                unsubscribe()
              }
            }),
          ),
      })

      // The fallback question must have fired and the user's typed answer
      // must have made it into the PTY's stdin.
      expect(askedQuestions.length).toBe(1)
      expect(askedQuestions[0]).toContain("Some weird prompt>")
      expect(result.output).toContain("GOT=fallback-typed")
    },
    20_000,
  )

  test(
    "claude-auth-style end-to-end: prompts for code, user replies, command does silent work, then prints success and exits — no second confusing question fires during the silent processing window",
    async () => {
      const tool = await initTool()
      await using sandbox = await tmpdir()
      const dir = sandbox.path

      const sessionID = SessionID.make("ses_authflow_test")
      const messageID = MessageID.make("msg_authflow_test")
      const callID = "call_authflow_test"

      const askedQuestions: string[] = []

      const result = await Instance.provide({
        directory: dir,
        fn: () =>
          runtime.runPromise(
            Effect.gen(function* () {
              const q = yield* Question.Service
              const bus = yield* Bus.Service

              const reply = Instance.bind((requestID: any, answer: string) =>
                runtime.runPromise(q.reply({ requestID, answers: [[answer]] })),
              )
              const unsubscribe = yield* bus.subscribeCallback(Question.Event.Asked, (payload) => {
                const req = payload.properties
                if (req.sessionID !== sessionID) return
                askedQuestions.push(req.questions[0]?.question ?? "")
                setTimeout(() => {
                  void reply(req.id, "AUTH-CODE-12345")
                }, 5)
              })

              try {
                // Mimics `claude auth login`: prints URL + prompt, reads
                // a code, simulates a slow auth round-trip (sleep 2 — long
                // enough that without the post-input grace period the
                // idle timer would fire a second question), then prints
                // success and exits.
                const command = [
                  "echo 'Browser did not open? Use the url below to sign in (c to copy)';",
                  "echo '';",
                  "echo 'https://claude.com/cai/oauth/authorize?code=true&client_id=demo&state=xyz';",
                  "echo '';",
                  "printf 'Paste code here if prompted > ';",
                  "read code;",
                  "echo '';",
                  "echo 'Validating...';",
                  // 2s of silent work — verifies the post-input grace
                  // period prevents the idle fallback from re-firing.
                  "sleep 2;",
                  "printf 'GOT=%s\\n' \"$code\";",
                  "echo 'Authentication successful. Logged in.';",
                ].join(" ")

                return yield* tool.execute(
                  {
                    command,
                    timeout: 30_000,
                    prompts: [
                      {
                        pattern: "Paste code here",
                        question: "Paste the verification code from the browser",
                        header: "Auth code",
                      },
                    ],
                  } as any,
                  {
                    sessionID,
                    messageID,
                    callID,
                    agent: "build",
                    abort: new AbortController().signal,
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  } as any,
                )
              } finally {
                unsubscribe()
              }
            }),
          ),
      })

      // Exactly ONE question should have fired — the declared "paste code"
      // prompt. The 2s silent-work window after the user's answer must NOT
      // trigger a second question.
      expect(askedQuestions.length).toBe(1)
      expect(askedQuestions[0]).toContain("Paste the verification code from the browser")

      // The user's answer reached stdin and the script printed both the
      // captured value and the success message before exiting cleanly.
      expect(result.output).toContain("GOT=AUTH-CODE-12345")
      expect(result.output).toContain("Authentication successful")
    },
    30_000,
  )
})
