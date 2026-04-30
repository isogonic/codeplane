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
import { QuestionID } from "../../src/question/schema"
import { GlobalBus } from "../../src/bus/global"
import { SessionID, MessageID } from "../../src/session/schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { killProc } from "../../src/tool/bash_interactive_runtime"

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

type PromptSpec = {
  pattern: string
  question: string
  header?: string
  answer?: string
}

async function runAuthScenario(scenario: { name: string; command: string; prompts: PromptSpec[]; answers: string[] }) {
  const tool = await initTool()
  await using sandbox = await tmpdir()
  const dir = sandbox.path
  const id = scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")
  const sessionID = SessionID.make(`ses_auth_${id}`)
  const messageID = MessageID.make(`msg_auth_${id}`)
  const askedQuestions: string[] = []

  const result = await Instance.provide({
    directory: dir,
    fn: () =>
      runtime.runPromise(
        Effect.gen(function* () {
          const q = yield* Question.Service
          const bus = yield* Bus.Service
          const pendingAnswers = [...scenario.answers]
          const reply = Instance.bind((requestID: QuestionID, answer: string) =>
            runtime.runPromise(q.reply({ requestID, answers: [[answer]] })),
          )
          const unsubscribe = yield* bus.subscribeCallback(Question.Event.Asked, (payload) => {
            const req = payload.properties
            if (req.sessionID !== sessionID) return
            askedQuestions.push(req.questions[0]?.question ?? "")
            setTimeout(() => void reply(req.id, pendingAnswers.shift() ?? ""), 5)
          })

          try {
            return yield* tool.execute(
              {
                command: scenario.command,
                timeout: 30_000,
                prompts: scenario.prompts,
                description: `${scenario.name} auth`,
              },
              {
                sessionID,
                messageID,
                callID: `call_auth_${id}`,
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )
          } finally {
            unsubscribe()
          }
        }),
      ),
  })

  return { result, askedQuestions }
}

describe("bash_interactive", () => {
  // The PTY-backed tool only runs on POSIX; bun-pty isn't loaded for the
  // test runner on win32 in CI.
  if (process.platform === "win32") return

  test("streams live output through ctx.metadata so the renderer can show it before the PTY exits", async () => {
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
  }, 20_000)

  test("declared prompts ask the user and write the answer back into stdin", async () => {
    const tool = await initTool()
    await using sandbox = await tmpdir()
    const dir = sandbox.path

    const sessionID = SessionID.make("ses_prompts_test")
    const messageID = MessageID.make("msg_prompts_test")
    const callID = "call_prompts_test"
    const askedQuestions: string[] = []
    const globalEvents: any[] = []
    const captureGlobal = (evt: any) => globalEvents.push(evt)
    GlobalBus.on("event", captureGlobal)

    const result = await Instance.provide({
      directory: dir,
      fn: () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const q = yield* Question.Service
            const bus = yield* Bus.Service

            let answered = 0
            const reply = Instance.bind((requestID: any) =>
              runtime.runPromise(q.reply({ requestID, answers: [["alpha"]] })),
            )
            const unsubscribe = yield* bus.subscribeCallback(Question.Event.Asked, (payload) => {
              const req = payload.properties
              if (req.sessionID !== sessionID) return
              if (answered >= 1) return
              answered++
              askedQuestions.push(req.questions[0]?.question ?? "")
              setTimeout(() => void reply(req.id), 5)
            })

            try {
              return yield* tool.execute(
                {
                  command: "printf 'Code: '; read code; printf 'GOT=%s\\n' \"$code\"",
                  timeout: 10_000,
                  prompts: [{ pattern: "Code:", question: "Enter the verification code", header: "Code" }],
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
      expect(askedQuestions.length).toBe(1)
      expect(askedQuestions[0]).toContain("Enter the verification code")
      expect(result.output).toContain("GOT=alpha")

      const askedOnGlobalBus = globalEvents.filter((event) => event?.payload?.type === "question.asked")
      expect(askedOnGlobalBus.length).toBeGreaterThanOrEqual(1)
      const first = askedOnGlobalBus[0]
      expect(first.payload.properties.sessionID).toBe(sessionID)
      expect(first.payload.properties.tool?.callID).toBe(callID)
      expect(first.payload.properties.questions?.[0]?.question).toContain("Enter the verification code")
    } finally {
      GlobalBus.off("event", captureGlobal)
    }
  }, 20_000)

  test("agent-known answer writes directly without opening a question dock", async () => {
    const tool = await initTool()
    await using sandbox = await tmpdir()
    const dir = sandbox.path

    const sessionID = SessionID.make("ses_answer_test")
    const messageID = MessageID.make("msg_answer_test")
    const askedQuestions: string[] = []

    const result = await Instance.provide({
      directory: dir,
      fn: () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const bus = yield* Bus.Service
            const unsubscribe = yield* bus.subscribeCallback(Question.Event.Asked, (payload) => {
              if (payload.properties.sessionID !== sessionID) return
              askedQuestions.push(payload.properties.questions[0]?.question ?? "")
            })

            try {
              return yield* tool.execute(
                {
                  command:
                    "printf 'Where do you use GitHub? '; read x; if [ -z \"$x\" ]; then printf 'DEFAULT\\n'; else printf 'VALUE=%s\\n' \"$x\"; fi",
                  timeout: 10_000,
                  prompts: [
                    {
                      pattern: "Where do you use GitHub\\?",
                      question: "Where do you use GitHub?",
                      header: "GitHub",
                      answer: "",
                    },
                  ],
                } as any,
                {
                  sessionID,
                  messageID,
                  callID: "call_answer_test",
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

    expect(askedQuestions).toEqual([])
    expect(result.output).toContain("DEFAULT")
  }, 20_000)

  test("kill button while a question is pending rejects the orphaned question and reports stopped-by-user", async () => {
    const tool = await initTool()
    await using sandbox = await tmpdir()
    const dir = sandbox.path

    const sessionID = SessionID.make("ses_kill_test")
    const messageID = MessageID.make("msg_kill_test")
    const callID = "call_kill_test"
    const askedIDs: QuestionID[] = []
    const rejectedIDs: QuestionID[] = []

    const result = await Instance.provide({
      directory: dir,
      fn: () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const bus = yield* Bus.Service

            const unsubAsked = yield* bus.subscribeCallback(Question.Event.Asked, (payload) => {
              if (payload.properties.sessionID !== sessionID) return
              askedIDs.push(payload.properties.id)
              setTimeout(() => killProc(callID), 200)
            })
            const unsubRejected = yield* bus.subscribeCallback(Question.Event.Rejected, (payload) => {
              if (payload.properties.sessionID !== sessionID) return
              rejectedIDs.push(payload.properties.requestID)
            })

            try {
              return yield* tool.execute(
                {
                  command: "printf 'Code: '; read x; printf 'GOT=%s\\n' \"$x\"",
                  timeout: 30_000,
                  prompts: [{ pattern: "Code:", question: "Enter the code", header: "Code" }],
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
              unsubAsked()
              unsubRejected()
            }
          }),
        ),
    })

    expect(askedIDs.length).toBe(1)
    expect(rejectedIDs).toEqual(askedIDs)
    expect(result.output).toContain("stopped by user")
    expect(result.output).not.toContain("GOT=")
  }, 20_000)

  test("user dismisses the question dialog kills the PTY and never hangs", async () => {
    const tool = await initTool()
    await using sandbox = await tmpdir()
    const dir = sandbox.path

    const sessionID = SessionID.make("ses_dismiss_test")
    const messageID = MessageID.make("msg_dismiss_test")

    const result = await Instance.provide({
      directory: dir,
      fn: () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const q = yield* Question.Service
            const bus = yield* Bus.Service

            const reject = Instance.bind((requestID: any) => runtime.runPromise(q.reject(requestID)))
            const unsubscribe = yield* bus.subscribeCallback(Question.Event.Asked, (payload) => {
              const req = payload.properties
              if (req.sessionID !== sessionID) return
              setTimeout(() => void reject(req.id), 5)
            })

            try {
              return yield* tool.execute(
                {
                  command: "printf 'Code: '; read x; printf 'GOT=%s\\n' \"$x\"",
                  timeout: 30_000,
                  prompts: [{ pattern: "Code:", question: "Enter the code", header: "Code" }],
                } as any,
                {
                  sessionID,
                  messageID,
                  callID: "call_dismiss_test",
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

    expect(result.output).toContain("user dismissed")
    expect(result.output).not.toContain("GOT=")
  }, 20_000)

  test("re-prompt via duplicate entries asks again and completes with the second answer", async () => {
    const tool = await initTool()
    await using sandbox = await tmpdir()
    const dir = sandbox.path

    const sessionID = SessionID.make("ses_reprompt_test")
    const messageID = MessageID.make("msg_reprompt_test")
    const askedQuestions: string[] = []

    const result = await Instance.provide({
      directory: dir,
      fn: () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const q = yield* Question.Service
            const bus = yield* Bus.Service

            let nth = 0
            const reply = Instance.bind((requestID: any, answer: string) =>
              runtime.runPromise(q.reply({ requestID, answers: [[answer]] })),
            )
            const unsubscribe = yield* bus.subscribeCallback(Question.Event.Asked, (payload) => {
              const req = payload.properties
              if (req.sessionID !== sessionID) return
              askedQuestions.push(req.questions[0]?.question ?? "")
              const answer = nth === 0 ? "WRONG" : "RIGHT"
              nth++
              setTimeout(() => void reply(req.id, answer), 5)
            })

            try {
              return yield* tool.execute(
                {
                  command: [
                    "printf 'Code: ';",
                    "read x;",
                    'if [ "$x" = "RIGHT" ]; then',
                    "  printf 'OK=%s\\n' \"$x\";",
                    "else",
                    "  printf 'invalid, try again\\n';",
                    "  printf 'Code: ';",
                    "  read y;",
                    "  printf 'OK=%s\\n' \"$y\";",
                    "fi",
                  ].join(" "),
                  timeout: 30_000,
                  prompts: [
                    { pattern: "Code:", question: "Enter the code (first try)", header: "Code 1" },
                    { pattern: "Code:", question: "Enter the code (retry)", header: "Code 2" },
                  ],
                } as any,
                {
                  sessionID,
                  messageID,
                  callID: "call_reprompt_test",
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

    expect(askedQuestions.length).toBe(2)
    expect(askedQuestions[0]).toContain("first try")
    expect(askedQuestions[1]).toContain("retry")
    expect(result.output).toContain("OK=RIGHT")
  }, 20_000)

  test("auth service matrix works through agent-controlled terminal input", async () => {
    const scenarios = [
      {
        name: "GitHub",
        command: [
          "printf '? Where do you use GitHub? [Use arrows to move, type to filter]\\n> GitHub.com\\n  Other\\n';",
          "read host;",
          '[ -z "$host" ] && host="GitHub.com";',
          "printf '? Authenticate Git with your GitHub credentials? (Y/n) ';",
          "read git;",
          "printf '! First copy your one-time code: GH-DEVICE\\n';",
          "printf 'Paste authentication code: ';",
          "read code;",
          'printf "github host=%s git=%s code=%s\\n" "$host" "$git" "$code";',
          "echo 'Logged in as test-user';",
        ].join(" "),
        prompts: [
          {
            pattern: "Where do you use GitHub\\?",
            question: "Select the GitHub host",
            header: "GitHub host",
            answer: "",
          },
          {
            pattern: "Authenticate Git.*\\(Y/n\\)",
            question: "Confirm Git credential authentication",
            header: "GitHub Git",
            answer: "y",
          },
          {
            pattern: "Paste authentication code",
            question: "Paste the GitHub device code",
            header: "GitHub code",
          },
        ],
        answers: ["GH-CODE-123"],
        expectedQuestions: ["Paste the GitHub device code"],
        expectedOutput: ["github host=GitHub.com git=y code=GH-CODE-123", "Logged in as test-user"],
      },
      {
        name: "Claude",
        command: [
          "echo 'Opening browser to sign in...';",
          "echo 'https://claude.com/cai/oauth/authorize?code=true&client_id=demo&state=xyz';",
          "printf 'Paste code here if prompted > ';",
          "read code;",
          'printf "claude code=%s\\n" "$code";',
          "echo 'Authentication successful. Logged in.';",
        ].join(" "),
        prompts: [
          {
            pattern: "Paste code here",
            question: "Paste the Claude authorization code",
            header: "Claude code",
          },
        ],
        answers: ["CLAUDE-CODE-456"],
        expectedQuestions: ["Paste the Claude authorization code"],
        expectedOutput: ["claude code=CLAUDE-CODE-456", "Authentication successful"],
      },
      {
        name: "npm",
        command: [
          "printf 'Username: ';",
          "read user;",
          "printf 'Password: ';",
          "read pass;",
          "printf 'One-time password: ';",
          "read otp;",
          'printf "npm user=%s pass-len=%s otp=%s\\n" "$user" "${#pass}" "$otp";',
          "echo 'Logged in to npm';",
        ].join(" "),
        prompts: [
          { pattern: "Username:", question: "Enter the npm username", header: "npm user" },
          { pattern: "Password:", question: "Enter the npm password", header: "npm password" },
          { pattern: "One-time password:", question: "Enter the npm one-time password", header: "npm OTP" },
        ],
        answers: ["npm-user", "fake-password", "654321"],
        expectedQuestions: ["npm username", "npm password", "npm one-time password"],
        expectedOutput: ["npm user=npm-user pass-len=13 otp=654321", "Logged in to npm"],
      },
      {
        name: "Vercel",
        command: [
          "printf 'Log in to Vercel? (Y/n) ';",
          "read confirm;",
          "echo 'Visit https://vercel.com/device and enter code VC-123';",
          "printf 'Paste token: ';",
          "read token;",
          'printf "vercel confirm=%s token=%s\\n" "$confirm" "$token";',
          "echo 'Authenticated with Vercel';",
        ].join(" "),
        prompts: [
          {
            pattern: "Log in to Vercel\\? \\(Y/n\\)",
            question: "Confirm Vercel login",
            header: "Vercel",
            answer: "y",
          },
          { pattern: "Paste token:", question: "Paste the Vercel device token", header: "Vercel token" },
        ],
        answers: ["VERCEL-TOKEN-789"],
        expectedQuestions: ["Vercel device token"],
        expectedOutput: ["vercel confirm=y token=VERCEL-TOKEN-789", "Authenticated with Vercel"],
      },
      {
        name: "ngrok",
        command: [
          "printf 'ngrok authtoken: ';",
          "read token;",
          "printf 'Region [us]: ';",
          "read region;",
          '[ -z "$region" ] && region="us";',
          'printf "ngrok token=%s region=%s\\n" "$token" "$region";',
          "echo 'Authtoken saved';",
        ].join(" "),
        prompts: [
          { pattern: "ngrok authtoken:", question: "Paste the ngrok authtoken", header: "ngrok token" },
          {
            pattern: "Region \\[us\\]:",
            question: "Choose the ngrok default region",
            header: "ngrok region",
            answer: "",
          },
        ],
        answers: ["NGROK-TOKEN-000"],
        expectedQuestions: ["ngrok authtoken"],
        expectedOutput: ["ngrok token=NGROK-TOKEN-000 region=us", "Authtoken saved"],
      },
    ]

    for (const scenario of scenarios) {
      const { result, askedQuestions } = await runAuthScenario(scenario)
      expect(askedQuestions.length).toBe(scenario.answers.length)
      for (const expected of scenario.expectedQuestions) {
        expect(askedQuestions.some((question) => question.includes(expected))).toBe(true)
      }
      for (const expected of scenario.expectedOutput) {
        expect(result.output).toContain(expected)
      }
    }
  }, 120_000)

  test("OAuth URL-only auth flow does not invent a stdin prompt", async () => {
    const tool = await initTool()
    await using sandbox = await tmpdir()
    const dir = sandbox.path

    const sessionID = SessionID.make("ses_oauth_url_only_test")
    const messageID = MessageID.make("msg_oauth_url_only_test")
    const askedQuestions: string[] = []

    const result = await Instance.provide({
      directory: dir,
      fn: () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const bus = yield* Bus.Service

            const unsubscribe = yield* bus.subscribeCallback(Question.Event.Asked, (payload) => {
              const req = payload.properties
              if (req.sessionID !== sessionID) return
              askedQuestions.push(req.questions[0]?.question ?? "")
            })

            try {
              return yield* tool.execute(
                {
                  command: [
                    "echo 'Opening browser to sign in...';",
                    'echo "If the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=demo&state=xyz";',
                    "echo 'Waiting for browser callback...';",
                  ].join(" "),
                  timeout: 10_000,
                  prompts: [],
                  description: "Claude auth URL-only",
                } as any,
                {
                  sessionID,
                  messageID,
                  callID: "call_oauth_url_only_test",
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

    expect(askedQuestions).toEqual([])
    expect(result.output).toContain("Waiting for browser callback")
    expect(result.output).not.toContain("timed out")
  }, 20_000)

  test("OAuth URL-only auth flow ignores a declared URL prompt", async () => {
    const tool = await initTool()
    await using sandbox = await tmpdir()
    const dir = sandbox.path

    const sessionID = SessionID.make("ses_oauth_declared_url_test")
    const messageID = MessageID.make("msg_oauth_declared_url_test")
    const askedQuestions: string[] = []

    const result = await Instance.provide({
      directory: dir,
      fn: () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const bus = yield* Bus.Service

            const unsubscribe = yield* bus.subscribeCallback(Question.Event.Asked, (payload) => {
              const req = payload.properties
              if (req.sessionID !== sessionID) return
              askedQuestions.push(req.questions[0]?.question ?? "")
            })

            try {
              return yield* tool.execute(
                {
                  command: [
                    "echo 'Opening browser to sign in...';",
                    'echo "If the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=demo&state=xyz";',
                    "echo 'Waiting for browser callback...';",
                  ].join(" "),
                  timeout: 10_000,
                  prompts: [
                    {
                      pattern: "oauth/authorize",
                      question: "Paste the authorization code from the browser",
                      header: "Auth code",
                    },
                  ],
                  description: "Claude auth URL-only",
                } as any,
                {
                  sessionID,
                  messageID,
                  callID: "call_oauth_declared_url_test",
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

    expect(askedQuestions).toEqual([])
    expect(result.output).toContain("Waiting for browser callback")
    expect(result.output).not.toContain("timed out")
  }, 20_000)

  test("claude-auth-style flow asks once, writes the code, and exits cleanly", async () => {
    const tool = await initTool()
    await using sandbox = await tmpdir()
    const dir = sandbox.path

    const sessionID = SessionID.make("ses_authflow_test")
    const messageID = MessageID.make("msg_authflow_test")
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
              setTimeout(() => void reply(req.id, "AUTH-CODE-12345"), 5)
            })

            try {
              const command = [
                "echo 'Browser did not open? Use the url below to sign in (c to copy)';",
                "echo '';",
                "echo 'https://claude.com/cai/oauth/authorize?code=true&client_id=demo&state=xyz';",
                "echo '';",
                "printf 'Paste code here if prompted > ';",
                "read code;",
                "echo '';",
                "echo 'Validating...';",
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
                  callID: "call_authflow_test",
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

    expect(askedQuestions.length).toBe(1)
    expect(askedQuestions[0]).toContain("Paste the verification code from the browser")
    expect(result.output).toContain("GOT=AUTH-CODE-12345")
    expect(result.output).toContain("Authentication successful")
  }, 30_000)
})
