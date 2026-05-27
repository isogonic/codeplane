import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import { Flag } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { FilePaths } from "../../src/server/routes/instance/httpapi/file"
import * as AuthRateLimit from "../../src/server/rate-limit"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = {
  CODEPLANE_EXPERIMENTAL_HTTPAPI: Flag.CODEPLANE_EXPERIMENTAL_HTTPAPI,
  CODEPLANE_SERVER_PASSWORD: Flag.CODEPLANE_SERVER_PASSWORD,
  CODEPLANE_SERVER_USERNAME: Flag.CODEPLANE_SERVER_USERNAME,
}

const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket

function app(input?: { password?: string; username?: string }) {
  Flag.CODEPLANE_EXPERIMENTAL_HTTPAPI = true
  Flag.CODEPLANE_SERVER_PASSWORD = input?.password
  Flag.CODEPLANE_SERVER_USERNAME = input?.username
  return InstanceRoutes(websocket)
}

function authorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function fileUrl(input?: { directory?: string; token?: string }) {
  const url = new URL(`http://localhost${FilePaths.content}`)
  url.searchParams.set("path", "hello.txt")
  if (input?.directory) url.searchParams.set("directory", input.directory)
  if (input?.token) url.searchParams.set("auth_token", input.token)
  return url
}

afterEach(async () => {
  Flag.CODEPLANE_EXPERIMENTAL_HTTPAPI = original.CODEPLANE_EXPERIMENTAL_HTTPAPI
  Flag.CODEPLANE_SERVER_PASSWORD = original.CODEPLANE_SERVER_PASSWORD
  Flag.CODEPLANE_SERVER_USERNAME = original.CODEPLANE_SERVER_USERNAME
  // Module-level state; clear between tests so failed-auth counts don't
  // leak across test cases and accidentally trigger the lockout.
  AuthRateLimit.reset()
  await Instance.disposeAll()
  await resetDatabase()
})

describe("HttpApi Hono bridge", () => {
  test("allows requests when auth is disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const response = await app().request(fileUrl(), {
      headers: {
        "x-codeplane-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: "hello" })
  })

  test("provides instance context to bridged handlers", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await app().request("/project/current", {
      headers: {
        "x-codeplane-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ worktree: tmp.path })
  })

  test("requires credentials when auth is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const [missing, bad, good] = await Promise.all([
      app({ password: "secret" }).request(fileUrl(), {
        headers: { "x-codeplane-directory": tmp.path },
      }),
      app({ password: "secret" }).request(fileUrl(), {
        headers: {
          authorization: authorization("codeplane", "wrong"),
          "x-codeplane-directory": tmp.path,
        },
      }),
      app({ password: "secret" }).request(fileUrl(), {
        headers: {
          authorization: authorization("codeplane", "secret"),
          "x-codeplane-directory": tmp.path,
        },
      }),
    ])

    expect(missing.status).toBe(401)
    expect(bad.status).toBe(401)
    expect(good.status).toBe(200)
  })

  // Regression: `auth_token` query credentials are NO LONGER accepted on
  // plain HTTP requests. Allowing them leaked secrets through server logs,
  // browser history, Referer headers and intermediate proxy caches.
  // WebSocket upgrade requests are the only path that still rewrites the
  // query into the Authorization header — see src/server/middleware.ts and
  // packages/app/src/components/terminal.tsx for the legitimate caller.
  test("rejects auth_token query credentials on HTTP requests", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const response = await app({ password: "secret-password-strong" }).request(
      fileUrl({ token: Buffer.from("codeplane:secret-password-strong").toString("base64") }),
      {
        headers: {
          "x-codeplane-directory": tmp.path,
        },
      },
    )

    expect(response.status).toBe(401)
  })

  test("selects instance from query before directory header", async () => {
    await using header = await tmpdir({ git: true })
    await using query = await tmpdir({ git: true })
    await Bun.write(`${header.path}/hello.txt`, "header")
    await Bun.write(`${query.path}/hello.txt`, "query")

    const response = await app().request(fileUrl({ directory: query.path }), {
      headers: {
        "x-codeplane-directory": header.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: "query" })
  })
})
