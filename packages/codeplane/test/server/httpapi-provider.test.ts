import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import path from "path"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { Instance } from "../../src/project/instance"
import { Env } from "../../src/env"
import { Log } from "../../src/util"
import { makeRuntime } from "../../src/effect/run-service"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>
const env = makeRuntime(Env.Service, Env.defaultLayer)
const set = (key: string, value: string) => env.runSync((svc) => svc.set(key, value))

function request(route: string, directory: string) {
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(`http://localhost${route}`, {
      headers: {
        "x-codeplane-directory": directory,
      },
    }),
    context,
  )
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

describe("provider HttpApi", () => {
  test("catalog keeps provider models hidden by runtime whitelist", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "codeplane.json"),
          JSON.stringify({
            $schema: "https://codeplane.ai/config.json",
            provider: {
              anthropic: {
                whitelist: ["claude-sonnet-4-20250514"],
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        set("ANTHROPIC_API_KEY", "test-api-key")
      },
      fn: async () => {
        const response = await request("/provider", tmp.path)
        const body = (await response.json()) as {
          all: Array<{ id: string; models: Record<string, unknown> }>
          catalog: Array<{ id: string; models: Record<string, unknown> }>
          connected: string[]
        }
        const runtime = body.all.find((provider) => provider.id === "anthropic")
        const catalog = body.catalog.find((provider) => provider.id === "anthropic")

        expect(response.status).toBe(200)
        expect(body.connected).toContain("anthropic")
        expect(Object.keys(runtime?.models ?? {})).toEqual(["claude-sonnet-4-20250514"])
        expect(Object.keys(catalog?.models ?? {})).toContain("claude-sonnet-4-20250514")
        expect(Object.keys(catalog?.models ?? {}).length).toBeGreaterThan(Object.keys(runtime?.models ?? {}).length)
      },
    })
  })
})
