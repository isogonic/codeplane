import { expect, test } from "@playwright/test"
import http from "node:http"

const backendOrigin = "http://127.0.0.1:4096"
const serverStoreKey = "codeplane.global.dat:server"

function checksum(content: string) {
  if (!content) return
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function storageToken(value: string, fallbackName: string) {
  const head = (value.slice(0, 18) || fallbackName).replace(/[^a-zA-Z0-9._-]/g, "-")
  return `${head}.${checksum(value) ?? "0"}`
}

function serverStorage(scope: string) {
  return `codeplane.server.${storageToken(scope, "server")}.dat`
}

function cors(response: http.ServerResponse, extra?: Record<string, string>) {
  response.setHeader("Access-Control-Allow-Origin", "*")
  response.setHeader("Access-Control-Allow-Headers", "content-type")
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  for (const [key, value] of Object.entries(extra ?? {})) {
    response.setHeader(key, value)
  }
}

function json(response: http.ServerResponse, body: unknown, statusCode = 200) {
  cors(response, { "Content-Type": "application/json; charset=utf-8" })
  response.writeHead(statusCode)
  response.end(`${JSON.stringify(body)}\n`)
}

function ssePayload(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`
}

const provider = {
  id: "logicplanes",
  name: "Logicplanes",
  source: "config" as const,
  env: [] as string[],
  options: {},
  models: {},
}

const project = {
  id: "workspace",
  name: "workspace",
  worktree: "/workspace",
  vcs: "git" as const,
  time: { created: 0, updated: 0 },
  sandboxes: [] as string[],
}

type PathMode = "valid" | "transient-error" | "missing"

test.describe.configure({ mode: "serial" })

test.describe("persisted projects across reconnect validation", () => {
  let server: http.Server | undefined
  let pathMode: PathMode = "valid"
  let projectPathChecks = 0
  let transientFailures = 0
  const streams = new Set<http.ServerResponse>()

  test.beforeAll(async () => {
    server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", backendOrigin)

      if (request.method === "OPTIONS") {
        cors(response)
        response.writeHead(204)
        response.end()
        return
      }

      if (url.pathname === "/global/health") {
        json(response, { healthy: true, version: "27.4.0" })
        return
      }

      if (url.pathname === "/global/config") {
        json(response, {})
        return
      }

      if (url.pathname === "/global/event") {
        cors(response, {
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream",
        })
        response.writeHead(200)
        response.write(ssePayload({ payload: { type: "server.connected", properties: {} } }))
        const heartbeat = setInterval(() => {
          response.write(ssePayload({ payload: { type: "server.heartbeat", properties: {} } }))
        }, 1000)
        streams.add(response)
        request.on("close", () => {
          clearInterval(heartbeat)
          streams.delete(response)
        })
        return
      }

      if (url.pathname === "/provider") {
        json(response, { all: [provider], catalog: [provider], connected: [], default: {} })
        return
      }

      if (url.pathname === "/project") {
        json(response, [project])
        return
      }

      if (url.pathname === "/path") {
        const directory = url.searchParams.get("directory")
        if (!directory) {
          json(response, {
            home: "/Users/test",
            state: "/Users/test/.codeplane/state",
            config: "/Users/test/.config/codeplane/config.json",
            worktree: "/Users/test",
            directory: "/Users/test",
          })
          return
        }

        projectPathChecks += 1

        if (pathMode === "missing") {
          json(response, { name: "NotFoundError", data: { message: `Missing project: ${directory}` } }, 404)
          return
        }

        if (pathMode === "transient-error" && transientFailures === 0) {
          transientFailures += 1
          json(response, { message: "temporary unavailable" }, 503)
          return
        }

        json(response, {
          home: "/Users/test",
          state: "/Users/test/.codeplane/state",
          config: "/Users/test/.config/codeplane/config.json",
          worktree: directory,
          directory,
        })
        return
      }

      json(response, { message: "not found" }, 404)
    })

    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject)
      server?.listen(4096, "127.0.0.1", resolve)
    })
  })

  test.afterAll(async () => {
    for (const stream of streams) {
      stream.end()
    }
    streams.clear()
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()))
    })
  })

  test.beforeEach(() => {
    pathMode = "valid"
    projectPathChecks = 0
    transientFailures = 0
  })

  test("keeps restored open projects when validation hits a transient reconnect error", async ({ page }) => {
    pathMode = "transient-error"

    await page.addInitScript(
      ({ key, scope, storage }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            list: [],
            projects: {
              [scope]: [{ worktree: "/workspace", expanded: true }],
            },
            lastProject: {
              [scope]: "/workspace",
            },
          }),
        )
        localStorage.removeItem(`${storage}:layout`)
      },
      {
        key: serverStoreKey,
        scope: backendOrigin,
        storage: serverStorage(backendOrigin),
      },
    )

    await page.goto("/")

    await expect.poll(() => projectPathChecks, { message: "project validation should run against the backend" }).toBe(1)
    await expect(page.getByRole("button", { name: /workspace/i }).first()).toBeVisible()
    await expect(page.getByText("No projects open")).toHaveCount(0)

    await expect
      .poll(
        () =>
          page.evaluate(({ key, scope }) => {
            const raw = localStorage.getItem(key)
            const parsed = raw ? JSON.parse(raw) : {}
            return parsed.projects?.[scope]?.map((item: { worktree: string }) => item.worktree) ?? []
          }, { key: serverStoreKey, scope: backendOrigin }),
        {
          message: "persisted desktop project list should survive transient reconnect failures",
        },
      )
      .toEqual(["/workspace"])
  })

  test("removes restored open projects when the backend reports them missing", async ({ page }) => {
    pathMode = "missing"

    await page.addInitScript(
      ({ key, scope }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            list: [],
            projects: {
              [scope]: [{ worktree: "/workspace", expanded: true }],
            },
            lastProject: {
              [scope]: "/workspace",
            },
          }),
        )
      },
      {
        key: serverStoreKey,
        scope: backendOrigin,
      },
    )

    await page.goto("/")

    await expect.poll(() => projectPathChecks, { message: "missing-project validation should run against the backend" }).toBe(1)
    await expect
      .poll(
        () =>
          page.evaluate(({ key, scope }) => {
            const raw = localStorage.getItem(key)
            const parsed = raw ? JSON.parse(raw) : {}
            return parsed.projects?.[scope]?.length ?? 0
          }, { key: serverStoreKey, scope: backendOrigin }),
        {
          message: "missing projects should still be removed from persisted state",
        },
      )
      .toBe(0)
  })
})
