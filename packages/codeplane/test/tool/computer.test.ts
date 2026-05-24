import { afterEach, describe, expect } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool, Truncate } from "../../src/tool"
import { ComputerTool, Parameters } from "../../src/tool/computer"
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
})

function init() {
  return Effect.gen(function* () {
    const info = yield* (ComputerTool as unknown as Effect.Effect<
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

function setDesktopEnv(value: string | undefined, desktopManaged: string | undefined) {
  return Effect.sync(() => {
    if (value === undefined) delete process.env.CODEPLANE_CLIENT
    else process.env.CODEPLANE_CLIENT = value
    if (desktopManaged === undefined) delete process.env.CODEPLANE_DESKTOP_MANAGED
    else process.env.CODEPLANE_DESKTOP_MANAGED = desktopManaged
  })
}

describe("tool.computer", () => {
  it.live("accepts fast cursor action batches", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const def = yield* init()
        const decoded = yield* Schema.decodeUnknownEffect(Parameters)({
          action: "batch",
          actions: [
            { action: "move", coordinate: [10, 20] },
            { action: "right_click", coordinate: [10, 20] },
            { action: "scroll", coordinate: [10, 20], scrollAmount: 3 },
            { action: "key", key: "Cmd+L" },
          ],
        })

        expect(decoded.action).toBe("batch")
        expect(decoded.actions?.map((action) => action.action)).toEqual(["move", "right_click", "scroll", "key"])
      }),
    ),
  )

  it.live("enforces direct execution gates before native OS actions", () =>
    Effect.gen(function* () {
      const previous = process.env.CODEPLANE_CLIENT
      const previousDesktopManaged = process.env.CODEPLANE_DESKTOP_MANAGED
      yield* Effect.addFinalizer(() => setDesktopEnv(previous, previousDesktopManaged))

      yield* provideTmpdirInstance(() =>
        Effect.gen(function* () {
          yield* setDesktopEnv("app", "1")
          const def = yield* init()
          let asked = false
          const result = yield* def.execute(
            { action: "batch", actions: [{ action: "move", coordinate: [1, 1] }] },
            {
              ...ctx,
              ask: () =>
                Effect.sync(() => {
                  asked = true
                }),
            },
          )

          expect(result.output).toContain("Computer use is disabled")
          expect(asked).toBe(false)
        }),
      )

      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const def = yield* init()

            yield* setDesktopEnv("cli", undefined)
            const notDesktop = yield* def.execute(
              { action: "batch", actions: [{ action: "move", coordinate: [1, 1] }] },
              { ...ctx, extra: { model: model(true) } },
            )
            expect(notDesktop.output).toContain("only available in the Codeplane Desktop app")

            yield* setDesktopEnv("app", "1")
            const notVision = yield* def.execute(
              { action: "batch", actions: [{ action: "move", coordinate: [1, 1] }] },
              { ...ctx, extra: { model: model(false) } },
            )
            expect(notVision.output).toContain("vision-capable models")

            let asked = false
            const exit = yield* def
              .execute(
                { action: "batch", actions: [{ action: "move", coordinate: [1, 1] }] },
                {
                  ...ctx,
                  extra: { model: model(true) },
                  ask: () =>
                    Effect.sync(() => {
                      asked = true
                    }).pipe(Effect.flatMap(() => Effect.die(new Error("stop before OS action")))),
                },
              )
              .pipe(Effect.exit)

            expect(asked).toBe(true)
            expect(Exit.isFailure(exit)).toBe(true)
          }),
        { config: { tools: { computer: true } } },
      )
    }),
  )
})
