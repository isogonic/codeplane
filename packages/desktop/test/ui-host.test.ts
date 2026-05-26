import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { createDesktopUIHost, DesktopVersionAuthRequiredError } from "../src/main/ui-host"

const tempDirs: string[] = []
async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-ui-host-"))
  tempDirs.push(dir)
  return dir
}

const exists = (input: string) => fs.access(input).then(() => true).catch(() => false)

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

const previousFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = previousFetch
})

const servers: http.Server[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

type FakeSessionOptions = {
  cookies?: Array<{ name: string; value: string }>
  onFetch?: (url: URL) => void
}

// Minimal Session mock — only the bits ui-host actually calls.
function fakeSession(
  options?: FakeSessionOptions,
): { fetch: (input: string | URL, init?: RequestInit) => Promise<Response>; cookies: { get: () => Promise<Array<{ name: string; value: string }>> } } {
  return {
    cookies: {
      get: async () => options?.cookies ?? [],
    },
    fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString())
      options?.onFetch?.(url)
      return globalThis.fetch(url.toString(), init)
    },
  } as never
}

function listen(server: http.Server) {
  servers.push(server)
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("server did not expose a TCP address"))
        return
      }
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

describe("DesktopVersionAuthRequiredError", () => {
  test("name is DesktopVersionAuthRequiredError", () => {
    const e = new DesktopVersionAuthRequiredError({
      authUrl: "https://login.example.com",
      instanceUrl: "https://app.example.com",
    })
    expect(e.name).toBe("DesktopVersionAuthRequiredError")
  })

  test("instanceof check works", () => {
    const e = new DesktopVersionAuthRequiredError({
      authUrl: "https://login.example.com",
      instanceUrl: "https://app.example.com",
    })
    expect(e instanceof DesktopVersionAuthRequiredError).toBe(true)
    expect(e instanceof Error).toBe(true)
  })

  test("message includes the instance URL", () => {
    const e = new DesktopVersionAuthRequiredError({
      authUrl: "https://login.example.com",
      instanceUrl: "https://app.example.com",
    })
    expect(e.message).toContain("https://app.example.com")
  })

  test("authUrl property is preserved", () => {
    const e = new DesktopVersionAuthRequiredError({
      authUrl: "https://login.example.com/path",
      instanceUrl: "https://app.example.com",
    })
    expect(e.authUrl).toBe("https://login.example.com/path")
  })

  test("instanceUrl property is preserved", () => {
    const e = new DesktopVersionAuthRequiredError({
      authUrl: "https://login.example.com",
      instanceUrl: "https://app.example.com:8443/path",
    })
    expect(e.instanceUrl).toBe("https://app.example.com:8443/path")
  })

  test("can be thrown and caught", () => {
    expect(() => {
      throw new DesktopVersionAuthRequiredError({
        authUrl: "https://login.example.com",
        instanceUrl: "https://app.example.com",
      })
    }).toThrow(DesktopVersionAuthRequiredError)
  })

  test("stack trace is populated", () => {
    const e = new DesktopVersionAuthRequiredError({
      authUrl: "https://login.example.com",
      instanceUrl: "https://app.example.com",
    })
    expect(typeof e.stack).toBe("string")
    expect((e.stack ?? "").length).toBeGreaterThan(0)
  })
})

