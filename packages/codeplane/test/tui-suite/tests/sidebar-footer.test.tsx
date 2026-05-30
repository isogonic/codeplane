import { describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@codeplane-ai/plugin/tui"
import { withHarness, trimFrame } from "../harness"
import { View } from "@/tui/feature-plugins/sidebar/footer"
import { ArgsProvider } from "@/tui/context/args"

// Minimal theme stub — only the colors the footer reads.
const theme = {
  text: "#ffffff",
  textMuted: "#888888",
  success: "#22c55e",
  backgroundElement: "#111111",
} as unknown as TuiPluginApi["theme"]["current"]

function stubApi(): TuiPluginApi {
  return {
    app: { version: "28.21.22" },
    theme: { current: theme },
    state: {
      // Footer reads path.directory, vcs.branch, and provider list.
      path: { directory: "/home/agent/projects/codeplane" },
      vcs: { branch: "main" },
      provider: [{ id: "anthropic", models: { sonnet: { cost: { input: 3 } } } }],
    },
    kv: {
      get: (_key: string, fallback: unknown) => fallback,
      set: () => {},
    },
  } as unknown as TuiPluginApi
}

describe("tui-suite/sidebar-footer", () => {
  test("renders Codeplane <version> and the instance name on the line below", async () => {
    await withHarness(
      () => (
        <ArgsProvider instanceLabel="My Workstation">
          <View api={stubApi()} />
        </ArgsProvider>
      ),
      async (h) => {
        await h.settle()
        const frame = trimFrame(h.frame())
        console.log("\n----- sidebar footer (with instance) -----\n" + frame + "\n-------------------------------------------\n")

        // Version line.
        const codeplane = h.find("Codeplane")
        expect(codeplane).not.toBeNull()
        expect(h.find("28.21.22")).not.toBeNull()

        // Instance name line directly below the version line.
        const instance = h.find("My Workstation")
        expect(instance).not.toBeNull()
        expect(instance!.row).toBe(codeplane!.row + 1)
      },
      { width: 48, height: 12 },
    )
  })

  test("omits the instance line when no instance label is present", async () => {
    await withHarness(
      () => (
        <ArgsProvider>
          <View api={stubApi()} />
        </ArgsProvider>
      ),
      async (h) => {
        await h.settle()
        expect(h.find("Codeplane")).not.toBeNull()
        expect(h.find("My Workstation")).toBeNull()
      },
      { width: 48, height: 12 },
    )
  })
})
