import { afterEach, describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, SessionID } from "../../src/session/schema"
import { BrowserTool, Parameters } from "../../src/tool/browser"
import { Tool, Truncate } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    Provider.defaultLayer,
    Truncate.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
  delete process.env.CODEPLANE_CLIENT
  delete process.env.CODEPLANE_DESKTOP_MANAGED
})

function init() {
  return Effect.gen(function* () {
    const info = yield* (BrowserTool as unknown as Effect.Effect<
      Tool.Info<typeof Parameters, any>,
      never,
      Agent.Service | Config.Service | Provider.Service | Truncate.Service
    >)
    return yield* info.init()
  })
}

function model(image: boolean) {
  return {
    id: ModelID.make("test-model"),
    providerID: ProviderID.make("test"),
    capabilities: { input: { image } },
  } as Provider.Model
}

function setDesktopEnv() {
  return Effect.sync(() => {
    process.env.CODEPLANE_CLIENT = "app"
    process.env.CODEPLANE_DESKTOP_MANAGED = "1"
  })
}

describe("tool.browser", () => {
  it.live("uses the active context model for the vision gate", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* setDesktopEnv()
          const def = yield* init()

          const blocked = yield* def.execute(
            { action: "navigate", url: "https://example.com" },
            { ...ctx, extra: { model: model(false) } },
          )
          expect(blocked.output).toContain("vision-capable models")

          let asked = false
          const exit = yield* def
            .execute(
              { action: "navigate", url: "https://example.com" },
              {
                ...ctx,
                extra: { model: model(true) },
                ask: () =>
                  Effect.sync(() => {
                    asked = true
                  }).pipe(Effect.flatMap(() => Effect.die(new Error("stop before browser action")))),
              },
            )
            .pipe(Effect.exit)

          expect(asked).toBe(true)
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      { config: { tools: { browser: true } } },
    ),
  )
})
