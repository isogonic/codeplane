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
  if (process.arch === "arm64") return "arm64"
  return "x64"
}

function detectOs(): "darwin" | "linux" | "windows" {
  if (process.platform === "darwin") return "darwin"
  if (process.platform === "win32") return "windows"
  return "linux"
}

function detectMusl() {
  if (detectOs() !== "linux") return false
  return import("node:fs")
    .then((value) => value.existsSync("/etc/alpine-release"))
    .catch(() => false)
    .then((alpine) => {
      if (alpine) return true
      return spawnSync("ldd", ["--version"], { encoding: "utf8" })
    })
    .then((result) => {
      if (result === true) return true
      const text = ((result.stdout || "") + (result.stderr || "")).toLowerCase()
      return text.includes("musl")
    })
    .catch(() => false)
}

function detectAvx2() {
  if (detectArch() !== "x64") return Promise.resolve(true)
  const platform = detectOs()

  if (platform === "darwin") {
    return Promise.resolve(
      spawnSync("sysctl", ["-n", "hw.optional.avx2_0"], { encoding: "utf8", timeout: 1500 }).stdout.trim() === "1",
    ).catch(() => false)
  }

  if (platform === "linux") {
    return fs
      .readFile("/proc/cpuinfo", "utf8")
      .then((cpuinfo) => /(?:^|\s)avx2(?:\s|$)/i.test(cpuinfo))
      .catch(() => false)
  }

  if (platform === "windows") {
    const cmd =
      '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'
    const exes = ["powershell.exe", "pwsh.exe", "pwsh", "powershell"]
    const next = exes.reduce(
      (promise, exe) =>
        promise.then((value) => {
          if (value !== undefined) return value
          const result = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", cmd], {
            encoding: "utf8",
            timeout: 3000,
            windowsHide: true,
          })
          if (result.status !== 0) return undefined
          const out = (result.stdout || "").trim().toLowerCase()
          if (out === "true" || out === "1") return true
          if (out === "false" || out === "0") return false
        }),
      Promise.resolve<boolean | undefined>(undefined),
    )
    return next.then((value) => value ?? false).catch(() => false)
  }

  return Promise.resolve(false)
}

export type LocalTarget = {
  archiveName: string
  archiveExt: ".zip" | ".tar.gz"
  binaryName: string
  os: "darwin" | "linux" | "windows"
  arch: "x64" | "arm64"
}

