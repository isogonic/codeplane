// @ts-nocheck
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

function InteractiveShellHarness() {
  const now = Date.now()
  const [store, setStore] = createStore({
    sent: "",
    data: {
      agent: [],
      provider: { all: [] },
      session: [{ id: "session-1", parentID: undefined, title: "Shell fixture", time: { created: now } }],
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
            time: { created: now },
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
            time: { created: now },
          },
        ],
      },
      part: {
        "assistant-1": [
          {
            id: "part-1",
            callID: "call-1",
            type: "tool",
            tool: "bash_interactive",
            state: {
              status: "running",
              input: {
                command: "read -r token && printf 'accepted:%s\\n' \"$token\"",
                description: "Paste an auth token",
              },
              output: "Waiting for token...",
              title: "Paste an auth token",
              metadata: {},
              time: { start: now },
            },
          },
        ],
      },
    },
  })

  const append = (line: string) => {
    setStore("data", "part", "assistant-1", 0, "state", "output", (value = "") => `${value}\n${line}`)
  }

  return (
    <DataProvider
      data={store.data}
      directory="/project"
      bashInteractive={{
        stdin: async (input) => {
          setStore("sent", input.data)
          append(`submitted:${input.data.replace(/\r/g, "\\r")}`)
        },
        kill: async () => append("stopped"),
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
          <div data-testid="bash-interactive-sent" style={{ "margin-top": "12px", "font-size": "12px" }}>
            {store.sent ? `sent:${store.sent.replace(/\r/g, "\\r")}` : "waiting"}
          </div>
        </div>
      </FileComponentProvider>
    </DataProvider>
  )
}

function FileStub() {
  return <div />
}
