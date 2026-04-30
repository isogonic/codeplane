// @ts-nocheck
import { Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { DataProvider } from "../context/data"
import { FileComponentProvider } from "../context/file"
import { SessionTurn } from "./session-turn"

export default {
  title: "UI/BashInteractive",
  id: "components-bash-interactive",
}

export const InteractiveShell = {
  render: () => <InteractiveShellHarness />,
}

export const AuthServiceMatrix = {
  render: () => <AuthServiceMatrixHarness />,
}

function InteractiveShellHarness() {
  const now = Date.now()
  return (
    <ShellHarness
      now={now}
      question={{
        callID: "call-1",
        label: "Auth token",
        placeholder: "Paste the auth token...",
        response: (answer: string) => ["", answer, `accepted:${answer}`].join("\n"),
        success: "Auth token accepted",
      }}
      parts={[
        shellPart(now, {
          id: "part-1",
          callID: "call-1",
          command: "read -r token && printf 'accepted:%s\\n' \"$token\"",
          description: "Paste an auth token",
          output: "Waiting for token...",
          title: "Paste an auth token",
        }),
      ]}
    />
  )
}

function AuthServiceMatrixHarness() {
  const now = Date.now()
  return (
    <ShellHarness
      now={now}
      question={{
        callID: "call-claude",
        label: "Claude authorization code",
        placeholder: "Paste the code from Claude...",
        response: (answer: string) =>
          [
            "",
            answer,
            "Validating Claude authorization code...",
            `claude code=${answer}`,
            "Authentication successful. Logged in.",
          ].join("\n"),
        success: "Claude authorization completed",
      }}
      parts={[
        shellPart(now, {
          id: "github-auth",
          callID: "call-github",
          command: "gh auth login",
          description: "GitHub device login",
          output: [
            "? Where do you use GitHub? [Use arrows to move, type to filter]",
            "> GitHub.com",
            "  Other",
            "? Authenticate Git with your GitHub credentials? Yes",
            "! First copy your one-time code: GH-DEVICE",
            "Waiting for the agent to send the device code from the question dock...",
          ].join("\n"),
          title: "GitHub device login",
        }),
        shellPart(now, {
          id: "claude-auth",
          callID: "call-claude",
          command: "claude auth login",
          description: "Claude OAuth code",
          output: [
            "Opening browser to sign in...",
            "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=demo&state=xyz",
            "Paste code here if prompted >",
          ].join("\n"),
          title: "Claude OAuth code",
        }),
        shellPart(now, {
          id: "npm-auth",
          callID: "call-npm",
          command: "npm login",
          description: "npm username/password/OTP",
          output: [
            "Username: npm-user",
            "Password: ********",
            "One-time password:",
            "Waiting for the agent to send the OTP from the question dock...",
          ].join("\n"),
          title: "npm username/password/OTP",
        }),
        shellPart(now, {
          id: "vercel-auth",
          callID: "call-vercel",
          command: "vercel login",
          description: "Vercel device token",
          output: [
            "Log in to Vercel? Yes",
            "Visit https://vercel.com/device and enter code VC-123",
            "Paste token:",
            "Waiting for the agent to send the token from the question dock...",
          ].join("\n"),
          title: "Vercel device token",
        }),
        shellPart(now, {
          id: "ngrok-auth",
          callID: "call-ngrok",
          command: "ngrok config add-authtoken",
          description: "ngrok authtoken",
          output: [
            "ngrok authtoken:",
            "Region [us]:",
            "Waiting for the agent to send the authtoken and accept the default region...",
          ].join("\n"),
          title: "ngrok authtoken",
        }),
      ]}
    />
  )
}

function shellPart(now: number, props: any) {
  return {
    id: props.id,
    callID: props.callID,
    type: "tool",
    tool: "bash_interactive",
    state: {
      status: "running",
      input: {
        command: props.command,
        description: props.description,
      },
      output: props.output,
      title: props.title,
      metadata: {},
      time: { start: now },
    },
  }
}

function ShellHarness(props: {
  now: number
  parts: any[]
  question?: {
    callID: string
    label: string
    placeholder: string
    response: (answer: string) => string
    success: string
  }
}) {
  const [answer, setAnswer] = createSignal("")
  const [answered, setAnswered] = createSignal(false)
  const [store, setStore] = createStore({
    data: {
      agent: [],
      provider: { all: [] },
      session: [{ id: "session-1", parentID: undefined, title: "Shell fixture", time: { created: props.now } }],
      session_status: { "session-1": { type: "running" } },
      session_diff: {},
      message: {
        "session-1": [
          {
            id: "user-1",
            role: "user",
            sessionID: "session-1",
            parts: [],
            text: "Start an interactive shell",
            time: { created: props.now },
          },
          {
            id: "assistant-1",
            role: "assistant",
            sessionID: "session-1",
            parentID: "user-1",
            providerID: "anthropic",
            modelID: "claude",
            mode: "build",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: props.now },
          },
        ],
      },
      part: {
        "assistant-1": props.parts,
      },
    },
  })

  const append = (callID: string, line: string) => {
    const index = store.data.part["assistant-1"].findIndex((part) => part.callID === callID)
    if (index < 0) return
    setStore("data", "part", "assistant-1", index, "state", "output", (value = "") => `${value}\n${line}`)
  }
  const kill = async ({ callID }: { callID: string }) => append(callID, "stopped")
  const submitAnswer = () => {
    const value = answer().trim()
    if (!props.question || !value || answered()) return
    append(props.question.callID, props.question.response(value))
    setAnswered(true)
  }

  return (
    <DataProvider
      data={store.data}
      directory="/project"
      bashInteractive={{
        kill,
      }}
    >
      <FileComponentProvider component={FileStub}>
        <div style={{ width: "min(760px, 100%)", margin: "0 auto" }}>
          <SessionTurn
            sessionID="session-1"
            messageID="user-1"
            messages={store.data.message["session-1"]}
            shellToolDefaultOpen={true}
          />
          <Show when={props.question && !answered()}>
            <form
              data-testid="auth-code-question"
              onSubmit={(event) => {
                event.preventDefault()
                submitAnswer()
              }}
              style={{
                display: "grid",
                gap: "12px",
                margin: "16px 0 0",
                padding: "12px",
                border: "1px solid var(--border-weak-base)",
                "border-radius": "8px",
                background: "var(--background-stronger)",
              }}
            >
              <div style={{ display: "flex", "justify-content": "space-between", gap: "12px" }}>
                <div style={{ "font-size": "13px", color: "var(--text-base)" }}>1 of 1 questions</div>
                <div style={{ "font-size": "13px", color: "var(--text-weak)" }}>{props.question?.label}</div>
              </div>
              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ "font-size": "12px", color: "var(--text-weak)" }}>Your answer goes into the running terminal.</span>
                <textarea
                  data-testid="auth-code-answer"
                  placeholder={props.question?.placeholder}
                  value={answer()}
                  rows={1}
                  onInput={(event) => setAnswer(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.shiftKey) return
                    event.preventDefault()
                    submitAnswer()
                  }}
                  style={{
                    resize: "none",
                    width: "100%",
                    padding: "10px 12px",
                    "border-radius": "6px",
                    border: "1px solid var(--border-weak-base)",
                    background: "var(--background-base)",
                    color: "var(--text-base)",
                    "font-size": "13px",
                  }}
                />
              </label>
              <div style={{ display: "flex", "justify-content": "flex-end" }}>
                <button
                  type="submit"
                  data-testid="auth-code-submit"
                  style={{
                    padding: "8px 14px",
                    "border-radius": "6px",
                    border: "1px solid var(--border-strong-base)",
                    background: "var(--text-base)",
                    color: "var(--background-base)",
                    "font-size": "13px",
                  }}
                >
                  Submit
                </button>
              </div>
            </form>
          </Show>
          <Show when={answered()}>
            <div
              data-testid="auth-code-success"
              style={{
                margin: "16px 0 0",
                padding: "10px 12px",
                "border-radius": "8px",
                border: "1px solid var(--border-weak-base)",
                color: "var(--text-base)",
                background: "var(--background-stronger)",
                "font-size": "13px",
              }}
            >
              {props.question?.success}
            </div>
          </Show>
        </div>
      </FileComponentProvider>
    </DataProvider>
  )
}

function FileStub() {
  return <div />
}
