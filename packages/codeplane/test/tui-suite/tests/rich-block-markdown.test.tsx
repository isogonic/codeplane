import { describe, expect, test } from "bun:test"
import { type ParentProps } from "solid-js"
import type { TuiConfig } from "@/tui/config/tui"
import { TuiConfigProvider } from "@/tui/context/tui-config"
import { KVProvider } from "@/tui/context/kv"
import { ThemeProvider, useTheme } from "@/tui/context/theme"
import { KeybindProvider } from "@/tui/context/keybind"
import { DialogProvider } from "@/tui/ui/dialog"
import { ToastProvider } from "@/tui/ui/toast"
import { MarkdownText } from "@/tui/component/markdown-text"
import { withHarness } from "../harness"

const testConfig: TuiConfig.Info = {}
const markdownSample = [
  "Connected to the Coolify server (`bf-dokploy` `0.0.0.0`).",
  "",
  "**Server status:**",
  "- Host: `bf-dokploy`",
  "- User: `devin`",
  "  - Role: _admin_",
  "",
  "**Coolify stack running** (healthy):",
  "- `coolify`, `coolify-db`, `coolify-redis`",
  "",
  "- [x] Deployment checked",
  "- [ ] Logs reviewed",
  "",
  "See [docs](https://codeplane.cc/docs) and ![diagram](https://example.com/diagram.png).",
  "~~Deprecated~~ fields stay visible.",
  "",
  "| Service | Status |",
  "| --- | --- |",
  "| `coolify` | healthy |",
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
      <MarkdownText
        text={markdownSample}
        syntax={syntax()}
        streaming={false}
        conceal={false}
        experimental={props.experimental}
      />
    </box>
  )
}

function MarkdownTextFixture(props: { experimental?: boolean }) {
  return (
    <Providers>
      <MarkdownProbe experimental={props.experimental ?? true} />
    </Providers>
  )
}

describe("tui markdown text rendering", () => {
  test("renders markdown formatting by default when no explicit flag is passed", async () => {
    await withHarness(
      () => <MarkdownTextFixture />,
      async (h) => {
        await h.waitForText("Server status:")
        await h.waitForGone("**Server status:**")
        const text = h.text()
        expect(text).toContain("Server status:")
        expect(text).toContain("Coolify stack running")
        expect(text).toContain("[x] Deployment checked")
        expect(text).toContain("[ ] Logs reviewed")
        expect(text).toContain("Deployment checked")
        expect(text).toContain("docs (https://codeplane.cc/docs)")
        expect(text).toContain("diagram")
        expect(text).toContain("Deprecated")
        expect(text).toContain("Service")
        expect(text).toContain("healthy")
        expect(text).not.toContain("**Server status:**")
        expect(text).not.toContain("`bf-dokploy`")
        expect(text).not.toContain("[docs]")
        expect(text).not.toContain("![diagram]")
        expect(text).not.toContain("~~Deprecated~~")
        expect(text).not.toContain("[x] [x]")
        expect(text).not.toContain("| Service | Status |")
      },
      { width: 100, height: 20 },
    )
  })

  test("can still fall back to raw markdown text when explicitly disabled", async () => {
    await withHarness(
      () => <MarkdownTextFixture experimental={false} />,
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
