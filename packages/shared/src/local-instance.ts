import { spawn, type ChildProcess } from "node:child_process"
import { createWriteStream } from "node:fs"
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
  extraEnv?(): Promise<Record<string, string | undefined>> | Record<string, string | undefined>
  debugLogging?(): Promise<boolean> | boolean
  // When true, every spawned local server is told CODEPLANE_DESKTOP_MANAGED=1
  // so its Installation.method() returns "desktop" and the in-instance
  // /global/upgrade route returns a "use the desktop's Updates panel"
  // error instead of trying to npm-install. The Desktop shell sets this
  // because its electron-updater owns the lifecycle of the local runtime
  // for instances it spawned. The TUI does NOT set this — its locally-
  // spawned servers should report a real install method (or the new
  // "managed-local" kind below) so the in-TUI Update Available flow can
  // do the right thing.
  desktopManaged?: boolean
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
    const tail = next.catch(() => undefined)
    tails.set(key, tail)
    try {
      return await next
    } finally {
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
}

type ProcessLog = {
  close(): void
  write(source: string, text: string): void
  writeHeader(data: Record<string, unknown>): void
}

function createProcessLog(dir: string, id: string): ProcessLog {
  const stream = createWriteStream(path.join(dir, "process.log"), { flags: "a" })
  let closed = false
  stream.on("error", () => {
    closed = true
  })
  const safeWrite = (text: string) => {
    if (closed) return
    stream.write(text)
  }
  return {
    close() {
      if (closed) return
      closed = true
      stream.end(`${new Date().toISOString()} process log-end id=${id}\n`)
    },
    write(source, text) {
      safeWrite(`${new Date().toISOString()} ${source} ${text}`)
    },
    writeHeader(data) {
      safeWrite(`\n${new Date().toISOString()} process log-start id=${id} ${JSON.stringify(data)}\n`)
    },
  }
}

