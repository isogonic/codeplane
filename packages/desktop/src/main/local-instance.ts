import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import { createWriteStream } from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { pipeline } from "node:stream/promises"
import os from "node:os"
import { codeplaneReleaseTag } from "@codeplane-ai/shared/version"

const GITHUB_RELEASE_DOWNLOAD_URL = "https://github.com/devinoldenburg/codeplane/releases/download"
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

function detectArch(): "x64" | "arm64" {
  const arch = process.arch
  if (arch === "arm64") return "arm64"
  return "x64"
}

function detectOs(): "darwin" | "linux" | "windows" {
  if (process.platform === "darwin") return "darwin"
  if (process.platform === "win32") return "windows"
  return "linux"
}

function detectMusl(): boolean {
  if (detectOs() !== "linux") return false
  try {
    if (require("node:fs").existsSync("/etc/alpine-release")) return true
  } catch {
    // ignore
  }
  try {
    const result = spawnSync("ldd", ["--version"], { encoding: "utf8" })
    const text = ((result.stdout || "") + (result.stderr || "")).toLowerCase()
    if (text.includes("musl")) return true
  } catch {
    // ignore
  }
  return false
}

function detectAvx2(): boolean {
  if (detectArch() !== "x64") return true
  const platform = detectOs()

  if (platform === "darwin") {
    try {
      const result = spawnSync("sysctl", ["-n", "hw.optional.avx2_0"], { encoding: "utf8", timeout: 1500 })
      if (result.status !== 0) return false
      return (result.stdout || "").trim() === "1"
    } catch {
      return false
    }
  }

  if (platform === "linux") {
    try {
      const cpuinfo = require("node:fs").readFileSync("/proc/cpuinfo", "utf8") as string
      return /(?:^|\s)avx2(?:\s|$)/i.test(cpuinfo)
    } catch {
      return false
    }
  }

  if (platform === "windows") {
    const cmd =
      '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'
    for (const exe of ["powershell.exe", "pwsh.exe", "pwsh", "powershell"]) {
      try {
        const result = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", cmd], {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
        })
        if (result.status !== 0) continue
        const out = (result.stdout || "").trim().toLowerCase()
        if (out === "true" || out === "1") return true
        if (out === "false" || out === "0") return false
      } catch {
        continue
      }
    }
    return false
  }

  return false
}

export type LocalTarget = {
  archiveName: string
  archiveExt: ".zip" | ".tar.gz"
  binaryName: string
  os: "darwin" | "linux" | "windows"
  arch: "x64" | "arm64"
}

export function resolveLocalTarget(): LocalTarget {
  const arch = detectArch()
  const platform = detectOs()
  const isMusl = detectMusl()
  const baseline = arch === "x64" && !detectAvx2()

  let suffix: string = `${platform}-${arch}`
  if (baseline) suffix += "-baseline"
  if (isMusl) suffix += "-musl"

  const archiveExt = platform === "linux" ? ".tar.gz" : ".zip"
  return {
    archiveName: `codeplane-${suffix}${archiveExt}`,
    archiveExt,
    binaryName: platform === "windows" ? "codeplane.exe" : "codeplane",
    os: platform,
    arch,
  }
}

