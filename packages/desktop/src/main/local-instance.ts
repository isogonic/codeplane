import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import {
  installCodeplaneLocalPackage,
  installManagedCodeplaneCli,
  managedCodeplaneCliStatus,
  resolveCodeplaneLocalTarget,
} from "@codeplane-ai/shared/local-runtime"

const LISTEN_LINE_PATTERN = /listening on https?:\/\/[^:\s]+:(\d+)/i
const SERVER_START_TIMEOUT_MS = 30_000

export type LocalInstanceProgress = {
  phase: "detect" | "download" | "extract" | "start" | "ready"
  message: string
  percent: number
  binaryVersion?: string
  transferred?: number
  total?: number
}

export type LocalInstanceStatus = {
  binaryVersion: string
  installed: boolean
  binaryPath: string
  archive: string
  cliInstalled?: boolean
  cliPath?: string
}

export type RunningLocalInstance = {
  id: string
  binaryVersion: string
  port: number
  url: string
}

type ManagedProcess = {
  child: ChildProcess
  port: number
  url: string
  stop: () => Promise<void>
}

export type LocalTarget = ReturnType<typeof resolveCodeplaneLocalTarget>
export const resolveLocalTarget = () => resolveCodeplaneLocalTarget()

export function createLocalInstanceManager(input: {
  binariesDir: string
  configDir: string
  dataDir: string
  log?(event: string, data?: unknown): void
}) {
  const log = (event: string, data?: unknown) => input.log?.(event, data)
  const configDir = input.configDir
  const target = resolveLocalTarget()
  const running = new Map<string, ManagedProcess>()

  const versionRoot = (version: string) => path.join(input.binariesDir, version)
  const binaryPath = (version: string) => path.join(versionRoot(version), target.binaryName)
  const dataDirFor = (id: string) => path.join(input.dataDir, id)

  async function exists(file: string) {
    try {
      await fs.access(file)
      return true
    } catch {
      return false
    }
  }

  async function isInstalled(version: string) {
    const file = binaryPath(version)
    return exists(file)
  }

  async function status(version: string): Promise<LocalInstanceStatus> {
    const cli = await managedCodeplaneCliStatus()
    return {
      archive: target.archiveName,
      binaryPath: binaryPath(version),
      binaryVersion: version,
      installed: await isInstalled(version),
      cliInstalled: cli.cliInstalled,
      cliPath: cli.cliPath,
    }
  }

  async function download(
    version: string,
    progress?: (info: LocalInstanceProgress) => void,
  ): Promise<LocalInstanceStatus> {
    log("local.download.start", { archive: target.archiveName, version })

    const root = versionRoot(version)
    if (await isInstalled(version)) {
      log("local.download.cached", { binary: binaryPath(version), version })
      await installManagedCodeplaneCli({
        version,
        binaryPath: binaryPath(version),
      })
      progress?.({
        phase: "ready",
        message: `Codeplane ${version} is already installed locally.`,
        percent: 100,
        binaryVersion: version,
      })
      return status(version)
    }
    await installCodeplaneLocalPackage({
      version,
      directory: root,
      progress: (next) => progress?.(next),
    })
    await installManagedCodeplaneCli({
      version,
      binaryPath: binaryPath(version),
    })
    log("local.extract.success", { binary: binaryPath(version), packageName: target.packageName, version })
    return status(version)
  }

  async function start(input: { id: string; binaryVersion: string }): Promise<RunningLocalInstance> {
    const existing = running.get(input.id)
    if (existing) {
      return { id: input.id, binaryVersion: input.binaryVersion, port: existing.port, url: existing.url }
    }

    if (!(await isInstalled(input.binaryVersion))) {
      throw new Error(`Codeplane ${input.binaryVersion} is not installed locally`)
    }
    await installManagedCodeplaneCli({
      version: input.binaryVersion,
      binaryPath: binaryPath(input.binaryVersion),
    })

    const data = dataDirFor(input.id)
    await Promise.all([
      fs.mkdir(path.join(data, "data"), { recursive: true }),
      fs.mkdir(path.join(data, "config"), { recursive: true }),
      fs.mkdir(path.join(data, "cache"), { recursive: true }),
      fs.mkdir(path.join(data, "state"), { recursive: true }),
      fs.mkdir(path.join(data, "bin"), { recursive: true }),
      fs.mkdir(path.join(data, "log"), { recursive: true }),
    ])

    const env = {
      ...process.env,
      CODEPLANE_HOME_DIR: configDir,
      CODEPLANE_DATA_DIR: path.join(data, "data"),
      CODEPLANE_CACHE_DIR: path.join(data, "cache"),
      CODEPLANE_STATE_DIR: path.join(data, "state"),
      CODEPLANE_BIN_DIR: path.join(data, "bin"),
      CODEPLANE_LOG_DIR: path.join(data, "log"),
      XDG_DATA_HOME: path.join(data, "data"),
      XDG_CONFIG_HOME: path.join(data, "config"),
      XDG_CACHE_HOME: path.join(data, "cache"),
      XDG_STATE_HOME: path.join(data, "state"),
      HOME: process.env.HOME ?? os.homedir(),
    }

    log("local.start", { binary: binaryPath(input.binaryVersion), data, id: input.id })
    const child = spawn(
      binaryPath(input.binaryVersion),
      ["serve", "--hostname", "127.0.0.1", "--port", "0"],
      {
        cwd: data,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    )

    const stop = () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.killed) {
          resolve()
          return
        }
        const finalize = () => {
          running.delete(input.id)
          resolve()
        }
        child.once("exit", finalize)
        try {
          if (process.platform === "win32") {
            spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }).on("exit", () => undefined)
          } else {
            child.kill("SIGTERM")
            setTimeout(() => {
              if (child.exitCode === null && !child.killed) child.kill("SIGKILL")
            }, 4_000).unref()
          }
        } catch (error) {
          log("local.stop.error", { error, id: input.id })
          finalize()
        }
      })

    return new Promise<RunningLocalInstance>((resolve, reject) => {
      let resolved = false
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      const timer = setTimeout(() => {
        if (resolved) return
        resolved = true
        log("local.start.timeout", {
          id: input.id,
          stderr: stderrChunks.join(""),
          stdout: stdoutChunks.join(""),
        })
        void stop().finally(() =>
          reject(new Error(`Local Codeplane server did not start within ${SERVER_START_TIMEOUT_MS / 1000}s`)),
        )
      }, SERVER_START_TIMEOUT_MS)
      timer.unref()

      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString("utf8")
        stdoutChunks.push(text)
        log("local.stdout", { id: input.id, line: text.trim() })
        if (resolved) return
        const match = LISTEN_LINE_PATTERN.exec(text) || LISTEN_LINE_PATTERN.exec(stdoutChunks.join(""))
        if (!match) return
        const port = Number.parseInt(match[1] ?? "", 10)
        if (!Number.isFinite(port) || port <= 0) return
        resolved = true
        clearTimeout(timer)
        const url = `http://127.0.0.1:${port}`
        const managed: ManagedProcess = { child, port, stop, url }
        running.set(input.id, managed)
        log("local.start.ready", { id: input.id, port, url })
        resolve({ id: input.id, binaryVersion: input.binaryVersion, port, url })
      })

      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString("utf8")
        stderrChunks.push(text)
        log("local.stderr", { id: input.id, line: text.trim() })
      })

      child.on("error", (error) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        log("local.start.error", { error, id: input.id })
        reject(error)
      })

      child.on("exit", (code, signal) => {
        running.delete(input.id)
        if (resolved) {
          log("local.exit", { code, id: input.id, signal })
          return
        }
        resolved = true
        clearTimeout(timer)
        const stderr = stderrChunks.join("").trim()
        const message = stderr || `Local Codeplane process exited with code ${code ?? signal ?? "unknown"}`
        log("local.start.exit", { code, id: input.id, signal, stderr })
        reject(new Error(message))
      })
    })
  }

  async function stop(id: string) {
    const managed = running.get(id)
    if (!managed) return
    log("local.stop", { id })
    await managed.stop()
  }

  async function stopAll() {
    log("local.stopAll", { count: running.size })
    await Promise.all([...running.values()].map((managed) => managed.stop()))
  }

  function isRunning(id: string) {
    return running.has(id)
  }

  function getRunning(id: string): RunningLocalInstance | undefined {
    const managed = running.get(id)
    if (!managed) return undefined
    return { id, binaryVersion: "", port: managed.port, url: managed.url }
  }

  async function uninstall(version: string) {
    log("local.uninstall", { version })
    await fs.rm(versionRoot(version), { force: true, recursive: true })
  }

  async function removeData(id: string) {
    log("local.remove-data", { id })
    await fs.rm(dataDirFor(id), { force: true, recursive: true })
  }

  return {
    download,
    getRunning,
    isInstalled,
    isRunning,
    removeData,
    start,
    status,
    stop,
    stopAll,
    target,
    uninstall,
  }
}

export type LocalInstanceManager = ReturnType<typeof createLocalInstanceManager>
