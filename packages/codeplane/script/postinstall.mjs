#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  // Map platform names
  let platform
  switch (os.platform()) {
    case "darwin":
      platform = "darwin"
      break
    case "linux":
      platform = "linux"
      break
    case "win32":
      platform = "windows"
      break
    default:
      platform = os.platform()
      break
  }

  // Map architecture names
  let arch
  switch (os.arch()) {
    case "x64":
      arch = "x64"
      break
    case "arm64":
      arch = "arm64"
      break
    case "arm":
      arch = "arm"
      break
    default:
      arch = os.arch()
      break
  }

  return { platform, arch }
}

function supportsAvx2(platform, arch) {
  if (arch !== "x64") return false

  if (platform === "linux") {
    try {
      return /(^|\s)avx2(\s|$)/i.test(fs.readFileSync("/proc/cpuinfo", "utf8"))
    } catch {
      return false
    }
  }

  if (platform === "darwin") {
    try {
      const result = require("child_process").spawnSync("sysctl", ["-n", "hw.optional.avx2_0"], {
        encoding: "utf8",
        timeout: 1500,
      })
      if (result.status !== 0) return false
      return (result.stdout || "").trim() === "1"
    } catch {
      return false
    }
  }

  if (platform === "windows") {
    const cmd =
      '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'
    for (const exe of ["powershell.exe", "pwsh.exe", "pwsh", "powershell"]) {
      try {
        const result = require("child_process").spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", cmd], {
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

function packageNames(platform, arch) {
  const base = `codeplane-${platform}-${arch}`
  const baseline = arch === "x64" && !supportsAvx2(platform, arch)

  if (platform === "linux") {
    const musl = (() => {
      try {
        if (fs.existsSync("/etc/alpine-release")) return true
      } catch {}
      try {
        const result = require("child_process").spawnSync("ldd", ["--version"], { encoding: "utf8" })
        return `${result.stdout || ""}${result.stderr || ""}`.toLowerCase().includes("musl")
      } catch {
        return false
      }
    })()

    if (musl) {
      if (arch === "x64") {
        if (baseline) return [`${base}-baseline-musl`, `${base}-musl`, `${base}-baseline`, base]
        return [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`]
      }
      return [`${base}-musl`, base]
    }

    if (arch === "x64") {
      if (baseline) return [`${base}-baseline`, base, `${base}-baseline-musl`, `${base}-musl`]
      return [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
    }
    return [base, `${base}-musl`]
  }

  if (arch === "x64") {
    if (baseline) return [`${base}-baseline`, base]
    return [base, `${base}-baseline`]
  }

  return [base]
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch()
  const binaryName = platform === "windows" ? "codeplane.exe" : "codeplane"

  for (const packageName of packageNames(platform, arch)) {
    try {
      const packageJsonPath = require.resolve(`${packageName}/package.json`)
      const packageDir = path.dirname(packageJsonPath)
      const binaryPath = path.join(packageDir, "bin", binaryName)
      if (!fs.existsSync(binaryPath)) continue
      return { binaryPath, binaryName }
    } catch {
      continue
    }
  }

  throw new Error(
    `Could not find a matching Codeplane binary package for ${platform}/${arch}. Tried ${packageNames(platform, arch).join(", ")}`,
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function tryFindBinaryWithRetry(attempts = 5, delayMs = 200) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      return findBinary()
    } catch (error) {
      lastError = error
      if (i < attempts - 1) await sleep(delayMs)
    }
  }
  throw lastError
}

function selfVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"))
    return typeof pkg.version === "string" ? pkg.version : undefined
  } catch {
    return undefined
  }
}

// Fetch a platform package's tarball straight from the npm registry and unpack
// it into our own node_modules. npm silently SKIPS optionalDependencies in
// several common cases — in-place `npm i -g` upgrades, a transient registry
// hiccup during install, --no-optional, or a lockfile generated on another OS —
// which otherwise strands the CLI with "failed to install the right version".
// Reconstructing the package here means the wrapper's findBinary() resolves it
// normally, with no shim changes. Fallback-only: never runs on the happy path.
async function downloadPackage(pkg, version, destDir) {
  const tarball = `${pkg}-${version}.tgz`
  const registry = (process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/+$/, "")
  const url = `${registry}/${pkg}/-/${tarball}`
  const response = await fetch(url)
  if (!response || !response.ok) {
    throw new Error(`download failed (${response ? response.status : "no response"}) for ${url}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codeplane-pkg-"))
  try {
    const archive = path.join(tmp, tarball)
    fs.writeFileSync(archive, buffer)
    // npm tarballs unpack to a top-level "package/" directory.
    require("child_process").execFileSync("tar", ["-xzf", archive, "-C", tmp], { stdio: "ignore" })
    const unpacked = path.join(tmp, "package")
    if (!fs.existsSync(unpacked)) throw new Error("tarball did not contain a package/ directory")
    fs.mkdirSync(path.dirname(destDir), { recursive: true })
    fs.rmSync(destDir, { recursive: true, force: true })
    fs.cpSync(unpacked, destDir, { recursive: true })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

async function healMissingBinary() {
  const version = selfVersion()
  if (!version) throw new Error("could not read codeplane-ai version")
  const { platform, arch } = detectPlatformAndArch()
  const binaryName = platform === "windows" ? "codeplane.exe" : "codeplane"
  const nodeModules = path.join(__dirname, "node_modules")
  let lastError
  for (const pkg of packageNames(platform, arch)) {
    try {
      const destDir = path.join(nodeModules, pkg)
      await downloadPackage(pkg, version, destDir)
      const binaryPath = path.join(destDir, "bin", binaryName)
      if (!fs.existsSync(binaryPath)) throw new Error(`${pkg} tarball missing bin/${binaryName}`)
      if (platform !== "windows") fs.chmodSync(binaryPath, 0o755)
      return { binaryPath, pkg }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error("no matching platform package could be installed")
}

async function main() {
  let binaryPath
  try {
    binaryPath = (await tryFindBinaryWithRetry()).binaryPath
  } catch {
    // optionalDependency missing — self-heal by fetching the platform package
    // so the CLI works instead of failing with "failed to install the right version".
    try {
      const healed = await healMissingBinary()
      binaryPath = healed.binaryPath
      console.log("[codeplane postinstall] Installed missing platform package " + healed.pkg + ".")
    } catch (error) {
      console.warn(
        "[codeplane postinstall] Could not install the platform binary automatically: " +
          (error && error.message ? error.message : String(error)) +
          '. Re-run `npm install -g codeplane-ai`, or install the matching "codeplane-<platform>-<arch>" package manually.',
      )
      return
    }
  }

  // Windows runs the packaged .exe directly via the bin field; no fast-start cache.
  if (os.platform() === "win32") return

  try {
    const target = path.join(__dirname, "bin", ".codeplane")
    if (fs.existsSync(target)) fs.unlinkSync(target)
    try {
      fs.linkSync(binaryPath, target)
    } catch {
      fs.copyFileSync(binaryPath, target)
    }
    fs.chmodSync(target, 0o755)
  } catch (error) {
    console.warn(
      "[codeplane postinstall] Could not write fast-start cache: " +
        (error && error.message ? error.message : String(error)) +
        ". The CLI will still work via the wrapper.",
    )
  }
}

main().catch((error) => {
  console.warn(
    "[codeplane postinstall] Unexpected error: " + (error && error.message ? error.message : String(error)),
  )
  process.exit(0)
})