export async function resolveLocalTarget(): Promise<LocalTarget> {
  const arch = detectArch()
  const platform = detectOs()
  const isMusl = await detectMusl()
  const baseline = arch === "x64" && !(await detectAvx2())

  let suffix = `${platform}-${arch}`
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
  const dataDirFor = (id: string) => path.join(input.dataDir, "local-data", id)

  async function binaryPath(version: string) {
    return path.join(versionRoot(version), (await target).binaryName)
  }

  async function archivePath(version: string) {
    return path.join(versionRoot(version), (await target).archiveName)
  }

  const exists = (file: string) => fs.access(file).then(() => true).catch(() => false)

  async function isInstalled(version: string) {
    return exists(await binaryPath(version))
  }

  async function status(version: string): Promise<LocalInstanceStatus> {
    return {
      archive: (await target).archiveName,
      binaryPath: await binaryPath(version),
      binaryVersion: version,
      installed: await isInstalled(version),
    }
  }

  async function extractArchive(archive: string, dest: string) {
    const resolved = await target
    if (resolved.archiveExt === ".tar.gz") {
      await runTool("tar", ["-xzf", archive, "-C", dest])
      return
    }
    if (resolved.os === "windows") {
      await runTool("tar", ["-xf", archive, "-C", dest])
      return
    }
    await runTool("unzip", ["-q", "-o", archive, "-d", dest])
  }

  function runTool(command: string, args: string[]) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: "ignore" })
      child.on("error", reject)
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? signal ?? "unknown"}`))
      })
    })
  }

  async function download(version: string, progress?: (info: LocalInstanceProgress) => void): Promise<LocalInstanceStatus> {
    const resolved = await target
    progress?.({
      phase: "detect",
      message: `Detected ${resolved.os}/${resolved.arch}. Preparing local Codeplane ${version}…`,
      percent: 4,
      binaryVersion: version,
    })
    log("local.download.start", { archive: resolved.archiveName, version })

    const root = versionRoot(version)
    if (await isInstalled(version)) {
      progress?.({
        phase: "ready",
        message: `Codeplane ${version} is already installed locally.`,
        percent: 100,
        binaryVersion: version,
      })
      return status(version)
    }

    await fs.mkdir(root, { recursive: true })
    const archive = await archivePath(version)
    const tag = codeplaneReleaseTag(version)
    const url = `${GITHUB_RELEASE_DOWNLOAD_URL}/${tag}/${resolved.archiveName}`

    progress?.({
      phase: "download",
      message: `Downloading Codeplane ${version} for ${resolved.os}/${resolved.arch}…`,
      percent: 6,
      binaryVersion: version,
    })

    const response = await fetch(url, { redirect: "follow" })
    if (!response.ok) {
      throw new Error(`Local Codeplane download failed with HTTP ${response.status} (${url})`)
    }
    if (!response.body) {
      throw new Error(`Local Codeplane download for ${url} returned an empty body`)
    }

    const total = Number(response.headers.get("content-length") ?? "0")
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

    progress?.({
      phase: "extract",
      message: "Extracting binary…",
      percent: 86,
      binaryVersion: version,
    })
    await extractArchive(archive, root)
    if (resolved.os !== "windows") {
      await fs.chmod(await binaryPath(version), 0o755).catch(() => undefined)
    }
    await fs.rm(archive, { force: true })
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
      XDG_DATA_HOME: path.join(data, "data"),
      XDG_CONFIG_HOME: path.join(data, "config"),
      XDG_CACHE_HOME: path.join(data, "cache"),
      XDG_STATE_HOME: path.join(data, "state"),
      HOME: process.env.HOME ?? os.homedir(),
    }

    const child = spawn(await binaryPath(input.binaryVersion), ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
      cwd: data,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })

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
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }).on("exit", () => undefined)
          return
        }
        child.kill("SIGTERM")
        setTimeout(() => {
          if (child.exitCode === null && !child.killed) child.kill("SIGKILL")
        }, 4_000).unref()
      })

    return new Promise<RunningLocalInstance>((resolve, reject) => {
      let resolved = false
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      const timer = setTimeout(() => {
        if (resolved) return
        resolved = true
        void stop().finally(() =>
          reject(new Error(`Local Codeplane server did not start within ${SERVER_START_TIMEOUT_MS / 1000}s`)),
        )
      }, SERVER_START_TIMEOUT_MS)
      timer.unref()

      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString("utf8")
        stdoutChunks.push(text)
        const match = LISTEN_LINE_PATTERN.exec(text) || LISTEN_LINE_PATTERN.exec(stdoutChunks.join(""))
        if (!match || resolved) return
        const port = Number.parseInt(match[1] ?? "", 10)
        if (!Number.isFinite(port) || port <= 0) return
        resolved = true
        clearTimeout(timer)
        const url = `http://127.0.0.1:${port}`
        running.set(input.id, { child, port, stop, url })
        resolve({ id: input.id, binaryVersion: input.binaryVersion, port, url })
      })

      child.stderr?.on("data", (data: Buffer) => {
        stderrChunks.push(data.toString("utf8"))
      })

      child.on("error", (error) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        reject(error)
      })

      child.on("exit", (code, signal) => {
        running.delete(input.id)
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        reject(new Error(stderrChunks.join("").trim() || `Local Codeplane process exited with code ${code ?? signal ?? "unknown"}`))
      })
    })
  }

  async function stop(id: string) {
    const managed = running.get(id)
    if (!managed) return
    await managed.stop()
  }

  async function stopAll() {
    await Promise.all([...running.values()].map((managed) => managed.stop()))
  }

  function isRunning(id: string) {
    return running.has(id)
  }

  function getRunning(id: string) {
    const managed = running.get(id)
    if (!managed) return
    return { id, binaryVersion: "", port: managed.port, url: managed.url }
  }

  async function uninstall(version: string) {
    await fs.rm(versionRoot(version), { force: true, recursive: true })
  }

  async function removeData(id: string) {
    await fs.rm(dataDirFor(id), { force: true, recursive: true })
  }

  return {
    download,
    getRunning,
    isInstalled,
    isRunning,
    removeData,
    resolveTarget: () => target,
    start,
    status,
    stop,
    stopAll,
    uninstall,
  }
}

export type LocalInstanceManager = ReturnType<typeof createLocalInstanceManager>
