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

function request(route: string, directory: string, init?: RequestInit) {
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(`http://localhost${route}`, {
      ...init,
      headers: {
        "x-codeplane-directory": directory,
        ...init?.headers,
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
            $schema: "https://example.invalid/config.json",
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

  test("fetches OpenAI-compatible custom provider models", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch: async (req) => {
        expect(new URL(req.url).pathname).toBe("/v1/models")
        expect(req.headers.get("authorization")).toBe("Bearer test-key")
        return Response.json({
          data: [{ id: "z-model" }, { id: "a-model", name: "A Model" }, { id: 123 }],
        })
      },
    })

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await request("/provider/custom-models", tmp.path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ baseURL: `${upstream.url}v1/`, apiKey: "test-key" }),
          })
          const body = (await response.json()) as { models: Array<{ id: string; name: string }> }

          expect(response.status).toBe(200)
          expect(body.models).toEqual([
            { id: "a-model", name: "A Model" },
            { id: "z-model", name: "z-model" },
          ])
        },
      })
    } finally {
      await upstream.stop()
    }
  })
})
