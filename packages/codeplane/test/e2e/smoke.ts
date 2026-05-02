import { describe, expect, test } from "bun:test"
import { resolveCodeplaneLocalTarget } from "@codeplane-ai/shared/local-runtime"
import { spawn as ptySpawn } from "bun-pty"
import fs from "node:fs/promises"
import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { tmpdir } from "../fixture/fixture"

const packageDir = path.resolve(import.meta.dir, "..", "..")
const cliEntry = path.join(packageDir, "src", "index.ts")

function paths(root: string) {
  return {
    codeplaneHome: path.join(root, "Codeplane"),
    managed: path.join(root, "managed"),
    workspace: path.join(root, "workspace"),
    xdg: path.join(root, "xdg"),
  }
}

function env(root: string) {
  const next = paths(root)
  return {
    ...process.env,
    BROWSER: "false",
    CODEPLANE_HOME_DIR: next.codeplaneHome,
    CODEPLANE_TEST_HOME: path.join(root, "home"),
    CODEPLANE_TEST_MANAGED_CONFIG_DIR: next.managed,
    XDG_CACHE_HOME: path.join(next.xdg, "cache"),
    XDG_CONFIG_HOME: path.join(next.xdg, "config"),
    XDG_DATA_HOME: path.join(next.xdg, "data"),
    XDG_STATE_HOME: path.join(next.xdg, "state"),
  }
}

async function prepare(root: string) {
  const next = paths(root)
  await fs.mkdir(next.workspace, { recursive: true })
  return next
}

function runCli(root: string, args: string[], timeoutMs = 20_000) {
  const child = spawn(process.execPath, ["run", cliEntry, ...args], {
    cwd: paths(root).workspace,
    env: env(root),
    stdio: ["ignore", "pipe", "pipe"],
  })

  const stdout: string[] = []
  const stderr: string[] = []
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString("utf8")))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")))

  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`CLI timed out after ${timeoutMs}ms: ${args.join(" ")}`))
    }, timeoutMs)

    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.once("close", (code, signal) => {
      clearTimeout(timer)
      resolve({
        code,
        signal,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      })
    })
  })
}

function startCli(root: string, args: string[]) {
  const child = spawn(process.execPath, ["run", cliEntry, ...args], {
    cwd: paths(root).workspace,
    env: env(root),
    stdio: ["ignore", "pipe", "pipe"],
  })

  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8")
  })
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8")
  })

  return {
    child,
    output: () => `${stderr}${stdout}`,
  }
}

