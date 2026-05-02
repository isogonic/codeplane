import { spawn, spawnSync } from "node:child_process"
import { createWriteStream } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { CodeplaneHome } from "./home"
import { CodeplaneVersion } from "./version"
import type { LocalInstallProgress, LocalTarget } from "./instance"

const CONFIG_FILES = ["codeplane.jsonc", "codeplane.json", "config.json"] as const
const cleanVersion = (value: string) => value.trim().replace(/^v/, "")
const localVersionFile = () => path.join(CodeplaneHome.paths().local_server, "default-version")
const localCliVersionFile = () => path.join(CodeplaneHome.paths().bin, ".codeplane-version")

type RegistryConfig = {
  registry: string
  token?: string
  alwaysAuth?: boolean
}

function normalizeRegistry(value: string | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return "https://registry.npmjs.org/"
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
}

function stripJsonComments(raw: string) {
  let output = ""
  let inString = false
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    const next = raw[index + 1]

    if (lineComment) {
      if (char === "\n") {
        lineComment = false
        output += char
      }
      continue
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false
        index++
        continue
      }
      if (char === "\n") output += char
      continue
    }

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === "\"") inString = false
      continue
    }

    if (char === "\"") {
      inString = true
      output += char
      continue
    }

    if (char === "/" && next === "/") {
      lineComment = true
      index++
      continue
    }

    if (char === "/" && next === "*") {
      blockComment = true
      index++
      continue
    }

    output += char
  }

  return output
}

function parseConfig(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {}
  try {
    return JSON.parse(
      stripJsonComments(raw).replace(/,\s*([}\]])/g, "$1"),
    ) as Record<string, unknown>
  } catch {}
}

async function readConfigRegistry() {
  for (const name of CONFIG_FILES) {
    const file = path.join(CodeplaneHome.paths().config, name)
    const raw = await fs.readFile(file, "utf8").catch(() => "")
    if (!raw.trim()) continue
    try {
      const payload = parseConfig(raw)
      if (!payload || typeof payload !== "object" || !("npm" in payload)) continue
      const npm = payload.npm as Record<string, unknown>
      if (!npm || typeof npm !== "object") continue
      return {
        registry: normalizeRegistry(typeof npm.registry === "string" ? npm.registry : undefined),
        token: typeof npm.token === "string" ? npm.token.trim() || undefined : undefined,
        alwaysAuth: npm.always_auth === true,
      } satisfies RegistryConfig
    } catch {}
  }
}

async function npmRegistry() {
  const config = await readConfigRegistry()
  if (config) return config
  return {
    registry: normalizeRegistry(process.env.CODEPLANE_NPM_REGISTRY?.trim() || process.env.npm_config_registry?.trim()),
    token: undefined,
    alwaysAuth: undefined,
  } satisfies RegistryConfig
}

const registryPath = (name: string) => {
  if (!name.startsWith("@")) return name
  return name.replace("/", "%2f")
}

function detectArch() {
  if (process.arch === "arm64") return "arm64" as const
  return "x64" as const
}

function detectOs() {
  if (process.platform === "darwin") return "darwin" as const
  if (process.platform === "win32") return "windows" as const
  return "linux" as const
}

function detectMusl() {
  if (detectOs() !== "linux") return false
  try {
    if (require("node:fs").existsSync("/etc/alpine-release")) return true
  } catch {}
  try {
    const result = spawnSync("ldd", ["--version"], { encoding: "utf8", timeout: 1500 })
    const text = `${result.stdout || ""}${result.stderr || ""}`.toLowerCase()
    return text.includes("musl")
  } catch {
    return false
  }
}

