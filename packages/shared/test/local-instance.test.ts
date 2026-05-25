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

async function writeFakeBinary(
  home: string,
  version: string,
  options: { argvPath?: string; envPath?: string } = {},
) {
  const target = resolveCodeplaneLocalTarget()
  const dir = path.join(home, "local_server", "binaries", version, "bin")
  await fs.mkdir(dir, { recursive: true })
  const binary = path.join(dir, target.binaryName)
  const envDump = options.envPath
    ? `
{
  echo "CODEPLANE_CLIENT=\${CODEPLANE_CLIENT:-}"
  echo "CODEPLANE_HOME_DIR=\${CODEPLANE_HOME_DIR:-}"
  echo "CODEPLANE_DATA_DIR=\${CODEPLANE_DATA_DIR:-}"
  echo "CODEPLANE_CACHE_DIR=\${CODEPLANE_CACHE_DIR:-}"
  echo "CODEPLANE_STATE_DIR=\${CODEPLANE_STATE_DIR:-}"
  echo "CODEPLANE_BIN_DIR=\${CODEPLANE_BIN_DIR:-}"
  echo "CODEPLANE_DESKTOP_MANAGED=\${CODEPLANE_DESKTOP_MANAGED:-}"
  echo "CODEPLANE_DESKTOP_BRIDGE_ORIGIN=\${CODEPLANE_DESKTOP_BRIDGE_ORIGIN:-}"
  echo "CODEPLANE_DESKTOP_BRIDGE_TOKEN=\${CODEPLANE_DESKTOP_BRIDGE_TOKEN:-}"
  echo "CODEPLANE_LOG_DIR=\${CODEPLANE_LOG_DIR:-}"
  echo "CODEPLANE_LOG_LEVEL=\${CODEPLANE_LOG_LEVEL:-}"
} > ${JSON.stringify(options.envPath)}
`
    : ""
  const argvDump = options.argvPath
    ? `
printf '%s\\n' "$@" > ${JSON.stringify(options.argvPath)}
`
    : ""
  // A tiny shell script that prints the listening line and stays alive.
  // Cross-platform note: this fixture is unix-only; tests on windows skip.
  // stdbuf + explicit fd flush so the parent sees the listening line
  // before the timeout. `wait` lets us forward SIGTERM cleanly.
  const script = `#!/usr/bin/env bash
exec 1>&1
${envDump}
${argvDump}
printf 'listening on http://127.0.0.1:54321\\n'
trap "exit 0" SIGTERM SIGINT
( while true; do sleep 1; done ) &
wait $!
`
  await fs.writeFile(binary, script)
  await fs.chmod(binary, 0o755)
  return binary
}