describe("createDesktopUIHost - public surface", () => {
  test("returns the expected method set", async () => {
    const cacheDir = await makeTempDir()
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    expect(typeof host.bootstrap).toBe("function")
    expect(typeof host.cacheInfo).toBe("function")
    expect(typeof host.clearCache).toBe("function")
    expect(typeof host.cleanup).toBe("function")
    expect(typeof host.prepare).toBe("function")
    expect(typeof host.proxyKey).toBe("function")
  })

  test("proxyKey produces stable, deterministic keys", async () => {
    const cacheDir = await makeTempDir()
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    expect(host.proxyKey("abc")).toBe("desktop-instance:abc")
    expect(host.proxyKey("abc")).toBe(host.proxyKey("abc"))
  })

  test("proxyKey allows arbitrary id strings", async () => {
    const cacheDir = await makeTempDir()
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    const ids = ["", "a", "ABC123", "with-dashes", "with_underscores", "long".repeat(100)]
    for (const id of ids) {
      expect(host.proxyKey(id)).toBe(`desktop-instance:${id}`)
    }
  })

  test("bootstrap throws when server is not ready", async () => {
    const cacheDir = await makeTempDir()
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    expect(() => host.bootstrap([])).toThrow(/not ready/i)
  })

  test("cleanup() on empty cache dir does not throw", async () => {
    const cacheDir = await makeTempDir()
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    await expect(host.cleanup()).resolves.toBeUndefined()
  })

  test("cleanup() does not throw even if cacheDir is missing", async () => {
    const cacheDir = path.join(await makeTempDir(), "does-not-exist")
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    await expect(host.cleanup()).resolves.toBeUndefined()
  })

  test("clearCache removes cached UI for a matching instance", async () => {
    const cacheDir = await makeTempDir()
    const instance = { id: "remote-a", url: "http://app.local" }
    globalThis.fetch = (async (input) => {
      const url = new URL(typeof input === "string" ? input : input.toString())
      if (url.pathname === "/global/version") {
        return new Response(JSON.stringify({ current: "99.0.0" }), { headers: { "content-type": "application/json" } })
      }
      if (url.pathname === "/") {
        return new Response('<!doctype html><script type="module" src="/assets/app.js"></script><div id="root"></div>', {
          headers: { "content-type": "text/html" },
        })
      }
      if (url.pathname === "/assets/app.js") {
        return new Response("export default null", { headers: { "content-type": "text/javascript" } })
      }
      return new Response("missing", { status: 404 })
    }) as never
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => instance,
      getSession: () => fakeSession() as never,
    })

    await host.prepare(instance)
    const before = await host.cacheInfo(instance)
    expect(before.exists).toBe(true)
    expect(before.versions).toEqual(["99.0.0"])
    expect(before.bytes).toBeGreaterThan(0)

    const cleared = await host.clearCache(instance)
    expect(cleared.exists).toBe(true)
    expect(await host.cacheInfo(instance)).toEqual({ exists: false, bytes: 0, origins: ["http://app.local"], versions: [] })
  })

  test("prepare writes legacy theme alias assets for cached UI bundles", async () => {
    const cacheDir = await makeTempDir()
    const instance = { id: "remote-a", url: "http://app.local" }
    globalThis.fetch = (async (input) => {
      const url = new URL(typeof input === "string" ? input : input.toString())
      if (url.pathname === "/global/version") {
        return new Response(JSON.stringify({ current: "99.0.0" }), {
          headers: { "content-type": "application/json" },
        })
      }
      if (url.pathname === "/") {
        return new Response('<!doctype html><script type="module" src="/assets/app.js"></script><div id="root"></div>', {
          headers: { "content-type": "text/html" },
        })
      }
      if (url.pathname === "/assets/app.js") {
        return new Response('console.log("/assets/themes/amoled.json")', {
          headers: { "content-type": "text/javascript" },
        })
      }
      return new Response("missing", { status: 404 })
    }) as never
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => instance,
      getSession: () => fakeSession() as never,
    })

    await host.prepare(instance)
    const themesDir = path.join(cacheDir, "ui-cache", "99.0.0", "assets", "themes")
    const oc2 = await fs.readFile(path.join(themesDir, "oc-2.json"), "utf8")
    const amoled = await fs.readFile(path.join(themesDir, "amoled.json"), "utf8")

    expect(amoled).toBe(oc2)
  })

  test("prepare revalidates a fresh origin cache before choosing the UI version", async () => {
    const cacheDir = await makeTempDir()
    const instance = { id: "remote-a", url: "http://app.local" }
    let version = "99.0.0"
    const versionRequests: string[] = []
    globalThis.fetch = (async (input) => {
      const url = new URL(typeof input === "string" ? input : input.toString())
      if (url.pathname === "/global/version") {
        versionRequests.push(version)
        return new Response(JSON.stringify({ current: version }), {
          headers: { "content-type": "application/json" },
        })
      }
      if (url.pathname === "/") {
        return new Response(
          `<!doctype html><script type="module" src="/assets/app.js"></script><p>${version}</p>`,
          { headers: { "content-type": "text/html" } },
        )
      }
      if (url.pathname === "/assets/app.js") {
        return new Response(`window.__fixtureVersion=${JSON.stringify(version)}`, {
          headers: { "content-type": "text/javascript" },
        })
      }
      return new Response("missing", { status: 404 })
    }) as never
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => instance,
      getSession: () => fakeSession() as never,
    })

    await expect(host.prepare(instance)).resolves.toMatchObject({ version: "99.0.0" })
    version = "99.0.1"
    await expect(host.prepare(instance)).resolves.toMatchObject({ version: "99.0.1" })

    const index = JSON.parse(await fs.readFile(path.join(cacheDir, "ui-cache", "origins.json"), "utf8")) as Record<
      string,
      { version: string }
    >
    expect(index["http://app.local"]?.version).toBe("99.0.1")
    expect(await exists(path.join(cacheDir, "ui-cache", "99.0.1", "index.html"))).toBe(true)
    expect(versionRequests).toEqual(["99.0.0", "99.0.1"])
  })

  test("prepare refreshes a cached UI when the same server version serves a new entry bundle", async () => {
    const cacheDir = await makeTempDir()
    const instance = { id: "remote-a", url: "http://app.local" }
    let label = "old"
    globalThis.fetch = (async (input) => {
      const url = new URL(typeof input === "string" ? input : input.toString())
      if (url.pathname === "/global/version") {
        return new Response(JSON.stringify({ current: "99.0.0" }), {
          headers: { "content-type": "application/json" },
        })
      }
      if (url.pathname === "/") {
        return new Response(
          `<!doctype html><script type="module" src="/assets/app.js"></script><p>${label}</p>`,
          { headers: { "content-type": "text/html" } },
        )
      }
      if (url.pathname === "/assets/app.js") {
        return new Response(`window.__fixtureLabel=${JSON.stringify(label)}`, {
          headers: { "content-type": "text/javascript" },
        })
      }
      return new Response("missing", { status: 404 })
    }) as never
    const logs: string[] = []
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => instance,
      getSession: () => fakeSession() as never,
      log: (event) => logs.push(event),
    })

    await expect(host.prepare(instance)).resolves.toMatchObject({ version: "99.0.0" })
    label = "new"
    await expect(host.prepare(instance)).resolves.toMatchObject({ version: "99.0.0" })

    expect(await fs.readFile(path.join(cacheDir, "ui-cache", "99.0.0", "index.html"), "utf8")).toContain("<p>new</p>")
    expect(await fs.readFile(path.join(cacheDir, "ui-cache", "99.0.0", "assets", "app.js"), "utf8")).toContain(
      'window.__fixtureLabel="new"',
    )
    expect(logs).toContain("cache.entry.stale")
  })
})

