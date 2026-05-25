import { describe, expect, test } from "bun:test"
import { createSignal, type ParentProps } from "solid-js"
import { _internalsForTesting } from "@/tui/routes/session/permission"
import { TuiConfigProvider } from "@/tui/context/tui-config"
import { KVProvider } from "@/tui/context/kv"
import { ToastProvider } from "@/tui/ui/toast"
import { ThemeProvider } from "@/tui/context/theme"
import { KeybindProvider } from "@/tui/context/keybind"
import { DialogProvider } from "@/tui/ui/dialog"
import type { TuiConfig } from "@/tui/config/tui"
import { withHarness } from "../harness"

const { Prompt } = _internalsForTesting
const testConfig: TuiConfig.Info = {}

function Providers(props: ParentProps) {
  return (
    <TuiConfigProvider config={testConfig}>
      <KVProvider>
        <ToastProvider>
          <ThemeProvider mode="dark">
            <KeybindProvider>
              <DialogProvider>{props.children}</DialogProvider>
            </KeybindProvider>
          </ThemeProvider>
        </ToastProvider>
      </KVProvider>
    </TuiConfigProvider>
  )
}

function PermissionPromptFixture() {
  const [selected, setSelected] = createSignal("none")
  return (
    <Providers>
      <box flexDirection="column" width={90} height={20}>
        <Prompt
          title="Permission required"
          body={<text>Access external directory ~/outside</text>}
          options={{ once: "Allow once", always: "Allow always", reject: "Reject" }}
          escapeKey="reject"
          onSelect={(option) => setSelected(option)}
        />
        <text>Selected: {selected()}</text>
      </box>
    </Providers>
  )
}

describe("tui permission prompt", () => {
  test("number shortcuts choose an action immediately", async () => {
    await withHarness(
      () => <PermissionPromptFixture />,
      async (h) => {
        await h.waitForText("Allow once")
        await h.press("2")
        expect(h.text()).toContain("Selected: always")
      },
      { width: 100, height: 24 },
    )
  })

  test("tab and arrow keys move selection before enter confirms", async () => {
    await withHarness(
      () => <PermissionPromptFixture />,
      async (h) => {
        await h.waitForText("Allow once")
        await h.press("tab")
        await h.press("enter")
        expect(h.text()).toContain("Selected: always")
      },
      { width: 100, height: 24 },
    )
  })

  test("submitting state ignores duplicate keyboard activation", async () => {
    let calls = 0
    await withHarness(
      () => (
        <Providers>
          <Prompt
            title="Permission required"
            body={<text>Access external directory ~/outside</text>}
            options={{ once: "Allow once", always: "Allow always", reject: "Reject" }}
            submitting
            onSelect={() => {
              calls += 1
            }}
          />
        </Providers>
      ),
      async (h) => {
        await h.waitForText("sending")
        await h.press("enter")
        await h.press("2")
        expect(calls).toBe(0)
      },
      { width: 100, height: 24 },
    )
  })
})
