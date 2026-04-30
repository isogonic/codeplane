import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { BashInteractiveTool } from "../../src/tool/bash_interactive"
import { Truncate } from "../../src/tool"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { Plugin } from "../../src/plugin"
import { Bus } from "../../src/bus"
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
              { command: "printf 'first\\n'; sleep 0.05; printf 'second\\n'", timeout: 5_000 } as any,
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

      // First call must be the priming "" so the renderer can show "$ command"
      // immediately while the PTY warms up.
      expect(metadataCalls.length).toBeGreaterThanOrEqual(1)
      expect(metadataCalls[0]?.output).toBe("")
      expect(metadataCalls[0]?.command).toBe("printf 'first\\n'; sleep 0.05; printf 'second\\n'")

      // Subsequent calls must include the live output as it grows.
      const outputs = metadataCalls.map((m) => m.output ?? "").filter((o) => o.length > 0)
      expect(outputs.length).toBeGreaterThanOrEqual(1)
      const lastOutput = outputs[outputs.length - 1]
      expect(lastOutput).toContain("first")
      expect(lastOutput).toContain("second")

      // The final return must contain the full output and a usable metadata.output.
      expect(result.output).toContain("first")
      expect(result.output).toContain("second")
      expect((result.metadata as any).output).toContain("first")
      expect((result.metadata as any).output).toContain("second")
      expect((result.metadata as any).command).toBe("printf 'first\\n'; sleep 0.05; printf 'second\\n'")
    },
    20_000,
  )
})