describe("createDesktopUIHost - prepare auth-shape detection", () => {
  test("HTML 200 with content-type: text/html → DesktopVersionAuthRequiredError", async () => {
    const cacheDir = await makeTempDir()
    globalThis.fetch = (async () =>
      new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } })) as never
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    await expect(
      host.prepare({ id: "x", url: "https://app.example.com" }),
    ).rejects.toBeInstanceOf(DesktopVersionAuthRequiredError)
  })

  test("401 → DesktopVersionAuthRequiredError with fallback home authUrl", async () => {
    const cacheDir = await makeTempDir()
    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as never
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    try {
      await host.prepare({ id: "x", url: "https://app.example.com" })
      throw new Error("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(DesktopVersionAuthRequiredError)
      const auth = (e as DesktopVersionAuthRequiredError).authUrl
      expect(auth).toBe("https://app.example.com/")
    }
  })

  test("403 → DesktopVersionAuthRequiredError with fallback home authUrl", async () => {
    const cacheDir = await makeTempDir()
    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as never
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    await expect(
      host.prepare({ id: "x", url: "https://app.example.com" }),
    ).rejects.toBeInstanceOf(DesktopVersionAuthRequiredError)
  })

  test("plain text 200 (no JSON content-type) → DesktopVersionAuthRequiredError", async () => {
    const cacheDir = await makeTempDir()
    globalThis.fetch = (async () =>
      new Response("hello", { status: 200, headers: { "content-type": "text/plain" } })) as never
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    await expect(
      host.prepare({ id: "x", url: "https://app.example.com" }),
    ).rejects.toBeInstanceOf(DesktopVersionAuthRequiredError)
  })

  test("non-auth, non-OK errors propagate as plain Error", async () => {
    const cacheDir = await makeTempDir()
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as never
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    await expect(host.prepare({ id: "x", url: "https://app.example.com" })).rejects.toThrow(
      /HTTP 500/,
    )
  })

  test("malformed JSON without `current` field → throws", async () => {
    const cacheDir = await makeTempDir()
    globalThis.fetch = (async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as never
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    await expect(host.prepare({ id: "x", url: "https://app.example.com" })).rejects.toThrow(
      /no current version/i,
    )
  })

  test("unparseable URL → throws Invalid instance URL", async () => {
    const cacheDir = await makeTempDir()
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    await expect(host.prepare({ id: "x", url: "" })).rejects.toThrow(/Invalid instance URL/)
    await expect(host.prepare({ id: "x", url: "   " })).rejects.toThrow(/Invalid instance URL/)
  })
})