export function createLocalInstanceManager(input: {
  binariesDir: string
  dataDir: string
  log?(event: string, data?: unknown): void
}) {
  const log = (event: string, data?: unknown) => input.log?.(event, data)
  const target = resolveLocalTarget()
  const running = new Map<string, ManagedProcess>()

  const versionRoot = (version: string) => path.join(input.binariesDir, version)
  const binaryPath = (version: string) => path.join(versionRoot(version), target.binaryName)
  const archivePath = (version: string) => path.join(versionRoot(version), target.archiveName)
  const dataDirFor = (id: string) => path.join(input.dataDir, "local-data", id)

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
    return {
      archive: target.archiveName,
      binaryPath: binaryPath(version),
      binaryVersion: version,
      installed: await isInstalled(version),
    }
  }

  async function extractArchive(archive: string, dest: string) {
    if (target.archiveExt === ".tar.gz") {
      await runTool("tar", ["-xzf", archive, "-C", dest])
      return
    }
    if (target.os === "windows") {
      // Windows 10+ ships bsdtar, which extracts both .zip and .tar formats.
      await runTool("tar", ["-xf", archive, "-C", dest])
      return
    }
    await runTool("unzip", ["-q", "-o", archive, "-d", dest])
  }

  function runTool(command: string, args: string[]) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: "ignore" })
      child.on("error", (error) => reject(error))
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? signal ?? "unknown"}`))
      })
    })
  }

  async function download(
    version: string,
    progress?: (info: LocalInstanceProgress) => void,
  ): Promise<LocalInstanceStatus> {
    progress?.({
      phase: "detect",
      message: `Detected ${target.os}/${target.arch}. Preparing local Codeplane ${version}…`,
      percent: 4,
      binaryVersion: version,
    })
    log("local.download.start", { archive: target.archiveName, version })

    const root = versionRoot(version)
    if (await isInstalled(version)) {
      log("local.download.cached", { binary: binaryPath(version), version })
      progress?.({
        phase: "ready",
        message: `Codeplane ${version} is already installed locally.`,
        percent: 100,
        binaryVersion: version,
      })
      return status(version)
    }

    await fs.mkdir(root, { recursive: true })
    const archive = archivePath(version)
    const tag = codeplaneReleaseTag(version)
    const url = `${GITHUB_RELEASE_DOWNLOAD_URL}/${tag}/${target.archiveName}`

    progress?.({
      phase: "download",
      message: `Downloading Codeplane ${version} for ${target.os}/${target.arch}…`,
      percent: 6,
      binaryVersion: version,
    })

    const response = await fetch(url, { redirect: "follow" })
    if (!response.ok) {
      throw new Error(`Local Codeplane download failed with HTTP ${response.status} (${url})`)
    }
    const total = Number(response.headers.get("content-length") ?? "0")
    if (!response.body) {
      throw new Error(`Local Codeplane download for ${url} returned an empty body`)
    }
    const tempArchive = `${archive}.tmp-${Date.now()}`
    let received = 0
    const stream = Readable.fromWeb(response.body as unknown as NodeReadableStream)
    stream.on("data", (chunk: Buffer) => {
      received += chunk.length
      progress?.({
        phase: "download",
        message: `Downloading Codeplane ${version}…`,
        percent: total > 0 ? Math.min(80, 8 + Math.round((received / total) * 70)) : 40,
        transferred: received,
        total: total || undefined,
        binaryVersion: version,
      })
    })
    await pipeline(stream, createWriteStream(tempArchive))
    await fs.rename(tempArchive, archive)
    log("local.download.success", { archive, bytes: received, version })

    progress?.({
      phase: "extract",
      message: "Extracting binary…",
      percent: 86,
      binaryVersion: version,
    })
    await extractArchive(archive, root)
    if (target.os !== "windows") {
      try {
        await fs.chmod(binaryPath(version), 0o755)
      } catch (error) {
        log("local.chmod.error", { error, version })
      }
    }
    await fs.rm(archive, { force: true })
    log("local.extract.success", { binary: binaryPath(version), version })
    progress?.({
      phase: "ready",
      message: `Codeplane ${version} ready locally.`,
      percent: 100,
      binaryVersion: version,
    })
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

    const data = dataDirFor(input.id)
    await Promise.all([
      fs.mkdir(path.join(data, "data"), { recursive: true }),
      fs.mkdir(path.join(data, "config"), { recursive: true }),
      fs.mkdir(path.join(data, "cache"), { recursive: true }),
      fs.mkdir(path.join(data, "state"), { recursive: true }),
    ])

    const env = {
      ...process.env,
      // Pin the local binary's XDG paths to the desktop user-data so each
      // local instance has its own isolated state, and uninstalling the
      // desktop app cleans up after itself.
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
