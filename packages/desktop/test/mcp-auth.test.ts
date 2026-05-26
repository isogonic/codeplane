import { describe, expect, test } from "bun:test"
import type { Session } from "electron"
import {
  createDesktopMcpOAuthManager,
  fetchAutoConnectMcpOAuthLaunches,
  isMcpOAuthRedirect,
  type DesktopMcpOAuthLaunch,
} from "../src/main/mcp-auth"

class FakeWindow {
  static all: FakeWindow[] = []
  readonly closedHandlers: Array<() => void> = []
  readonly listeners = {
    "did-navigate": [] as Array<(...args: unknown[]) => void>,
    "did-navigate-in-page": [] as Array<(...args: unknown[]) => void>,
  }
  destroyed = false
  focusCount = 0
  loadedUrl: string | undefined
  options: unknown
  loadError: Error | undefined

  constructor(options: unknown) {
    this.options = options
    FakeWindow.all.push(this)
  }

  webContents = {
    on: (event: "did-navigate" | "did-navigate-in-page", listener: (...args: unknown[]) => void) => {
      this.listeners[event].push(listener)
    },
  }

  close() {
    if (this.destroyed) return
    this.destroyed = true
    for (const listener of this.closedHandlers) listener()
  }

  focus() {
    this.focusCount++
  }

  isDestroyed() {
    return this.destroyed
  }

  on(event: "closed", listener: () => void) {
    this.closedHandlers.push(listener)
  }

  async loadURL(url: string) {
    this.loadedUrl = url
    if (this.loadError) throw this.loadError
  }

  emit(event: "did-navigate" | "did-navigate-in-page", ...args: unknown[]) {
    for (const listener of this.listeners[event]) listener(...args)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("mcp-auth desktop helper", () => {
  test("matches the OAuth callback redirect by origin and path", () => {
    expect(
      isMcpOAuthRedirect(
        "http://127.0.0.1:19876/mcp/oauth/callback?code=demo&state=abc",
        "http://127.0.0.1:19876/mcp/oauth/callback",
      ),
    ).toBe(true)
    expect(
      isMcpOAuthRedirect(
        "http://127.0.0.1:19876/mcp/oauth/callback/?code=demo",
        "http://127.0.0.1:19876/mcp/oauth/callback",
      ),
    ).toBe(true)
    expect(
      isMcpOAuthRedirect("http://127.0.0.1:19876/other/callback?code=demo", "http://127.0.0.1:19876/mcp/oauth/callback"),
    ).toBe(false)
  })

  test("parses only valid auto-connect MCP OAuth launches", async () => {
    const launches = await fetchAutoConnectMcpOAuthLaunches({
      baseUrl: "https://instance.example.com/",
      fetchFn: (async () =>
        new Response(
          JSON.stringify([
            { name: "one", authorizationUrl: "https://auth.example.com/one", redirectUri: "http://127.0.0.1/callback" },
            { name: "bad", authorizationUrl: 1, redirectUri: "x" },
            null,
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )) as typeof fetch,
    })

    expect(launches).toEqual([
      {
        name: "one",
        authorizationUrl: "https://auth.example.com/one",
        redirectUri: "http://127.0.0.1/callback",
      },
    ])
  })

  test("reuses the existing window for the same instance and MCP server", async () => {
    FakeWindow.all.length = 0
    const logs: string[] = []
    const manager = createDesktopMcpOAuthManager({
      BrowserWindow: FakeWindow as never,
      log: (event) => logs.push(event),
    })
    const session = {} as Session
    const launch: DesktopMcpOAuthLaunch = {
      name: "github",
      authorizationUrl: "https://auth.example.com/github",
      redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
    }

    await manager.open({ id: "instance-a" }, session, launch)
    await manager.open({ id: "instance-a" }, session, launch)

    expect(FakeWindow.all).toHaveLength(1)
    expect(FakeWindow.all[0].focusCount).toBe(1)
    expect(logs).toContain("mcp.oauth.window.focus-existing")
  })

  test("keeps separate windows for different servers and instances", async () => {
    FakeWindow.all.length = 0
    const manager = createDesktopMcpOAuthManager({
      BrowserWindow: FakeWindow as never,
      log: () => {},
    })
    const session = {} as Session

    await manager.open(
      { id: "instance-a" },
      session,
      {
        name: "github",
        authorizationUrl: "https://auth.example.com/github",
        redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
      },
    )
    await manager.open(
      { id: "instance-a" },
      session,
      {
        name: "jira",
        authorizationUrl: "https://auth.example.com/jira",
        redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
      },
    )
    await manager.open(
      { id: "instance-b" },
      session,
      {
        name: "github",
        authorizationUrl: "https://auth.example.com/github-2",
        redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
      },
    )

    expect(FakeWindow.all).toHaveLength(3)
    expect(manager.size()).toBe(3)
  })

  test("closes and cleans up a window after the OAuth callback redirect lands", async () => {
    FakeWindow.all.length = 0
    const manager = createDesktopMcpOAuthManager({
      BrowserWindow: FakeWindow as never,
      log: () => {},
    })
    const session = {} as Session

    await manager.open(
      { id: "instance-a" },
      session,
      {
        name: "github",
        authorizationUrl: "https://auth.example.com/github",
        redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
      },
    )

    expect(manager.size()).toBe(1)
    FakeWindow.all[0].emit(
      "did-navigate",
      undefined,
      "http://127.0.0.1:19876/mcp/oauth/callback?code=demo&state=state",
    )
    await sleep(350)
    expect(FakeWindow.all[0].destroyed).toBe(true)
    expect(manager.size()).toBe(0)
  })
})