function detectAvx2() {
  if (detectArch() !== "x64") return true
  const platform = detectOs()

  if (platform === "darwin") {
    try {
      const result = spawnSync("sysctl", ["-n", "hw.optional.avx2_0"], { encoding: "utf8", timeout: 1500 })
      return result.status === 0 && (result.stdout || "").trim() === "1"
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
    const script =
      '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'
    for (const exe of ["powershell.exe", "pwsh.exe", "pwsh", "powershell"]) {
      try {
        const result = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", script], {
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
  }

  return false
}

function packageName(target: { os: "darwin" | "linux" | "windows"; arch: "x64" | "arm64"; musl: boolean; baseline: boolean }) {
  return [
    "codeplane",
    target.os,
    target.arch,
    target.baseline ? "baseline" : undefined,
    target.musl ? "musl" : undefined,
  ]
    .filter(Boolean)
    .join("-")
}

export function resolveCodeplaneLocalTarget(): LocalTarget & { packageName: string } {
  const os = detectOs()
  const arch = detectArch()
  const musl = detectMusl()
  const baseline = arch === "x64" && !detectAvx2()
  const packageNameValue = packageName({ os, arch, musl, baseline })
  return {
    packageName: packageNameValue,
    archiveName: `${packageNameValue}.tgz`,
    archiveExt: ".tgz",
    binaryName: os === "windows" ? "codeplane.exe" : "codeplane",
    os,
    arch,
  }
}

export function managedCodeplaneCliPath() {
  return path.join(CodeplaneHome.paths().bin, resolveCodeplaneLocalTarget().binaryName)
}

const pathExists = (file: string) => fs.access(file).then(() => true).catch(() => false)

export async function managedCodeplaneCliStatus() {
  const cliPath = managedCodeplaneCliPath()
  const cliInstalled = await pathExists(cliPath)
  const cliVersion = cleanVersion(await fs.readFile(localCliVersionFile(), "utf8").catch(() => ""))
  return {
    cliInstalled,
    cliPath,
    cliVersion: cliVersion || undefined,
  }
}

export async function installManagedCodeplaneCli(input: { version: string; binaryPath?: string }) {
  const version = cleanVersion(input.version)
  const target = resolveCodeplaneLocalTarget()
  const cliPath = managedCodeplaneCliPath()
  const source = input.binaryPath || path.join(CodeplaneHome.paths().local_server_binaries, version, target.binaryName)
  const temp = `${cliPath}.tmp-${Date.now()}`

  await fs.access(source)
  await fs.mkdir(path.dirname(cliPath), { recursive: true })
  await fs.copyFile(source, temp)
  if (target.os !== "windows") {
    await fs.chmod(temp, 0o755).catch(() => undefined)
  }
  await fs.rm(cliPath, { force: true }).catch(() => undefined)
  await fs.rename(temp, cliPath)
  await fs.writeFile(localCliVersionFile(), `${version}\n`)

  return {
    cliInstalled: true,
    cliPath,
    version,
  }
}

export async function readPreferredLocalVersion(fallback = CodeplaneVersion) {
  const value = await fs.readFile(localVersionFile(), "utf8").catch(() => "")
  const next = cleanVersion(value)
  return next || fallback
}

export async function writePreferredLocalVersion(version: string) {
  const next = cleanVersion(version)
  await fs.mkdir(path.dirname(localVersionFile()), { recursive: true })
  await fs.writeFile(localVersionFile(), `${next}\n`)
  return next
}

export async function fetchNpmPackageManifest(input: { name: string; version?: string; registry?: string }) {
  const config: RegistryConfig = input.registry
    ? {
        registry: normalizeRegistry(input.registry),
      }
    : await npmRegistry()
  const version = cleanVersion(input.version || "latest")
  const url = new URL(`${registryPath(input.name)}/${version}`, config.registry)
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(config.token && (config.alwaysAuth || url.origin === new URL(config.registry).origin)
        ? { authorization: `Bearer ${config.token}` }
        : {}),
    },
  })
  if (!response.ok) {
    throw new Error(`npm registry lookup failed for ${input.name}@${version} with HTTP ${response.status}`)
  }
  const payload = (await response.json()) as {
    version?: unknown
    dist?: { tarball?: unknown }
  }
  if (typeof payload.version !== "string" || typeof payload.dist?.tarball !== "string") {
    throw new Error(`npm registry payload for ${input.name}@${version} is missing version or tarball`)
  }
  return {
    version: cleanVersion(payload.version),
    tarball: payload.dist.tarball,
  }
}

