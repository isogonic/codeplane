import { describe, expect, test } from "bun:test"
import { type ParentProps } from "solid-js"
import type { TuiConfig } from "@/tui/config/tui"
import { TuiConfigProvider } from "@/tui/context/tui-config"
import { KVProvider } from "@/tui/context/kv"
import { ThemeProvider, useTheme } from "@/tui/context/theme"
import { KeybindProvider } from "@/tui/context/keybind"
import { DialogProvider } from "@/tui/ui/dialog"
import { ToastProvider } from "@/tui/ui/toast"
import { RichBlockText } from "@/tui/component/rich-block"
import { withHarness } from "../harness"

const testConfig: TuiConfig.Info = {}
const markdownSample = [
  "Connected to the Coolify server (`bf-dokploy` `0.0.0.0`).",
  "",
  "**Server status:**",
  "- Host: `bf-dokploy`",
  "- User: `devin`",
  "",
  "**Coolify stack running** (healthy):",
  "- `coolify`, `coolify-db`, `coolify-redis`",
].join("\n")

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

function MarkdownProbe(props: { experimental?: boolean }) {
  const { syntax } = useTheme()
  return (
    <box width={90} height={16}>
      <RichBlockText
        text={markdownSample}
        syntax={syntax()}
        streaming={false}
        conceal={false}
        experimental={props.experimental}
      />
    </box>
  )
}

function RichBlockFixture(props: { experimental?: boolean }) {
  return (
    <Providers>
      <MarkdownProbe experimental={props.experimental} />
    </Providers>
  )
}

describe("tui rich-block markdown rendering", () => {
  test("renders markdown formatting by default when no explicit flag is passed", async () => {
    await withHarness(
      () => <RichBlockFixture />,
      async (h) => {
        await h.waitForText("Server status:")
        const text = h.text()
        expect(text).toContain("Server status:")
        expect(text).toContain("Coolify stack running")
        expect(text).not.toContain("**Server status:**")
        expect(text).not.toContain("`bf-dokploy`")
      },
      { width: 100, height: 20 },
    )
  })

  test("can still fall back to raw markdown text when explicitly disabled", async () => {
    await withHarness(
      () => <RichBlockFixture experimental={false} />,
      async (h) => {
        await h.waitForText("**Server status:**")
        const text = h.text()
        expect(text).toContain("**Server status:**")
        expect(text).toContain("`bf-dokploy`")
      },
      { width: 100, height: 20 },
    )
  })
})
