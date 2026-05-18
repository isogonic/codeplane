import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import semver from "semver"
import { CodeplaneHome } from "./home"
import { CodeplaneVersion } from "./version"
import type { LocalInstallProgress, LocalTarget } from "./instance"

const CONFIG_FILES = ["codeplane.jsonc", "codeplane.json", "config.json"] as const
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const NPM_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export function resolveNpmFetchTimeout(value = process.env.CODEPLANE_NPM_FETCH_TIMEOUT_MS) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1_000) return 120_000
  return Math.min(parsed, 600_000)
}
const NPM_FETCH_TIMEOUT_MS = resolveNpmFetchTimeout()
const cleanVersion = (value: string) => (value ?? "").toString().trim().replace(/^[vV](?=\d)/, "")
const localVersionFile = () => path.join(CodeplaneHome.paths().local_server, "default-version")
const localCliVersionFile = () => path.join(CodeplaneHome.paths().bin, ".codeplane-version")

function assertValidVersion(version: string, context: string) {
  if (!VERSION_PATTERN.test(version) || !semver.valid(version)) {
    throw new Error(`Invalid Codeplane version "${version}" (${context}). Expected semver like ${CodeplaneVersion} or ${CodeplaneVersion}-rc.0.`)
  }
}

async function fetchWithTimeout(url: URL | string, init: RequestInit & { timeoutMs?: number; description?: string } = {}) {
  const { timeoutMs = NPM_FETCH_TIMEOUT_MS, description, signal: externalSignal, ...rest } = init
  const controller = new AbortController()
  const onAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason)
    else externalSignal.addEventListener("abort", onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms${description ? `: ${description}` : ""}`)), timeoutMs)
  timer.unref?.()
  try {
    return await fetch(url, { ...rest, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener("abort", onAbort)
  }
}

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
        token:
          typeof npm.token === "string"
            ? npm.token.trim() || undefined
            : typeof npm.auth_token === "string"
              ? npm.auth_token.trim() || undefined
              : undefined,
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

export function resolveLocalArch(arch = process.arch) {
  if (arch === "arm64" || arch === "x64") return arch
  throw new Error(`Unsupported architecture "${arch}". Codeplane local runtimes are published for arm64 and x64.`)
}

export function resolveLocalOs(platform = process.platform) {
  if (platform === "darwin") return "darwin" as const
  if (platform === "win32") return "windows" as const
  if (platform === "linux") return "linux" as const
  throw new Error(`Unsupported platform "${platform}". Codeplane local runtimes are published for macOS, Linux, and Windows.`)
}

function detectArch() {
  return resolveLocalArch()
}

function detectOs() {
  return resolveLocalOs()
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

// The npm platform package ships the binary at `<root>/bin/<name>`, but older
// extractions and a handful of fixtures ship it flat at `<root>/<name>`. Probe
// both so callers do not have to care which layout is on disk.
export function localBinaryCandidates(versionRoot: string, binaryName: string) {
  return [path.join(versionRoot, "bin", binaryName), path.join(versionRoot, binaryName)]
}

export async function resolveLocalBinaryPath(versionRoot: string, binaryName: string) {
  for (const candidate of localBinaryCandidates(versionRoot, binaryName)) {
    if (await pathExists(candidate)) return candidate
  }
}

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
  assertValidVersion(version, "installManagedCodeplaneCli")
  const target = resolveCodeplaneLocalTarget()
  const cliPath = managedCodeplaneCliPath()
  const versionRoot = path.join(CodeplaneHome.paths().local_server_binaries, version)
  const source =
    (input.binaryPath && (await pathExists(input.binaryPath)) ? input.binaryPath : undefined) ??
    (await resolveLocalBinaryPath(versionRoot, target.binaryName))
  if (!source) {
    throw new Error(
      `Codeplane ${version} binary not found in ${versionRoot}. Tried:\n${localBinaryCandidates(versionRoot, target.binaryName)
        .map((candidate) => `- ${candidate}`)
        .join("\n")}`,
    )
  }

  // Skip the copy if the shared CLI is already on this exact version and
  // points at a working binary — avoids racing concurrent local instances.
  const existing = await managedCodeplaneCliStatus()
  if (existing.cliInstalled && existing.cliVersion === version) {
    return { cliInstalled: true, cliPath, version }
  }

  const temp = `${cliPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`

  try {
    await fs.mkdir(path.dirname(cliPath), { recursive: true })
    await fs.copyFile(source, temp)
    if (target.os !== "windows") {
      await fs.chmod(temp, 0o755).catch(() => undefined)
    }
    await fs.rm(cliPath, { force: true }).catch(() => undefined)
    await fs.rename(temp, cliPath)
    await fs.writeFile(localCliVersionFile(), `${version}\n`)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw error
  }

  return {
    cliInstalled: true,
    cliPath,
    version,
  }
}

export async function readPreferredLocalVersion(fallback = CodeplaneVersion) {
  const value = await fs.readFile(localVersionFile(), "utf8").catch(() => "")
  const next = cleanVersion(value)
  return next && VERSION_PATTERN.test(next) && semver.valid(next) ? next : fallback
}

export async function writePreferredLocalVersion(version: string) {
  const next = cleanVersion(version)
  assertValidVersion(next, "writePreferredLocalVersion")
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
  const requested = cleanVersion(input.version || "latest")
  // Allow npm dist-tag passthrough, but reject values that cannot be a safe tag or concrete version.
  if (!VERSION_PATTERN.test(requested) && !NPM_TAG_PATTERN.test(requested)) {
    throw new Error(`Invalid version "${requested}" requested for ${input.name}`)
  }
  const url = new URL(`${registryPath(input.name)}/${requested}`, config.registry)
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      ...(config.token && (config.alwaysAuth || url.origin === new URL(config.registry).origin)
        ? { authorization: `Bearer ${config.token}` }
        : {}),
    },
    description: `npm manifest ${input.name}@${requested}`,
  })
  if (!response.ok) {
    throw new Error(`npm registry lookup failed for ${input.name}@${requested} at ${url.toString()} with HTTP ${response.status}`)
  }
  const payload = (await response.json()) as {
    version?: unknown
    dist?: { tarball?: unknown; integrity?: unknown; shasum?: unknown }
  }
  if (typeof payload.version !== "string" || typeof payload.dist?.tarball !== "string") {
    throw new Error(`npm registry payload for ${input.name}@${requested} at ${url.toString()} is missing version or tarball`)
  }
  return {
    version: cleanVersion(payload.version),
    tarball: payload.dist.tarball,
    integrity: typeof payload.dist.integrity === "string" ? payload.dist.integrity : undefined,
    shasum: typeof payload.dist.shasum === "string" ? payload.dist.shasum : undefined,
  }
}

// Validate an npm `dist.integrity` (SRI: "sha512-<base64>"). Throws on mismatch.
function verifyIntegrity(buffer: Buffer, integrity: string, label: string) {
  const entries = integrity.split(/\s+/).filter(Boolean)
  let lastError: Error | undefined
  for (const entry of entries) {
    const [algorithm, value] = entry.split("-", 2)
    if (!algorithm || !value) continue
    try {
      const hash = createHash(algorithm).update(buffer).digest("base64")
      if (hash === value) return
      lastError = new Error(`${algorithm} integrity mismatch for ${label}: expected ${value}, got ${hash}`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError ?? new Error(`No supported algorithm in integrity field for ${label}: ${integrity}`)
}

function verifyShasum(buffer: Buffer, shasum: string, label: string) {
  const hash = createHash("sha1").update(buffer).digest("hex")
  if (hash !== shasum) {
    throw new Error(`sha1 shasum mismatch for ${label}: expected ${shasum}, got ${hash}`)
  }
}

export async function fetchCodeplaneLatestVersion(channel = "latest") {
  const manifest = await fetchNpmPackageManifest({
    name: "codeplane-ai",
    version: channel,
  })
  return manifest.version
}

export type CodeplaneVersionList = {
  latest?: string
  distTags: Record<string, string>
  versions: string[]
}

export async function fetchCodeplaneVersions(input: { name?: string; registry?: string } = {}): Promise<CodeplaneVersionList> {
  const name = input.name ?? "codeplane-ai"
  const config: RegistryConfig = input.registry
    ? { registry: normalizeRegistry(input.registry) }
    : await npmRegistry()
  const url = new URL(registryPath(name), config.registry)
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      ...(config.token && (config.alwaysAuth || url.origin === new URL(config.registry).origin)
        ? { authorization: `Bearer ${config.token}` }
        : {}),
    },
    description: `npm packument ${name}`,
  })
  if (!response.ok) {
    throw new Error(`npm registry packument lookup failed for ${name} at ${url.toString()} with HTTP ${response.status}`)
  }
  const payload = (await response.json()) as {
    "dist-tags"?: Record<string, unknown>
    versions?: Record<string, unknown>
  }
  const distTagsRaw = payload["dist-tags"] ?? {}
  const distTags: Record<string, string> = {}
  for (const [tag, value] of Object.entries(distTagsRaw)) {
    const version = typeof value === "string" ? cleanVersion(value) : undefined
    if (NPM_TAG_PATTERN.test(tag) && version && VERSION_PATTERN.test(version) && semver.valid(version)) {
      distTags[tag] = version
    }
  }
  const versions = Object.keys(payload.versions ?? {})
    .map(cleanVersion)
    .filter((v) => VERSION_PATTERN.test(v) && semver.valid(v))
    .sort(semver.rcompare)
  return { latest: distTags.latest, distTags, versions }
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
  signal?: AbortSignal
}) {
  const target = resolveCodeplaneLocalTarget()
  const version = cleanVersion(input.version)
  assertValidVersion(version, "installCodeplaneLocalPackage")
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

  try {
    input.progress?.({
      version,
      phase: "download",
      message: `Downloading ${target.packageName}@${version} from npm…`,
      percent: 8,
      binaryVersion: version,
    })

    const tarball = new URL(manifest.tarball)
    const response = await fetchWithTimeout(tarball, {
      redirect: "follow",
      headers:
        registry.token && (registry.alwaysAuth || tarball.origin === new URL(registry.registry).origin)
          ? { authorization: `Bearer ${registry.token}` }
          : undefined,
      description: `npm tarball ${target.packageName}@${version}`,
      signal: input.signal,
      timeoutMs: NPM_FETCH_TIMEOUT_MS,
    })
    if (!response.ok) {
      throw new Error(`npm tarball download failed for ${target.packageName}@${version} at ${tarball.toString()} with HTTP ${response.status}`)
    }
    if (!response.body) {
      throw new Error(`npm tarball download for ${target.packageName}@${version} returned an empty body`)
    }

    const total = Number(response.headers.get("content-length") ?? "0")
    let transferred = 0
    const buffers: Buffer[] = []
    const stream = Readable.fromWeb(response.body as unknown as NodeReadableStream)
    const meter = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        transferred += chunk.length
        buffers.push(chunk)
        input.progress?.({
          version,
          phase: "download",
          message: `Downloading ${target.packageName}@${version}…`,
          percent: total > 0 ? Math.min(82, 8 + Math.round((transferred / total) * 72)) : 40,
          binaryVersion: version,
          transferred,
          total: total || undefined,
        })
        callback(null, chunk)
      },
    })
    await pipeline(stream, meter, createWriteStream(archive))
    const tarballBytes = Buffer.concat(buffers)
    if (manifest.integrity) {
      verifyIntegrity(tarballBytes, manifest.integrity, `${target.packageName}@${version}`)
    } else if (manifest.shasum) {
      verifyShasum(tarballBytes, manifest.shasum, `${target.packageName}@${version}`)
    }

    input.progress?.({
      version,
      phase: "extract",
      message: `Extracting ${target.packageName}@${version}…`,
      percent: 86,
      binaryVersion: version,
    })

    await extract(archive, packageRoot)
    const extractedBinary = await resolveLocalBinaryPath(packageRoot, target.binaryName)
    if (!extractedBinary) {
      throw new Error(
        `Extracted ${target.packageName}@${version} but binary ${target.binaryName} was not found in the package payload. Tried:\n${localBinaryCandidates(
          packageRoot,
          target.binaryName,
        )
          .map((candidate) => `- ${candidate}`)
          .join("\n")}`,
      )
    }
    if (target.os !== "windows") {
      await fs.chmod(extractedBinary, 0o755).catch(() => undefined)
    }
    await fs.rm(input.directory, { recursive: true, force: true })
    await fs.rename(packageRoot, input.directory)
    await fs.rm(tempRoot, { recursive: true, force: true })
    const binaryPath = path.join(input.directory, path.relative(packageRoot, extractedBinary))

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
  } catch (error) {
    await fs.rm(tempRoot, { recursive: true, force: true })
    throw error
  }
}