export function createLocalInstanceManager(config: LocalInstanceManagerInput) {
  const log = (event: string, data?: unknown) => config.log?.(event, data)
  const target = resolveCodeplaneLocalTarget()
  const running = new Map<string, ManagedProcess>()
  const lock = createKeyedLock()

  const versionRoot = (version: string) => path.join(config.binariesDir, version)
  const expectedBinaryPath = (version: string) => path.join(versionRoot(version), "bin", target.binaryName)
  const resolveBinary = (version: string) => resolveLocalBinaryPath(versionRoot(version), target.binaryName)
  const dataDirFor = (id: string) => path.join(config.dataDir, id)
  const logDirFor = (id: string) => path.join(dataDirFor(id), "log")
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

  function activeManaged(id: string) {
    const managed = running.get(id)
    if (!managed) return undefined
    if (managed.child.exitCode === null && !managed.child.killed) return managed
    running.delete(id)
  }

  async function start(
    input: { id: string; binaryVersion: string },
    progress?: (info: LocalInstanceProgress) => void,
  ): Promise<RunningLocalInstance> {
    return lock(`start:${input.id}`, async () => {
      const existing = activeManaged(input.id)
      if (existing) {
        if (existing.binaryVersion === input.binaryVersion) {
          return {
            id: input.id,
            binaryVersion: existing.binaryVersion,
            port: existing.port,
            url: existing.url,
          }
        }
        log("local.start.version-mismatch", {
          id: input.id,
          requestedVersion: input.binaryVersion,
          runningVersion: existing.binaryVersion,
        })
        progress?.({
          version: input.binaryVersion,
          phase: "start",
          message: `Restarting local Codeplane ${existing.binaryVersion} as ${input.binaryVersion}…`,
          percent: 4,
          binaryVersion: input.binaryVersion,
        })
        await existing.stop()
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
      const logDir = logDirFor(input.id)
      const instanceConfig = configDirFor(input.id)
      await Promise.all([
        fs.mkdir(path.join(data, "data"), { recursive: true }),
        fs.mkdir(instanceConfig, { recursive: true }),
        fs.mkdir(path.join(data, "cache"), { recursive: true }),
        fs.mkdir(path.join(data, "state"), { recursive: true }),
        fs.mkdir(path.join(data, "bin"), { recursive: true }),
        fs.mkdir(logDir, { recursive: true }),
      ])

      const debugLogging = (await config.debugLogging?.()) === true
      const env: Record<string, string | undefined> = {
        ...process.env,
        CODEPLANE_HOME_DIR: instanceConfig,
        CODEPLANE_DATA_DIR: path.join(data, "data"),
        CODEPLANE_CACHE_DIR: path.join(data, "cache"),
        CODEPLANE_STATE_DIR: path.join(data, "state"),
        CODEPLANE_BIN_DIR: path.join(data, "bin"),
        CODEPLANE_LOG_DIR: logDir,
        XDG_DATA_HOME: path.join(data, "data"),
        XDG_CONFIG_HOME: path.join(data, "config"),
        XDG_CACHE_HOME: path.join(data, "cache"),
        XDG_STATE_HOME: path.join(data, "state"),
        HOME: process.env.HOME ?? os.homedir(),
      }
      if (debugLogging) env.CODEPLANE_LOG_LEVEL = "DEBUG"
      if (config.desktopManaged === false) {
        // Explicit non-desktop manager (e.g. TUI). Make sure any inherited
        // CODEPLANE_DESKTOP_MANAGED from the parent process doesn't leak in.
        delete env.CODEPLANE_DESKTOP_MANAGED
      } else if (config.desktopManaged) {
        // Tell the spawned server it is managed by the desktop shell so
        // its install-method detection reports "desktop" — the in-instance
        // settings UI then shows the desktop-managed update message instead
        // of "automatic updates unavailable".
        env.CODEPLANE_DESKTOP_MANAGED = "1"
        // Tell the spawned server it runs inside the desktop app so
        // desktop-only tools (browser, etc.) are available.
        env.CODEPLANE_CLIENT = "app"
      }
      // Tell the spawned server which manager (if any) owns its update
      // lifecycle. The /global/upgrade route reads this to short-circuit
      // with a precise instruction for the TUI / Desktop instead of
      // trying to npm-install when there's no global npm install to
      // upgrade in the first place.
      env.CODEPLANE_MANAGED_BY = config.desktopManaged ? "desktop" : "tui"
      const extraEnv = await config.extraEnv?.()
      if (extraEnv) Object.assign(env, extraEnv)

      // Spawn from the user's home, not the per-instance data dir. The picker
      // seeds itself from the server's process.cwd(), so anchoring at $HOME
      // gives the user a sensible starting point instead of dropping them
      // inside Codeplane's own Application Support folder. Storage paths are
      // already plumbed through CODEPLANE_* env vars above.
      const home = process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || os.homedir()
      const args = [
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        "0",
        ...(debugLogging ? ["--log-level", "DEBUG"] : []),
      ]
      log("local.start", { args, binary, cwd: home, data, debugLogging, id: input.id })
      const processLog = createProcessLog(logDir, input.id)
      processLog.writeHeader({
        args,
        binary,
        cwd: home,
        data,
        debugLogging,
        version: input.binaryVersion,
      })
      const child = spawn(binary, args, {
        cwd: home,
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
          let finalized = false
          const finalize = () => {
            if (finalized) return
            finalized = true
            clearTimeout(forceKillTimer)
            running.delete(input.id)
            processLog.close()
            resolve()
          }
          const forceKillTimer = setTimeout(() => {
            try {
              child.kill("SIGKILL")
            } catch {}
            finalize()
          }, SHUTDOWN_GRACE_MS)
          forceKillTimer.unref()
          child.once("exit", finalize)
          try {
            if (process.platform === "win32") {
              spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }).on("exit", () => undefined)
              return
            }
            child.kill("SIGTERM")
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
          processLog.write("stdout", text)
          log("local.stdout", { id: input.id, line: text.trim() })
          if (settled) return
          let port = findListeningPort(text)
          if (port === undefined) {
            port = findListeningPort(stdoutChunks.join(""))
          }
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
          processLog.write("stderr", text)
          log("local.stderr", { id: input.id, line: text.trim() })
        })

        child.on("error", (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          processLog.write("process", `error ${error instanceof Error ? error.stack || error.message : String(error)}\n`)
          processLog.close()
          log("local.start.error", { error, id: input.id })
          reject(error)
        })

        child.on("exit", (code, signal) => {
          running.delete(input.id)
          processLog.write("process", `exit code=${code ?? ""} signal=${signal ?? ""}\n`)
          processLog.close()
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
    const managed = activeManaged(id)
    if (!managed) return
    log("local.stop", { id })
    await managed.stop()
  }

  async function stopAll() {
    log("local.stopAll", { count: running.size })
    await Promise.all([...running.values()].map((managed) => managed.stop()))
  }

  function isRunning(id: string) {
    return !!activeManaged(id)
  }

  function getRunning(id: string): RunningLocalInstance | undefined {
    const managed = activeManaged(id)
    if (!managed) return undefined
    return { id, binaryVersion: managed.binaryVersion, port: managed.port, url: managed.url }
  }

  function listRunning(): RunningLocalInstance[] {
    return [...running.entries()].flatMap(([id]) => {
      const managed = activeManaged(id)
      if (!managed) return []
      return [{ id, binaryVersion: managed.binaryVersion, port: managed.port, url: managed.url }]
    })
  }

  function logDir(id: string) {
    return logDirFor(id)
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
    logDir,
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
