import { expect, test, type Page } from "@playwright/test"
import type { Event, Message, Part, Project, Session, SessionStatus } from "@codeplane-ai/sdk/v2/client"
import http from "node:http"

const backendPort = Number(process.env.PLAYWRIGHT_SERVER_PORT ?? "4096")
const backendOrigin = `http://127.0.0.1:${backendPort}`
const serverStoreKey = "codeplane.global.dat:server"
const directory = "/workspace"
const sessionDirectory = `${directory}/packages/app`
const sessionID = "ses_live_stream"
const otherSessionID = "ses_other_stream"
const userMessageID = "msg_0001_user_live_stream"
const assistantMessageID = "msg_0002_assistant_live_stream"
const otherMessageID = "msg_0003_other_stream"
const userPartID = "prt_0001_user_live_stream"
const assistantPartID = "prt_0002_assistant_live_stream"
const otherPartID = "prt_0003_other_stream"
const userPrompt = "Stream this reply live"
const otherPrompt = "Keep this other session visible"

function checksum(content: string): string | undefined {
  if (!content) return undefined
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

function slug(value: string) {
  return Buffer.from(value, "utf8").toString("base64url")
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
  worktree: directory,
  vcs: "git" as const,
  time: { created: 0, updated: 0 },
  sandboxes: [] as string[],
} satisfies Project

type PathMode = "valid" | "transient-error" | "missing"
type SessionMessagePageItem = { info: Message; parts: Part[] }

function sessionInfo(created = Date.now() - 1_000): Session {
  return {
    id: sessionID,
    slug: sessionID,
    projectID: project.id,
    directory: sessionDirectory,
    title: "Live stream session",
    version: "29.0.4",
    time: { created, updated: created + 1 },
  }
}

function otherSessionInfo(created = Date.now() - 1_500): Session {
  return {
    id: otherSessionID,
    slug: otherSessionID,
    projectID: project.id,
    directory,
    title: "Other session",
    version: "29.0.4",
    time: { created, updated: created + 1 },
  }
}

function userMessage(created = Date.now() - 900): Message {
  return {
    id: userMessageID,
    sessionID,
    role: "user",
    time: { created },
    agent: "build",
    model: { providerID: "logicplanes", modelID: "logic-large" },
  }
}

function otherMessage(created = Date.now() - 1_400): Message {
  return {
    id: otherMessageID,
    sessionID: otherSessionID,
    role: "user",
    time: { created },
    agent: "build",
    model: { providerID: "logicplanes", modelID: "logic-large" },
  }
}

function assistantMessage(created = Date.now() - 800, completed?: number): Message {
  return {
    id: assistantMessageID,
    sessionID,
    role: "assistant",
    parentID: userMessageID,
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    providerID: "logicplanes",
    modelID: "logic-large",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: completed ? { created, completed } : { created },
  }
}

function textPart(id: string, messageID: string, text: string, ownerSessionID = sessionID): Part {
  return {
    id,
    sessionID: ownerSessionID,
    messageID,
    type: "text",
    text,
  }
}

function initialState() {
  const now = Date.now()
  return {
    session: sessionInfo(now - 1_000),
    otherSession: otherSessionInfo(now - 1_500),
    messages: [
      {
        info: userMessage(now - 900),
        parts: [textPart(userPartID, userMessageID, userPrompt)],
      },
      {
        info: assistantMessage(now - 800),
        parts: [textPart(assistantPartID, assistantMessageID, "")],
      },
    ] satisfies SessionMessagePageItem[],
    otherMessages: [
      {
        info: otherMessage(now - 1_400),
        parts: [textPart(otherPartID, otherMessageID, otherPrompt, otherSessionID)],
      },
    ] satisfies SessionMessagePageItem[],
    sessionStatus: {
      [sessionID]: { type: "busy" as const },
      [otherSessionID]: { type: "idle" as const },
    } satisfies Record<string, SessionStatus>,
  }
}

test.describe.configure({ mode: "serial" })

test.describe("persisted projects and live stream validation", () => {
  let server: http.Server | undefined
  let pathMode: PathMode = "valid"
  let projectPathChecks = 0
  let transientFailures = 0
  let state = initialState()
  const streams = new Set<http.ServerResponse>()

  const assistantEntry = () => {
    const match = state.messages.find((item) => item.info.id === assistantMessageID)
    if (!match) throw new Error("Missing assistant message fixture")
    return match
  }

  const assistantText = () => {
    const part = assistantEntry().parts.find((item) => item.id === assistantPartID)
    if (!part || part.type !== "text") throw new Error("Missing assistant text part fixture")
    return part
  }

  const emit = (event: { directory?: string; payload: Event }) => {
    for (const stream of streams) {
      stream.write(ssePayload(event))
    }
  }

  const emitMany = (events: Array<{ directory?: string; payload: Event }>) => {
    for (const event of events) {
      emit(event)
    }
  }

  const appendAssistantDelta = (delta: string) => {
    assistantText().text += delta
    emit({
      directory: sessionDirectory,
      payload: {
        type: "message.part.delta",
        properties: {
          sessionID,
          messageID: assistantMessageID,
          partID: assistantPartID,
          field: "text",
          delta,
        },
      } satisfies Event,
    })
  }

  const finishAssistant = (text: string, completed = Date.now()) => {
    assistantText().text = text
    assistantEntry().info = assistantMessage(completed - 500, completed)
    state.session.time.updated = completed
    state.sessionStatus[sessionID] = { type: "idle" }
    emitMany([
      {
        directory: sessionDirectory,
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID,
            part: { ...assistantText() },
            time: completed,
          },
        } satisfies Event,
      },
      {
        directory: sessionDirectory,
        payload: {
          type: "message.updated",
          properties: {
            info: state.messages[1].info,
          },
        } satisfies Event,
      },
      {
        directory: sessionDirectory,
        payload: {
          type: "session.status",
          properties: {
            sessionID,
            status: { type: "idle" as const },
          },
        } satisfies Event,
      },
    ])
  }

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
        json(response, { healthy: true, version: "29.0.4" })
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

      if (url.pathname === "/provider/auth") {
        json(response, {})
        return
      }

      if (url.pathname === "/project/current") {
        json(response, project)
        return
      }

      if (url.pathname === "/project") {
        json(response, [project])
        return
      }

      if (url.pathname === "/path") {
        const requestedDirectory = url.searchParams.get("directory")
        if (!requestedDirectory) {
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
          json(response, { name: "NotFoundError", data: { message: `Missing project: ${requestedDirectory}` } }, 404)
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
          worktree: requestedDirectory,
          directory: requestedDirectory,
        })
        return
      }

      if (url.pathname === "/lsp") {
        json(response, [])
        return
      }

      if (url.pathname === "/mcp") {
        json(response, {})
        return
      }

      if (url.pathname === "/agent") {
        json(response, [])
        return
      }

      if (url.pathname === "/config") {
        json(response, {})
        return
      }

      if (url.pathname === "/vcs") {
        json(response, null)
        return
      }

      if (url.pathname === "/command") {
        json(response, [])
        return
      }

      if (url.pathname === "/permission") {
        json(response, [])
        return
      }

      if (url.pathname === "/question") {
        json(response, [])
        return
      }

      if (url.pathname === "/session/status") {
        json(response, state.sessionStatus)
        return
      }

      if (url.pathname === "/session") {
        json(response, [state.session, state.otherSession])
        return
      }

      const sessionChildrenMatch = url.pathname.match(/^\/session\/([^/]+)\/children$/)
      if (sessionChildrenMatch?.[1] === sessionID || sessionChildrenMatch?.[1] === otherSessionID) {
        json(response, [])
        return
      }

      const sessionTodoMatch = url.pathname.match(/^\/session\/([^/]+)\/todo$/)
      if (sessionTodoMatch?.[1] === sessionID || sessionTodoMatch?.[1] === otherSessionID) {
        json(response, [])
        return
      }

      const sessionMessagesMatch = url.pathname.match(/^\/session\/([^/]+)\/message$/)
      if (sessionMessagesMatch?.[1] === sessionID) {
        json(response, state.messages)
        return
      }
      if (sessionMessagesMatch?.[1] === otherSessionID) {
        json(response, state.otherMessages)
        return
      }

      const sessionMatch = url.pathname.match(/^\/session\/([^/]+)$/)
      if (sessionMatch?.[1] === sessionID) {
        json(response, state.session)
        return
      }
      if (sessionMatch?.[1] === otherSessionID) {
        json(response, state.otherSession)
        return
      }

      json(response, { message: "not found" }, 404)
    })

    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject)
      server?.listen(backendPort, "127.0.0.1", resolve)
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
    state = initialState()
  })

  test("keeps restored open projects when validation hits a transient reconnect error", async ({ page }) => {
    pathMode = "transient-error"

    await page.addInitScript(
      ({ key, scope, storage, worktree }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            list: [],
            projects: {
              [scope]: [{ worktree, expanded: true }],
            },
            lastProject: {
              [scope]: worktree,
            },
          }),
        )
        localStorage.removeItem(`${storage}:layout`)
      },
      {
        key: serverStoreKey,
        scope: backendOrigin,
        storage: serverStorage(backendOrigin),
        worktree: directory,
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
      .toEqual([directory])
  })

  test("removes restored open projects when the backend reports them missing", async ({ page }) => {
    pathMode = "missing"

    await page.addInitScript(
      ({ key, scope, worktree }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            list: [],
            projects: {
              [scope]: [{ worktree, expanded: true }],
            },
            lastProject: {
              [scope]: worktree,
            },
          }),
        )
      },
      {
        key: serverStoreKey,
        scope: backendOrigin,
        worktree: directory,
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

  async function openStreamSession(page: Page) {
    await page.goto(`/${slug(directory)}/session/${sessionID}`)
    await expect(page.getByText(userPrompt)).toBeVisible()
    await expect(page.locator("[data-slot='session-turn-thinking']")).toBeVisible()
  }

  test("streams assistant deltas live and clears thinking when the turn completes", async ({ page }) => {
    await openStreamSession(page)

    assistantText().text = "Hello"
    emit({
      directory: sessionDirectory,
      payload: {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: { ...textPart(assistantPartID, assistantMessageID, "Hel") },
          time: Date.now(),
        },
      } satisfies Event,
    })
    appendAssistantDelta("lo")

    finishAssistant("Hello")

    await expect(page.locator("[data-slot='session-turn-thinking']")).toHaveCount(0)
    await expect(page.getByText("Hello", { exact: true })).toBeVisible()
  })

  test("keeps nested-directory live streams current while switching sessions", async ({ page }) => {
    await openStreamSession(page)

    await page.goto(`/${slug(directory)}/session/${otherSessionID}`)
    await expect(page.getByText(otherPrompt)).toBeVisible()

    appendAssistantDelta("still ")
    appendAssistantDelta("running")
    finishAssistant("still running")

    await page.goto(`/${slug(directory)}/session/${sessionID}`)

    await expect(page.locator("[data-slot='session-turn-thinking']")).toHaveCount(0)
    await expect(page.getByText("still running", { exact: true })).toBeVisible()
  })

  test("keeps later tail deltas after a full part refresh in the same stream burst", async ({ page }) => {
    await openStreamSession(page)

    assistantText().text = "fresh tail"
    emitMany([
      {
        directory: sessionDirectory,
        payload: {
          type: "message.part.delta",
          properties: {
            sessionID,
            messageID: assistantMessageID,
            partID: assistantPartID,
            field: "text",
            delta: " stale",
          },
        } satisfies Event,
      },
      {
        directory: sessionDirectory,
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID,
            part: { ...textPart(assistantPartID, assistantMessageID, "fresh") },
            time: 1,
          },
        } satisfies Event,
      },
      {
        directory: sessionDirectory,
        payload: {
          type: "message.part.delta",
          properties: {
            sessionID,
            messageID: assistantMessageID,
            partID: assistantPartID,
            field: "text",
            delta: " tail",
          },
        } satisfies Event,
      },
    ])

    finishAssistant("fresh tail")

    await expect(page.locator("[data-slot='session-turn-thinking']")).toHaveCount(0)
    await expect(page.getByText("fresh tail", { exact: true })).toBeVisible()
  })

  test("does not replay stale deltas after a newer full part refresh", async ({ page }) => {
    await openStreamSession(page)

    assistantText().text = "fresh"
    emitMany([
      {
        directory: sessionDirectory,
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID,
            part: { ...textPart(assistantPartID, assistantMessageID, "old") },
            time: 1,
          },
        } satisfies Event,
      },
      {
        directory: sessionDirectory,
        payload: {
          type: "message.part.delta",
          properties: {
            sessionID,
            messageID: assistantMessageID,
            partID: assistantPartID,
            field: "text",
            delta: " stale",
          },
        } satisfies Event,
      },
      {
        directory: sessionDirectory,
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID,
            part: { ...textPart(assistantPartID, assistantMessageID, "fresh") },
            time: 2,
          },
        } satisfies Event,
      },
    ])

    finishAssistant("fresh")

    await expect(page.locator("[data-slot='session-turn-thinking']")).toHaveCount(0)
    await expect(page.getByText("fresh", { exact: true })).toBeVisible()
    await expect(page.getByText("fresh stale", { exact: true })).toHaveCount(0)
  })
})
