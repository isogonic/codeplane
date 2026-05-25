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

const liveBrowserSmoke = process.env.CODEPLANE_BROWSER_LIVE_SMOKE === "1" ? it.live : it.live.skip

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

function screenshotDataUrl(result: { metadata: Record<string, unknown> }) {
  return String(result.metadata.screenshotDataUrl ?? "")
}

describe("tool.browser", () => {
  it.live("does not require a vision model before browser automation", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* setDesktopEnv()
          const def = yield* init()

          let asked = false
          const exit = yield* def
            .execute(
              { action: "navigate", url: "https://example.com" },
              {
                ...ctx,
                extra: { model: model(false) },
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

  liveBrowserSmoke("drives a real isolated Chrome page end-to-end", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* setDesktopEnv()
          const def = yield* init()
          const toolCtx = { ...ctx, extra: { model: model(false) } }
          try {
            const url = `data:text/html;charset=utf-8,${encodeURIComponent(
              [
                "<!doctype html>",
                "<title>Codeplane Browser Smoke</title>",
                "<button id=\"target\" onclick=\"document.body.dataset.clicked='yes'\">Run proof</button>",
                "<input id=\"field\" aria-label=\"Proof field\" />",
                "<script>console.log('browser-smoke-ready')</script>",
              ].join(""),
            )}`
            const navigated = yield* def.execute({ action: "navigate", url, width: 640, height: 480, waitMs: 250 }, toolCtx)
            expect(screenshotDataUrl(navigated)).toStartWith("data:image/png;base64,")

            const snapshot = yield* def.execute({ action: "snapshot", width: 640, height: 480 }, toolCtx)
            expect(snapshot.output).toContain("Proof field")
            expect(screenshotDataUrl(snapshot)).toStartWith("data:image/png;base64,")

            const hovered = yield* def.execute({ action: "hover", selector: "#target", width: 640, height: 480 }, toolCtx)
            expect(screenshotDataUrl(hovered)).toStartWith("data:image/png;base64,")

            yield* def.execute({ action: "click", selector: "#target", width: 640, height: 480 }, toolCtx)
            const clicked = yield* def.execute({ action: "evaluate", script: "document.body.dataset.clicked" }, toolCtx)
            expect(clicked.output).toContain("yes")

            yield* def.execute({ action: "type", selector: "#field", text: "codeplane-browser-proof", width: 640, height: 480 }, toolCtx)
            const typed = yield* def.execute({ action: "evaluate", script: "document.querySelector('#field').value" }, toolCtx)
            expect(typed.output).toContain("codeplane-browser-proof")

            const keypress = yield* def.execute({ action: "key", key: "Ctrl+A", width: 640, height: 480 }, toolCtx)
            expect(screenshotDataUrl(keypress)).toStartWith("data:image/png;base64,")
          } finally {
            yield* def
              .execute({ action: "close" }, toolCtx)
              .pipe(Effect.catch(() => Effect.void), Effect.catchDefect(() => Effect.void))
          }
        }),
      { config: { tools: { browser: true } } },
    ),
  )
})