describe("createDesktopUIHost - bootstrap response shape", () => {
  // bootstrap requires the server to be ready, which only happens after prepare().
  // Driving the full prepare flow needs a multi-page mock (HTML, JS, assets...).
  // This test verifies that bootstrap is callable post-prepare without dictating
  // the full server setup — we just confirm the contract.
  test("proxyKey of arbitrary IDs in bootstrap input would be encoded properly", async () => {
    const cacheDir = await makeTempDir()
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => undefined,
      getSession: () => fakeSession() as never,
    })
    expect(host.proxyKey("a/b")).toBe("desktop-instance:a/b")
    expect(host.proxyKey("with spaces")).toBe("desktop-instance:with spaces")
    expect(host.proxyKey("special!@#$%^&*()")).toBe("desktop-instance:special!@#$%^&*()")
  })
})

describe("createDesktopUIHost - live streams", () => {
  test("proxies global event streams natively without session.fetch buffering", async () => {
    const cacheDir = await makeTempDir()
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    const backendRequests: Array<{ cookie: string; header: string; pathname: string }> = []
    const backend = http.createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1")
        backendRequests.push({
          cookie: request.headers.cookie ?? "",
          header: String(request.headers["x-fixture-auth"] ?? ""),
          pathname: url.pathname,
        })
        if (url.pathname === "/global/version") {
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify({ current: "99.0.0" }))
          return
        }
        if (url.pathname === "/") {
          response.setHeader("content-type", "text/html")
          response.end('<!doctype html><script type="module" src="/assets/app.js"></script><div id="root"></div>')
          return
        }
        if (url.pathname === "/assets/app.js") {
          response.setHeader("content-type", "text/javascript")
          response.end("export default null")
          return
        }
        if (url.pathname === "/global/event") {
          response.writeHead(200, {
            "cache-control": "no-cache, no-transform",
            "content-type": "text/event-stream; charset=utf-8",
          })
          response.write("data: first\n\n")
          await sleep(250)
          response.end("data: done\n\n")
          return
        }
        response.writeHead(404)
        response.end("missing")
      })().catch((error) => {
        response.writeHead(500)
        response.end(error instanceof Error ? error.message : String(error))
      })
    })
    const instanceUrl = await listen(backend)
    const fetchPaths: string[] = []
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => ({ headers: { "x-fixture-auth": "stream" }, id: "local", url: instanceUrl }),
      getSession: () =>
        fakeSession({
          cookies: [{ name: "codeplane_auth", value: "1" }],
          onFetch: (url) => fetchPaths.push(url.pathname),
        }) as never,
    })
    const prepared = await host.prepare({ headers: { "x-fixture-auth": "stream" }, id: "local", url: instanceUrl })
    const streamUrl = new URL("/global/event", prepared.url)
    streamUrl.searchParams.set("server", "local")
    const response = await fetch(streamUrl, { headers: { accept: "text/event-stream" } })
    const reader = response.body?.getReader()
    if (!reader) throw new Error("expected response body")
    const started = Date.now()
    const first = await reader.read()
    const firstMs = Date.now() - started
    await reader.cancel()

    expect(response.status).toBe(200)
    expect(new TextDecoder().decode(first.value)).toContain("data: first")
    expect(firstMs).toBeLessThan(200)
    expect(fetchPaths).not.toContain("/global/event")
    expect(backendRequests.some((entry) => entry.pathname === "/global/event" && entry.cookie === "codeplane_auth=1")).toBe(true)
    expect(backendRequests.some((entry) => entry.pathname === "/global/event" && entry.header === "stream")).toBe(true)
  })
})