export async function fetchCodeplaneLatestVersion(channel = "latest") {
  const manifest = await fetchNpmPackageManifest({
    name: "codeplane-ai",
    version: channel,
  })
  return manifest.version
}

function extract(archive: string, directory: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archive, "-C", directory, "--strip-components", "1"], {
      stdio: "ignore",
      windowsHide: true,
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`tar exited with code ${code ?? signal ?? "unknown"} while extracting ${archive}`))
    })
  })
}

export async function installCodeplaneLocalPackage(input: {
  version: string
  directory: string
  progress?(progress: LocalInstallProgress): void
}) {
  const target = resolveCodeplaneLocalTarget()
  const version = cleanVersion(input.version)
  const binaryPath = path.join(input.directory, target.binaryName)
  const registry = await npmRegistry()

  input.progress?.({
    version,
    phase: "detect",
    message: `Detected ${target.os}/${target.arch}. Resolving ${target.packageName}@${version} from npm…`,
    percent: 4,
    binaryVersion: version,
  })

  const manifest = await fetchNpmPackageManifest({
    name: target.packageName,
    version,
    registry: registry.registry,
  })
  if (cleanVersion(manifest.version) !== version) {
    throw new Error(`npm resolved ${target.packageName}@${manifest.version} instead of ${version}`)
  }

  const tempRoot = `${input.directory}.tmp-${Date.now()}`
  const packageRoot = path.join(tempRoot, "package")
  const archive = path.join(tempRoot, target.archiveName)
  await fs.rm(tempRoot, { recursive: true, force: true })
  await fs.mkdir(packageRoot, { recursive: true })

  input.progress?.({
    version,
    phase: "download",
    message: `Downloading ${target.packageName}@${version} from npm…`,
    percent: 8,
    binaryVersion: version,
  })

  const tarball = new URL(manifest.tarball)
  const response = await fetch(tarball, {
    redirect: "follow",
    headers:
      registry.token && (registry.alwaysAuth || tarball.origin === new URL(registry.registry).origin)
        ? { authorization: `Bearer ${registry.token}` }
        : undefined,
  })
  if (!response.ok) {
    throw new Error(`npm tarball download failed for ${target.packageName}@${version} with HTTP ${response.status}`)
  }
  if (!response.body) {
    throw new Error(`npm tarball download for ${target.packageName}@${version} returned an empty body`)
  }

  const total = Number(response.headers.get("content-length") ?? "0")
  let transferred = 0
  const stream = Readable.fromWeb(response.body as unknown as NodeReadableStream)
  stream.on("data", (chunk: Buffer) => {
    transferred += chunk.length
    input.progress?.({
      version,
      phase: "download",
      message: `Downloading ${target.packageName}@${version}…`,
      percent: total > 0 ? Math.min(82, 8 + Math.round((transferred / total) * 72)) : 40,
      binaryVersion: version,
      transferred,
      total: total || undefined,
    })
  })
  await pipeline(stream, createWriteStream(archive))

  input.progress?.({
    version,
    phase: "extract",
    message: `Extracting ${target.packageName}@${version}…`,
    percent: 86,
    binaryVersion: version,
  })

  await extract(archive, packageRoot)
  if (target.os !== "windows") {
    await fs.chmod(path.join(packageRoot, target.binaryName), 0o755).catch(() => undefined)
  }
  await fs.rm(input.directory, { recursive: true, force: true })
  await fs.rename(packageRoot, input.directory)
  await fs.rm(tempRoot, { recursive: true, force: true })

  input.progress?.({
    version,
    phase: "ready",
    message: `${target.packageName}@${version} is ready locally.`,
    percent: 100,
    binaryVersion: version,
  })

  return {
    binaryPath,
    packageName: target.packageName,
    target,
    version,
  }
}
