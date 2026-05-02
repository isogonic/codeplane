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

async function main() {
  if (os.platform() === "win32") {
    // On Windows, the .exe is already included in the package and bin field points to it.
    // No postinstall setup needed.
    console.log("Windows detected: binary setup not needed (using packaged .exe)")
    return
  }

  let binaryPath
  try {
    binaryPath = (await tryFindBinaryWithRetry()).binaryPath
  } catch (error) {
    // The wrapper script (bin/codeplane) does its own findBinary at runtime,
    // so a missing optional-dependency here only loses the .codeplane fast-
    // start cache — it does NOT prevent codeplane from running. Warn but
    // do not fail the install.
    console.warn(
      "[codeplane postinstall] Skipping fast-start cache: " +
        (error && error.message ? error.message : String(error)) +
        ". The CLI will still work; startup may be slightly slower on first run.",
    )
    return
  }

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