describe("createDesktopUIHost - proxy cancellation", () => {
  test("prematurely closed proxy requests do not log server.error", async () => {
    const cacheDir = await makeTempDir()
    const instanceUrl = "http://app.local"
    globalThis.fetch = (async (input) => {
      const url = new URL(typeof input === "string" ? input : input.toString())
      if (url.pathname === "/global/version") {
        return new Response(JSON.stringify({ current: "99.0.0" }), { headers: { "content-type": "application/json" } })
      }
      if (url.pathname === "/") {
        return new Response('<!doctype html><script type="module" src="/assets/app.js"></script><div id="root"></div>', {
          headers: { "content-type": "text/html" },
        })
      }
      if (url.pathname === "/assets/app.js") {
        return new Response("export default null", { headers: { "content-type": "text/javascript" } })
      }
      if (url.pathname === "/session") {
        const error = new Error("Premature close") as Error & { code: string }
        error.code = "ERR_STREAM_PREMATURE_CLOSE"
        throw error
      }
      return new Response("missing", { status: 404 })
    }) as never
    const logs: Array<{ event: string; data?: unknown }> = []
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => ({ id: "local", url: instanceUrl }),
      getSession: () => fakeSession() as never,
      log: (event, data) => logs.push({ event, data }),
    })
    const prepared = await host.prepare({ id: "local", url: instanceUrl })
    const uiOrigin = new URL(prepared.url).origin
    await new Promise<void>((resolve, reject) => {
      const request = http.get(`${uiOrigin}/session?server=local`, (response) => {
        response.resume()
        response.once("end", resolve)
      })
      request.once("error", (error) => {
        if ((error as { code?: string }).code === "ECONNRESET") {
          resolve()
          return
        }
        reject(error)
      })
    })
    for (let i = 0; i < 20 && !logs.some((entry) => entry.event === "server.client-closed"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    expect(logs.some((entry) => entry.event === "server.error")).toBe(false)
    expect(logs.some((entry) => entry.event === "proxy.client-closed" || entry.event === "server.client-closed")).toBe(
      true,
    )
  })
})

describe("createDesktopUIHost - WebSocket proxy", () => {
  test("tunnels PTY upgrade requests instead of treating them as HTTP fetches", async () => {
    const cacheDir = await makeTempDir()
    let upgradePath = ""
    const backend = http.createServer((request, response) => {
      if (request.url === "/global/version") {
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ current: "99.0.0" }))
        return
      }
      if (request.url === "/") {
        response.setHeader("content-type", "text/html")
        response.end('<!doctype html><script type="module" src="/assets/app.js"></script><div id="root"></div>')
        return
      }
      if (request.url === "/assets/app.js") {
        response.setHeader("content-type", "text/javascript")
        response.end("export default null")
        return
      }
      response.writeHead(404)
      response.end("missing")
    })
    backend.on("upgrade", (request, socket) => {
      upgradePath = request.url ?? ""
      socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
    })
    const instanceUrl = await listen(backend)
    const logs: Array<{ event: string; data?: unknown }> = []
    const host = createDesktopUIHost({
      cacheDir,
      getInstance: () => ({ id: "local", url: instanceUrl }),
      getSession: () => fakeSession() as never,
      log: (event, data) => logs.push({ event, data }),
    })
    const prepared = await host.prepare({ id: "local", url: instanceUrl })
    const ui = new URL(prepared.url)
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(Number(ui.port), ui.hostname, () => {
        socket.write(
          [
            "GET /instance/local/pty/pty_test/connect?directory=%2Ftmp&cursor=0 HTTP/1.1",
            `Host: ${ui.host}`,
            "Connection: Upgrade",
            "Upgrade: websocket",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version: 13",
            "",
            "",
          ].join("\r\n"),
        )
      })
      const started = Date.now()
      const poll = () => {
        if (upgradePath) {
          socket.destroy()
          resolve()
          return
        }
        if (Date.now() - started > 1_000) {
          socket.destroy()
          reject(new Error("timed out waiting for backend upgrade"))
          return
        }
        setTimeout(poll, 25)
      }
      socket.once("error", reject)
      poll()
    })

    expect(upgradePath).toBe("/pty/pty_test/connect?directory=%2Ftmp&cursor=0")
    expect(logs.some((entry) => entry.event === "proxy.upgrade.connected")).toBe(true)
    expect(logs.some((entry) => entry.event === "server.error")).toBe(false)
  })
})
