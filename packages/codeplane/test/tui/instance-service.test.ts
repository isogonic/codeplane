import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createInstanceService, TUIAuthRequiredError } from "../../src/tui/instance-service"

const env = {
  CODEPLANE_HOME_DIR: process.env.CODEPLANE_HOME_DIR,
}
let home: string
let originalFetch: typeof globalThis.fetch

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-instance-service-"))
  process.env.CODEPLANE_HOME_DIR = home
  originalFetch = globalThis.fetch
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (env.CODEPLANE_HOME_DIR === undefined) delete process.env.CODEPLANE_HOME_DIR
  else process.env.CODEPLANE_HOME_DIR = env.CODEPLANE_HOME_DIR
  await fs.rm(home, { force: true, recursive: true })
})

describe("createInstanceService - exposed surface", () => {
  test("returns the expected method set", () => {
    const service = createInstanceService()
    expect(typeof service.list).toBe("function")
    expect(typeof service.save).toBe("function")
    expect(typeof service.remove).toBe("function")
    expect(typeof service.probe).toBe("function")
    expect(typeof service.open).toBe("function")
    expect(typeof service.localTarget).toBe("function")
    expect(typeof service.localStatus).toBe("function")
    expect(typeof service.installLocal).toBe("function")
    expect(typeof service.cacheInfo).toBe("function")
    expect(typeof service.clearCache).toBe("function")
    expect(typeof service.setLast).toBe("function")
    expect(service.store).toBeDefined()
  })
})

describe("createInstanceService.list", () => {
  test("returns an empty list on a fresh home", async () => {
    const service = createInstanceService()
    expect(await service.list()).toEqual([])
  })

  test("returns saved instances", async () => {
    const service = createInstanceService()
    await service.save({ id: "a", url: "http://a" })
    await service.save({ id: "b", url: "http://b" })
    const list = await service.list()
    expect(list.map((i) => i.id).sort()).toEqual(["a", "b"])
  })
})

describe("createInstanceService.save", () => {
  test("persists an instance", async () => {
    const service = createInstanceService()
    await service.save({ id: "a", url: "http://localhost:3000" })
    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe("a")
  })

  test("normalizes URL on save (strips trailing slashes)", async () => {
    const service = createInstanceService()
    await service.save({ id: "a", url: "http://localhost:3000///" })
    const list = await service.list()
    expect(list[0].url).toBe("http://localhost:3000")
  })

  test("preserves headers on save", async () => {
    const service = createInstanceService()
    await service.save({
      id: "a",
      url: "http://x",
      headers: { Authorization: "Bearer abc" },
    })
    const list = await service.list()
    expect(list[0].headers).toEqual({ Authorization: "Bearer abc" })
  })

  test("preserves label on save", async () => {
    const service = createInstanceService()
    await service.save({ id: "a", url: "http://x", label: "My Server" })
    const list = await service.list()
    expect(list[0].label).toBe("My Server")
  })

  test("preserves local config on save", async () => {
    const service = createInstanceService()
    await service.save({ id: "a", url: "local://a", local: { binaryVersion: "27.4.0" } })
    const list = await service.list()
    expect(list[0].local).toEqual({ binaryVersion: "27.4.0" })
  })

  test("update via save replaces previous record", async () => {
    const service = createInstanceService()
    await service.save({ id: "a", url: "http://a", label: "First" })
    await service.save({ id: "a", url: "http://a", label: "Second" })
    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe("Second")
  })
})

describe("createInstanceService.remove", () => {
  test("removes a saved instance", async () => {
    const service = createInstanceService()
    await service.save({ id: "a", url: "http://a" })
    await service.save({ id: "b", url: "http://b" })
    await service.remove("a")
    const list = await service.list()
    expect(list.map((i) => i.id)).toEqual(["b"])
  })

  test("removing a non-existent id is a no-op", async () => {
    const service = createInstanceService()
    await service.save({ id: "a", url: "http://a" })
    await service.remove("ghost")
    const list = await service.list()
    expect(list).toHaveLength(1)
  })

  test("remove returns the resulting list", async () => {
    const service = createInstanceService()
    await service.save({ id: "a", url: "http://a" })
    const result = await service.remove("a")
    expect(result).toEqual([])
  })
})