async function waitFor(read: () => string, matcher: RegExp, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const output = read()
    if (matcher.test(output)) return output
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${matcher}\n\n${read()}`)
}

function stopChild(child: ChildProcess, timeoutMs = 5_000) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`Child did not exit within ${timeoutMs}ms`))
    }, timeoutMs)

    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.once("close", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })

    child.kill("SIGTERM")
  })
}

async function writeFakeLocalRuntime(root: string, version: string) {
  const target = resolveCodeplaneLocalTarget()
  const binary = path.join(paths(root).codeplaneHome, "local_server", "binaries", version, target.binaryName)
  const script = `#!/usr/bin/env node
const http = require("node:http")
const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1")
  response.setHeader("content-type", "application/json; charset=utf-8")
  if (url.pathname === "/global/version") {
    response.end(JSON.stringify({ current: "27.3.0-test" }) + "\\n")
    return
  }
  if (url.pathname === "/path") {
    response.end(JSON.stringify({
      home: process.env.CODEPLANE_HOME_DIR || "",
      state: process.env.CODEPLANE_STATE_DIR || "",
      config: process.env.CODEPLANE_HOME_DIR || "",
      directory: process.cwd(),
      worktree: process.cwd(),
    }) + "\\n")
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ message: "not found" }) + "\\n")
})
server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  process.stdout.write("listening on http://127.0.0.1:" + port + "\\n")
})
setTimeout(() => server.close(() => process.exit(0)), 1500).unref()
`

  await fs.mkdir(path.dirname(binary), { recursive: true })
  await fs.writeFile(binary, script)
  await fs.chmod(binary, 0o755)
  return binary
}

describe("codeplane smoke", () => {
  test("config and instance commands round-trip against an isolated Codeplane home", async () => {
    await using tmp = await tmpdir()
    await prepare(tmp.path)

    const setClient = await runCli(tmp.path, ["config", "set", "npm.client", "pnpm"])
    expect(setClient.code).toBe(0)
    expect(setClient.stderr).not.toContain("reserved word")

    const setMcp = await runCli(tmp.path, [
      "config",
      "set",
      "mcp.test_server",
      '{"type":"local","command":["echo","hello"],"enabled":true}',
      "--json",
    ])
    expect(setMcp.code).toBe(0)

    const addRemote = await runCli(tmp.path, ["instance", "add", "https://example.com", "--label", "Example", "--id", "remote-1"])
    expect(addRemote.code).toBe(0)

    const addLocal = await runCli(tmp.path, [
      "instance",
      "add",
      "--local",
      "--label",
      "Local",
      "--id",
      "local-1",
      "--runtime-version",
      "27.3.0",
    ])
    expect(addLocal.code).toBe(0)
    expect(addLocal.stderr).not.toContain("reserved word")

    const selectLocal = await runCli(tmp.path, ["instance", "use", "local-1"])
    expect(selectLocal.code).toBe(0)

    const pathsResult = await runCli(tmp.path, ["config", "paths"])
    const pathInfo = JSON.parse(pathsResult.stdout)
    expect(pathInfo.root).toBe(paths(tmp.path).codeplaneHome)
    expect(pathInfo.canonicalGlobalConfigFile).toBe(path.join(paths(tmp.path).codeplaneHome, "codeplane.jsonc"))

    const getClient = await runCli(tmp.path, ["config", "get", "npm.client"])
    expect(JSON.parse(getClient.stdout)).toBe("pnpm")

    const listInstances = await runCli(tmp.path, ["instance", "list", "--json"])
    const instances = JSON.parse(listInstances.stdout) as Array<{ id: string; type: string; default: boolean; url: string; version?: string }>
    expect(instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "remote-1",
          type: "remote",
          url: "https://example.com",
        }),
        expect.objectContaining({
          id: "local-1",
          type: "local",
          default: true,
          url: "local://local-1",
          version: "27.3.0",
        }),
      ]),
    )

    const stored = JSON.parse(await fs.readFile(path.join(paths(tmp.path).codeplaneHome, "instances.json"), "utf8")) as {
      lastInstanceID?: string
      instances: Array<{ id: string }>
    }
    expect(stored.lastInstanceID).toBe("local-1")
    expect(stored.instances.map((item) => item.id)).toEqual(expect.arrayContaining(["remote-1", "local-1"]))
  })

  test("local instance open starts a managed local server and resolves the live URL", async () => {
    await using tmp = await tmpdir()
    await prepare(tmp.path)
    await writeFakeLocalRuntime(tmp.path, "27.3.0")

    const addLocal = await runCli(tmp.path, [
      "instance",
      "add",
      "--local",
      "--label",
      "Local",
      "--id",
      "local-1",
      "--runtime-version",
      "27.3.0",
    ])
    expect(addLocal.code).toBe(0)

    const openLocal = await runCli(tmp.path, ["instance", "open", "local-1"], 30_000)
    const result = JSON.parse(openLocal.stdout) as {
      id: string
      savedUrl: string
      liveUrl: string
      version: string
      path: { directory: string }
    }

    expect(openLocal.code).toBe(0)
    expect(openLocal.stderr).not.toContain("reserved word")
    expect(result.id).toBe("local-1")
    expect(result.savedUrl).toBe("local://local-1")
    expect(result.liveUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(result.version).toBe("27.3.0-test")
    expect(result.path.directory).toBe(path.join(paths(tmp.path).codeplaneHome, "local_server", "local-1"))
    expect(await fs.access(path.join(paths(tmp.path).codeplaneHome, "local_server", "local-1", "data")).then(() => true).catch(() => false)).toBe(true)
    expect(await fs.access(path.join(paths(tmp.path).codeplaneHome, "bin", ".codeplane-version")).then(() => true).catch(() => false)).toBe(true)
  })

  test("explicit TUI invocation renders the setup shell and exits cleanly", async () => {
    if (process.platform === "win32") return
    if (!Bun.which("node")) return

    await using tmp = await tmpdir()
    await prepare(tmp.path)

    const proc = ptySpawn(process.execPath, ["run", cliEntry, "tui", "--route", "setup.list"], {
      cwd: paths(tmp.path).workspace,
      env: {
        ...env(tmp.path),
        TERM: "xterm-256color",
      },
      cols: 120,
      rows: 32,
      name: "xterm-256color",
    })

    let output = ""
    proc.onData((chunk) => {
      output += chunk
    })

    await waitFor(() => output, /route:setup\.list/)
    expect(output).toContain("codeplane tui")
    expect(output).toContain("No saved instances")

    const exited = new Promise<{ exitCode: number | null }>((resolve) => {
      proc.onExit(({ exitCode }) => resolve({ exitCode: exitCode ?? null }))
    })

    proc.write("q")
    expect((await exited).exitCode).toBe(0)
  }, 30_000)

  test("bare non-interactive invocation defaults to the web server", async () => {
    await using tmp = await tmpdir()
    await prepare(tmp.path)

    const started = startCli(tmp.path, [])
    const output = await waitFor(started.output, /http:\/\/127\.0\.0\.1:\d+\//, 30_000)
    const url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0]
    expect(url).toBeTruthy()

    const health = await fetch(new URL("global/health", url!))
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual(expect.objectContaining({ healthy: true }))

    const exited = await stopChild(started.child, 10_000)
    expect(started.output()).toContain("Web interface:")
    expect(exited.signal === "SIGTERM" || exited.code === 0).toBe(true)
  }, 30_000)
})
