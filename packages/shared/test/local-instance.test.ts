import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createLocalInstanceManager, findListeningPort } from "../src/local-instance"
import { resolveCodeplaneLocalTarget } from "../src/local-runtime"

const env = {
  CODEPLANE_HOME_DIR: process.env.CODEPLANE_HOME_DIR,
}

let home: string

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-mgr-"))
  process.env.CODEPLANE_HOME_DIR = home
})

afterEach(async () => {
  if (env.CODEPLANE_HOME_DIR === undefined) delete process.env.CODEPLANE_HOME_DIR
  else process.env.CODEPLANE_HOME_DIR = env.CODEPLANE_HOME_DIR
  await fs.rm(home, { force: true, recursive: true })
})

async function writeFakeBinary(home: string, version: string) {
  const target = resolveCodeplaneLocalTarget()
  const dir = path.join(home, "local_server", "binaries", version, "bin")
  await fs.mkdir(dir, { recursive: true })
  const binary = path.join(dir, target.binaryName)
  // A tiny shell script that prints the listening line and stays alive.
  // Cross-platform note: this fixture is unix-only; tests on windows skip.
  // stdbuf + explicit fd flush so the parent sees the listening line
  // before the timeout. `wait` lets us forward SIGTERM cleanly.
  const script = `#!/usr/bin/env bash
exec 1>&1
printf 'listening on http://127.0.0.1:54321\\n'
trap "exit 0" SIGTERM SIGINT
( while true; do sleep 1; done ) &
wait $!
`
  await fs.writeFile(binary, script)
  await fs.chmod(binary, 0o755)
  return binary
}

describe("findListeningPort", () => {
  test("matches several wording variants", () => {
    expect(findListeningPort("listening on http://127.0.0.1:1234\n")).toBe(1234)
    expect(findListeningPort("Listening at https://0.0.0.0:65500")).toBe(65500)
    expect(findListeningPort("server started on http://localhost:8080")).toBe(8080)
    expect(findListeningPort("nothing here")).toBeUndefined()
  })
})

if (process.platform !== "win32") {
  describe("local instance manager — auto download fallback", () => {
    test("start() throws a chained error when auto-download fails", async () => {
      // No fake binary written → start() will try to download and fail because
      // there's no fetch stub. Confirm the failure surfaces with a useful message.
      const manager = createLocalInstanceManager({
        binariesDir: path.join(home, "local_server", "binaries"),
        configDir: home,
        dataDir: path.join(home, "local_server"),
      })
      const previousFetch = globalThis.fetch
      globalThis.fetch = (async () =>
        new Response("not found", { status: 404 })) as unknown as typeof globalThis.fetch
      try {
        await expect(manager.start({ id: "ghost", binaryVersion: "27.3.1" })).rejects.toThrow(
          /could not be installed/i,
        )
      } finally {
        globalThis.fetch = previousFetch
        await manager.stopAll()
      }
    })
  })

  describe("local instance manager", () => {
    test("start() resolves when the child prints the listening line and stop() tears it down", async () => {
      await writeFakeBinary(home, "27.3.1")
      const manager = createLocalInstanceManager({
        binariesDir: path.join(home, "local_server", "binaries"),
        configDir: home,
        dataDir: path.join(home, "local_server"),
      })
      try {
        const running = await manager.start({ id: "fake-1", binaryVersion: "27.3.1" })
        expect(running.url).toBe("http://127.0.0.1:54321")
        expect(running.binaryVersion).toBe("27.3.1")
        expect(manager.isRunning("fake-1")).toBe(true)
        expect(manager.getRunning("fake-1")?.binaryVersion).toBe("27.3.1")
      } finally {
        await manager.stopAll()
      }
    })

    test("concurrent start() calls for the same id collapse to a single child", async () => {
      await writeFakeBinary(home, "27.3.1")
      const manager = createLocalInstanceManager({
        binariesDir: path.join(home, "local_server", "binaries"),
        configDir: home,
        dataDir: path.join(home, "local_server"),
      })
      try {
        const [a, b, c] = await Promise.all([
          manager.start({ id: "fake-2", binaryVersion: "27.3.1" }),
          manager.start({ id: "fake-2", binaryVersion: "27.3.1" }),
          manager.start({ id: "fake-2", binaryVersion: "27.3.1" }),
        ])
        expect(a.url).toBe(b.url)
        expect(b.url).toBe(c.url)
        expect(manager.listRunning()).toHaveLength(1)
      } finally {
        await manager.stopAll()
      }
    })
  })
}