async function readFileUntil(file: string, expected: string) {
  let text = ""
  for (let i = 0; i < 20; i++) {
    text = await fs.readFile(file, "utf8").catch(() => "")
    if (text.includes(expected)) return text
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return text
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

    test("desktop-managed children run as desktop app clients with bridge env", async () => {
      const envPath = path.join(home, "child-env.txt")
      await writeFakeBinary(home, "27.3.2", { envPath })
      const manager = createLocalInstanceManager({
        binariesDir: path.join(home, "local_server", "binaries"),
        configDir: home,
        dataDir: path.join(home, "local_server"),
        desktopManaged: true,
        extraEnv: () => ({
          CODEPLANE_DESKTOP_BRIDGE_ORIGIN: "http://127.0.0.1:43210",
          CODEPLANE_DESKTOP_BRIDGE_TOKEN: "bridge-token",
        }),
      })
      try {
        await manager.start({ id: "fake-desktop", binaryVersion: "27.3.2" })
        const text = await fs.readFile(envPath, "utf8")
        expect(text).toContain("CODEPLANE_CLIENT=app")
        expect(text).toContain("CODEPLANE_DESKTOP_MANAGED=1")
        expect(text).toContain("CODEPLANE_DESKTOP_BRIDGE_ORIGIN=http://127.0.0.1:43210")
        expect(text).toContain("CODEPLANE_DESKTOP_BRIDGE_TOKEN=bridge-token")
      } finally {
        await manager.stopAll()
      }
    })

    test("start() gives each local instance an isolated runtime home", async () => {
      const alphaEnvPath = path.join(home, "alpha-env.txt")
      const betaEnvPath = path.join(home, "beta-env.txt")
      await writeFakeBinary(home, "27.3.4", { envPath: alphaEnvPath })
      await writeFakeBinary(home, "27.3.5", { envPath: betaEnvPath })
      const manager = createLocalInstanceManager({
        binariesDir: path.join(home, "local_server", "binaries"),
        configDir: home,
        dataDir: path.join(home, "local_server"),
      })
      try {
        await manager.start({ id: "alpha", binaryVersion: "27.3.4" })
        await manager.start({ id: "beta", binaryVersion: "27.3.5" })

        const alphaText = await fs.readFile(alphaEnvPath, "utf8")
        const betaText = await fs.readFile(betaEnvPath, "utf8")
        expect(alphaText).toContain(`CODEPLANE_HOME_DIR=${path.join(home, "local_server", "alpha", "config")}`)
        expect(alphaText).toContain(`CODEPLANE_DATA_DIR=${path.join(home, "local_server", "alpha", "data")}`)
        expect(alphaText).toContain(`CODEPLANE_CACHE_DIR=${path.join(home, "local_server", "alpha", "cache")}`)
        expect(alphaText).toContain(`CODEPLANE_STATE_DIR=${path.join(home, "local_server", "alpha", "state")}`)
        expect(alphaText).toContain(`CODEPLANE_BIN_DIR=${path.join(home, "local_server", "alpha", "bin")}`)
        expect(alphaText).toContain(`CODEPLANE_LOG_DIR=${path.join(home, "local_server", "alpha", "log")}`)
        expect(betaText).toContain(`CODEPLANE_HOME_DIR=${path.join(home, "local_server", "beta", "config")}`)
        expect(betaText).toContain(`CODEPLANE_DATA_DIR=${path.join(home, "local_server", "beta", "data")}`)
        expect(betaText).toContain(`CODEPLANE_CACHE_DIR=${path.join(home, "local_server", "beta", "cache")}`)
        expect(betaText).toContain(`CODEPLANE_STATE_DIR=${path.join(home, "local_server", "beta", "state")}`)
        expect(betaText).toContain(`CODEPLANE_BIN_DIR=${path.join(home, "local_server", "beta", "bin")}`)
        expect(betaText).toContain(`CODEPLANE_LOG_DIR=${path.join(home, "local_server", "beta", "log")}`)
      } finally {
        await manager.stopAll()
      }
    })

    test("debug logging passes DEBUG level and tees process output into the instance log directory", async () => {
      const argvPath = path.join(home, "debug-argv.txt")
      const envPath = path.join(home, "debug-env.txt")
      await writeFakeBinary(home, "27.3.3", { argvPath, envPath })
      const manager = createLocalInstanceManager({
        binariesDir: path.join(home, "local_server", "binaries"),
        configDir: home,
        dataDir: path.join(home, "local_server"),
        debugLogging: () => true,
      })
      try {
        await manager.start({ id: "fake-debug", binaryVersion: "27.3.3" })
        expect(await fs.readFile(argvPath, "utf8")).toContain("--log-level\nDEBUG")
        const envText = await fs.readFile(envPath, "utf8")
        expect(envText).toContain(`CODEPLANE_LOG_DIR=${manager.logDir("fake-debug")}`)
        expect(envText).toContain("CODEPLANE_LOG_LEVEL=DEBUG")
      } finally {
        await manager.stopAll()
      }
      const processLog = await readFileUntil(
        path.join(manager.logDir("fake-debug"), "process.log"),
        "process log-end id=fake-debug",
      )
      expect(processLog).toContain("process log-start id=fake-debug")
      expect(processLog).toContain('"debugLogging":true')
      expect(processLog).toContain("stdout listening on http://127.0.0.1:54321")
      expect(processLog).toContain("process log-end id=fake-debug")
    })
  })
}