describe("createInstanceService cache helpers", () => {
  test("reports and clears local cache for an instance", async () => {
    const service = createInstanceService()
    await fs.mkdir(path.join(home, "instances", "remote-a", "cache"), { recursive: true })
    await fs.writeFile(path.join(home, "instances", "remote-a", "cache", "models.json"), "abc")

    const before = await service.cacheInfo("remote-a")
    expect(before.exists).toBe(true)
    expect(before.bytes).toBe(3)

    const cleared = await service.clearCache("remote-a")
    expect(cleared.bytes).toBe(3)
    expect(await service.cacheInfo("remote-a")).toEqual({ exists: false, bytes: 0, areas: [] })
  })
})

describe("createInstanceService.probe - URL normalization", () => {
  test("rejects empty URL", async () => {
    const service = createInstanceService()
    const result = await service.probe("")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Invalid instance URL/)
  })

  test("rejects whitespace-only URL", async () => {
    const service = createInstanceService()
    const result = await service.probe("   ")
    expect(result.ok).toBe(false)
  })

  test("returns success on a 200 with JSON content", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ current: "27.4.2", latest: "27.5.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as never
    const service = createInstanceService()
    const result = await service.probe("http://example.com")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.version).toBe("27.4.2")
      expect(result.latest).toBe("27.5.0")
      expect(result.status).toBe(200)
    }
  })

  test("returns success even if version field is missing (HTML probe path)", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>login</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as never
    const service = createInstanceService()
    const result = await service.probe("http://example.com")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.version).toBeUndefined()
  })

  test("returns ok=false on 404", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 404 })) as never
    const service = createInstanceService()
    const result = await service.probe("http://example.com")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(404)
      expect(result.error).toMatch(/HTTP 404/)
    }
  })

  test("returns ok=false on 401", async () => {
    globalThis.fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as never
    const service = createInstanceService()
    const result = await service.probe("http://example.com")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  test("returns ok=false on 403", async () => {
    globalThis.fetch = (async () =>
      new Response("forbidden", { status: 403 })) as never
    const service = createInstanceService()
    const result = await service.probe("http://example.com")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  test("returns ok=false on 500", async () => {
    globalThis.fetch = (async () =>
      new Response("server error", { status: 500 })) as never
    const service = createInstanceService()
    const result = await service.probe("http://example.com")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(500)
  })

  test("returns ok=false when fetch throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down")
    }) as never
    const service = createInstanceService()
    const result = await service.probe("http://example.com")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("network down")
  })

  test("accepts a SavedInstance object directly", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ current: "27.0.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as never
    const service = createInstanceService()
    const result = await service.probe({ id: "x", url: "http://example.com" })
    expect(result.ok).toBe(true)
  })

  test("attaches user:pass as Basic auth header", async () => {
    let observedAuth = ""
    globalThis.fetch = (async (_input: unknown, init: RequestInit | undefined) => {
      const headers = new Headers(init?.headers ?? {})
      observedAuth = headers.get("authorization") ?? ""
      return new Response(JSON.stringify({ current: "1.0.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as never
    const service = createInstanceService()
    await service.probe({ id: "x", url: "http://user:pass@example.com" })
    expect(observedAuth).toMatch(/^Basic /)
  })

  test("forwards instance headers", async () => {
    let observedAuth = ""
    globalThis.fetch = (async (_input: unknown, init: RequestInit | undefined) => {
      const headers = new Headers(init?.headers ?? {})
      observedAuth = headers.get("authorization") ?? ""
      return new Response(JSON.stringify({ current: "1.0.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as never
    const service = createInstanceService()
    await service.probe({
      id: "x",
      url: "http://example.com",
      headers: { Authorization: "Bearer xyz" },
    })
    expect(observedAuth).toBe("Bearer xyz")
  })
})

describe("createInstanceService.localTarget", () => {
  test("returns the platform target with defaultVersion", async () => {
    const service = createInstanceService()
    const target = await service.localTarget()
    expect(typeof target.archiveName).toBe("string")
    expect(typeof target.binaryName).toBe("string")
    expect(typeof target.os).toBe("string")
    expect(typeof target.arch).toBe("string")
    expect(typeof target.defaultVersion).toBe("string")
  })
})

describe("createInstanceService.localStatus", () => {
  test("returns installed=false when binary missing", async () => {
    const service = createInstanceService()
    const status = await service.localStatus("99.0.0")
    expect(status.installed).toBe(false)
    expect(status.binaryVersion).toBe("99.0.0")
  })

  test("uses preferred version when no version supplied", async () => {
    const service = createInstanceService()
    const status = await service.localStatus()
    expect(typeof status.binaryVersion).toBe("string")
  })
})

describe("TUIAuthRequiredError", () => {
  test("name and instanceof checks", () => {
    const err = new TUIAuthRequiredError({
      authUrl: "https://login.example.com",
      instanceUrl: "https://app.example.com",
    })
    expect(err.name).toBe("TUIAuthRequiredError")
    expect(err instanceof TUIAuthRequiredError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })

  test("preserves authUrl and instanceUrl", () => {
    const err = new TUIAuthRequiredError({
      authUrl: "https://login.example.com/path",
      instanceUrl: "https://app.example.com:8443/path",
    })
    expect(err.authUrl).toBe("https://login.example.com/path")
    expect(err.instanceUrl).toBe("https://app.example.com:8443/path")
    expect(err.message).toContain("https://app.example.com:8443/path")
  })
})

describe("createInstanceService.open - sign-in detection", () => {
  test("throws TUIAuthRequiredError on 401", async () => {
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as never
    const service = createInstanceService()
    const promise = service.open({ id: "x", url: "http://example.com" })
    await expect(promise).rejects.toBeInstanceOf(TUIAuthRequiredError)
  })

  test("throws TUIAuthRequiredError on 403", async () => {
    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as never
    const service = createInstanceService()
    const promise = service.open({ id: "x", url: "http://example.com" })
    await expect(promise).rejects.toBeInstanceOf(TUIAuthRequiredError)
  })

  test("throws TUIAuthRequiredError on 200 HTML (login page redirect)", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>login</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as never
    const service = createInstanceService()
    const promise = service.open({ id: "x", url: "http://example.com" })
    await expect(promise).rejects.toBeInstanceOf(TUIAuthRequiredError)
  })

  test("does NOT throw TUIAuthRequiredError on 404", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as never
    const service = createInstanceService()
    const promise = service.open({ id: "x", url: "http://example.com" })
    await expect(promise).rejects.not.toBeInstanceOf(TUIAuthRequiredError)
  })

  test("auth error includes instance URL", async () => {
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as never
    const service = createInstanceService()
    try {
      await service.open({ id: "x", url: "http://example.com" })
      throw new Error("expected to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(TUIAuthRequiredError)
      if (error instanceof TUIAuthRequiredError) {
        expect(error.instanceUrl).toContain("example.com")
        expect(error.authUrl).toContain("example.com")
      }
    }
  })
})

describe("createInstanceService.setLast", () => {
  test("returns the value", async () => {
    const service = createInstanceService()
    expect(await service.setLast("x")).toBe("x")
    expect(await service.setLast(undefined)).toBeUndefined()
  })

  test("affects store.getLast", async () => {
    const service = createInstanceService()
    await service.setLast("x")
    expect(await service.store.getLast()).toBe("x")
  })
})
