import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  installCodeplaneLocalPackage,
  installManagedCodeplaneCli,
  managedCodeplaneCliStatus,
  resolveCodeplaneLocalTarget,
  resolveLocalBinaryPath,
} from "./local-runtime"
import type { LocalInstallProgress, LocalStatus } from "./instance"

const LISTEN_LINE_PATTERNS = [
  /listening on https?:\/\/[^:\s]+:(\d+)/i,
  /listening at https?:\/\/[^:\s]+:(\d+)/i,
  /server (?:started|ready) (?:on|at) https?:\/\/[^:\s]+:(\d+)/i,
] as const
const SERVER_START_TIMEOUT_MS = 30_000
const SHUTDOWN_GRACE_MS = Number(process.env.CODEPLANE_LOCAL_SHUTDOWN_GRACE_MS) || 4_000

export type LocalInstanceProgress = LocalInstallProgress

export type LocalInstanceStatus = LocalStatus

export type RunningLocalInstance = {
  id: string
  binaryVersion: string
  port: number
  url: string
}

type ManagedProcess = {
  binaryVersion: string
  child: ChildProcess
  port: number
  startedAt: number
  url: string
  stop: () => Promise<void>
}

export type LocalInstanceManagerInput = {
  binariesDir: string
  configDir: string
  dataDir: string
  log?(event: string, data?: unknown): void
}

export function findListeningPort(text: string) {
  for (const pattern of LISTEN_LINE_PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue
    const port = Number.parseInt(match[1] ?? "", 10)
    if (Number.isFinite(port) && port > 0) return port
  }
}

// Coordinates async work that must not run concurrently for a given key.
function createKeyedLock() {
  const tails = new Map<string, Promise<unknown>>()
  return async function lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(fn)
    tails.set(
      key,
      next.catch(() => undefined),
    )
    try {
      return await next
    } finally {
      // Clear only if no later caller already replaced us.
      const current = tails.get(key)
      if (current === next || (current as unknown) === next.catch(() => undefined)) tails.delete(key)
    }
  }
}

export function createLocalInstanceManager(input: LocalInstanceManagerInput) {
  const log = (event: string, data?: unknown) => input.log?.(event, data)
  const target = resolveCodeplaneLocalTarget()
  const running = new Map<string, ManagedProcess>()
  const lock = createKeyedLock()

  const versionRoot = (version: string) => path.join(input.binariesDir, version)
  const expectedBinaryPath = (version: string) => path.join(versionRoot(version), "bin", target.binaryName)
  const resolveBinary = (version: string) => resolveLocalBinaryPath(versionRoot(version), target.binaryName)
  const dataDirFor = (id: string) => path.join(input.dataDir, id)
  // Each local instance gets its own config dir so concurrent locals don't
  // clobber each other's codeplane.json. Falls back to the shared root when
  // the per-instance dir doesn't exist yet — it's created on start().
  const configDirFor = (id: string) => path.join(dataDirFor(id), "config")

  async function isInstalled(version: string) {
    return !!(await resolveBinary(version))
  }

  async function status(version: string): Promise<LocalInstanceStatus> {
    const cli = await managedCodeplaneCliStatus()
    const resolved = await resolveBinary(version)
    return {
      archive: target.archiveName,
      binaryPath: resolved ?? expectedBinaryPath(version),
      binaryVersion: version,
      installed: !!resolved,
      cliInstalled: cli.cliInstalled,
      cliPath: cli.cliPath,
    }
  }

  async function ensureCli(version: string, binary: string) {
    const cli = await managedCodeplaneCliStatus()
    if (cli.cliInstalled && cli.cliVersion === version) return cli
    return installManagedCodeplaneCli({ version, binaryPath: binary })
  }

  async function download(version: string, progress?: (info: LocalInstanceProgress) => void): Promise<LocalInstanceStatus> {
    return lock(`download:${version}`, async () => {
      log("local.download.start", { archive: target.archiveName, version })
      const startedAt = Date.now()
      const root = versionRoot(version)
      const cached = await resolveBinary(version)
      if (cached) {
        log("local.download.cached", { binary: cached, version })
        await ensureCli(version, cached)
        progress?.({
          version,
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
      const installed = await resolveBinary(version)
      if (!installed) {
        throw new Error(`Codeplane ${version} download finished but binary was not found in ${root}`)
      }
      await ensureCli(version, installed)
      log("local.download.success", {
        binary: installed,
        durationMs: Date.now() - startedAt,
        packageName: target.packageName,
        version,
      })
      return status(version)
    })
  }

  async function start(
    input: { id: string; binaryVersion: string },
    progress?: (info: LocalInstanceProgress) => void,
  ): Promise<RunningLocalInstance> {
    return lock(`start:${input.id}`, async () => {
      const existing = running.get(input.id)
      if (existing) {
        return {
          id: input.id,
          binaryVersion: existing.binaryVersion,
          port: existing.port,
          url: existing.url,
        }
      }

      let binary = await resolveBinary(input.binaryVersion)
      if (!binary) {
        log("local.start.auto-download", { version: input.binaryVersion })
        try {
          await download(input.binaryVersion, (next) => progress?.(next))
        } catch (cause) {
          throw new Error(
            `Codeplane ${input.binaryVersion} could not be installed: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
          )
        }
        binary = await resolveBinary(input.binaryVersion)
        if (!binary) {
          throw new Error(`Codeplane ${input.binaryVersion} download finished but binary was not found`)
        }
      }
      if (target.os !== "windows") {
        await fs.chmod(binary, 0o755).catch(() => undefined)
      }
      await ensureCli(input.binaryVersion, binary)

      const data = dataDirFor(input.id)
      const instanceConfig = configDirFor(input.id)
      await Promise.all([
        fs.mkdir(path.join(data, "data"), { recursive: true }),
        fs.mkdir(instanceConfig, { recursive: true }),
        fs.mkdir(path.join(data, "cache"), { recursive: true }),
        fs.mkdir(path.join(data, "state"), { recursive: true }),
        fs.mkdir(path.join(data, "bin"), { recursive: true }),
        fs.mkdir(path.join(data, "log"), { recursive: true }),
      ])

      const env = {
        ...process.env,
        CODEPLANE_HOME_DIR: instanceConfig,
        CODEPLANE_DATA_DIR: path.join(data, "data"),
        CODEPLANE_CACHE_DIR: path.join(data, "cache"),
        CODEPLANE_STATE_DIR: path.join(data, "state"),
        CODEPLANE_BIN_DIR: path.join(data, "bin"),
        CODEPLANE_LOG_DIR: path.join(data, "log"),
        // Tell the spawned server it is managed by the desktop shell so
        // its install-method detection reports "desktop" — the in-instance
        // settings UI then shows the desktop-managed update message instead
        // of "automatic updates unavailable".
        CODEPLANE_DESKTOP_MANAGED: "1",
        XDG_DATA_HOME: path.join(data, "data"),
        XDG_CONFIG_HOME: path.join(data, "config"),
        XDG_CACHE_HOME: path.join(data, "cache"),
        XDG_STATE_HOME: path.join(data, "state"),
        HOME: process.env.HOME ?? os.homedir(),
      }

      log("local.start", { binary, data, id: input.id })
      const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
        cwd: data,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })

      const stop = () =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.killed) {
            running.delete(input.id)
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
              return
            }
            child.kill("SIGTERM")
            setTimeout(() => {
              if (child.exitCode === null && !child.killed) child.kill("SIGKILL")
            }, SHUTDOWN_GRACE_MS).unref()
          } catch (error) {
            log("local.stop.error", { error, id: input.id })
            finalize()
          }
        })

      progress?.({
        version: input.binaryVersion,
        phase: "start",
        message: `Starting local Codeplane ${input.binaryVersion}…`,
        percent: 96,
        binaryVersion: input.binaryVersion,
      })

      return new Promise<RunningLocalInstance>((resolveListening, reject) => {
        let settled = false
        const stdoutChunks: string[] = []
        const stderrChunks: string[] = []
        const finishWithError = (message: string) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          void stop().finally(() => reject(new Error(message)))
        }
        const timer = setTimeout(() => {
          if (settled) return
          const detail = stderrChunks.join("").trim() || stdoutChunks.join("").trim()
          log("local.start.timeout", {
            id: input.id,
            stderr: stderrChunks.join(""),
            stdout: stdoutChunks.join(""),
          })
          finishWithError(
            detail
              ? `Local Codeplane server did not start within ${SERVER_START_TIMEOUT_MS / 1000}s: ${detail}`
              : `Local Codeplane server did not start within ${SERVER_START_TIMEOUT_MS / 1000}s`,
          )
        }, SERVER_START_TIMEOUT_MS)
        timer.unref()

        child.stdout?.on("data", (data: Buffer) => {
          const text = data.toString("utf8")
          stdoutChunks.push(text)
          log("local.stdout", { id: input.id, line: text.trim() })
          if (settled) return
          const port = findListeningPort(text) ?? findListeningPort(stdoutChunks.join(""))
          if (port === undefined) return
          settled = true
          clearTimeout(timer)
          const url = `http://127.0.0.1:${port}`
          const managed: ManagedProcess = {
            binaryVersion: input.binaryVersion,
            child,
            port,
            startedAt: Date.now(),
            stop,
            url,
          }
          running.set(input.id, managed)
          log("local.start.ready", { id: input.id, port, url })
          progress?.({
            version: input.binaryVersion,
            phase: "ready",
            message: `Local Codeplane ${input.binaryVersion} is listening on ${url}.`,
            percent: 100,
            binaryVersion: input.binaryVersion,
          })
          resolveListening({ id: input.id, binaryVersion: input.binaryVersion, port, url })
        })

        child.stderr?.on("data", (data: Buffer) => {
          const text = data.toString("utf8")
          stderrChunks.push(text)
          log("local.stderr", { id: input.id, line: text.trim() })
        })

        child.on("error", (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          log("local.start.error", { error, id: input.id })
          reject(error)
        })

        child.on("exit", (code, signal) => {
          running.delete(input.id)
          if (settled) {
            log("local.exit", { code, id: input.id, signal })
            return
          }
          const stderr = stderrChunks.join("").trim()
          const stdout = stdoutChunks.join("").trim()
          const detail = stderr || stdout
          log("local.start.exit", { code, id: input.id, signal, stderr })
          finishWithError(
            detail
              ? `Local Codeplane (${binary}) exited with code ${code ?? signal ?? "unknown"}: ${detail}`
              : `Local Codeplane (${binary}) exited with code ${code ?? signal ?? "unknown"}`,
          )
        })
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
    return { id, binaryVersion: managed.binaryVersion, port: managed.port, url: managed.url }
  }

  function listRunning(): RunningLocalInstance[] {
    return [...running.entries()].map(([id, managed]) => ({
      id,
      binaryVersion: managed.binaryVersion,
      port: managed.port,
      url: managed.url,
    }))
  }

  async function restart(
    input: { id: string; binaryVersion: string },
    progress?: (info: LocalInstanceProgress) => void,
  ): Promise<RunningLocalInstance> {
    await stop(input.id)
    return start(input, progress)
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
    listRunning,
    removeData,
    resolveTarget: async () => target,
    restart,
    start,
    status,
    stop,
    stopAll,
    target,
    uninstall,
  }
}

export type LocalInstanceManager = ReturnType<typeof createLocalInstanceManager>
