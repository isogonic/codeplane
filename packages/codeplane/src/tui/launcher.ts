import * as fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import which from "which"
import { spawn } from "node:child_process"
// NOTE: @opentui/solid/bun-plugin and @opentui/solid/runtime-plugin-support
// both import the "bun" builtin at module top-level, which the main CLI
// bundle (browser-conditioned) cannot resolve. They are only needed by the
// dev-time TUI rebuild (buildDevEntry below), so import dynamically there
// instead of statically here.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const codeplaneDir = path.join(__dirname, "..", "..")
// New TUI entry lives at src/tui/node-main.tsx (the Solid + opentui app).
// We build & spawn it with Bun because the new TUI uses Bun-only APIs
// (bun:ffi via @opentui/core, JSX transform via @opentui/solid/bun-plugin).
const sourceEntry = path.join(codeplaneDir, "src", "tui", "node-main.tsx")

function exists(file: string) {
  return fs.access(file).then(() => true).catch(() => false)
}

function bundledRuntimeCandidates() {
  const execDir = path.dirname(process.execPath)
  return [
    // Prefer Bun (the new TUI uses Bun-only APIs).
    path.join(execDir, "bun"),
    path.join(execDir, "bun.exe"),
    path.join(execDir, "runtime", "bun"),
    path.join(execDir, "runtime", "bun.exe"),
    // Node fallback for installs that ship only Node alongside.
    path.join(execDir, "node"),
    path.join(execDir, "runtime", "node"),
    path.join(execDir, "runtime", "node.exe"),
  ]
}

async function resolveRuntimeCommand() {
  if (process.env.CODEPLANE_TUI_RUNTIME) return process.env.CODEPLANE_TUI_RUNTIME
  if (process.env.CODEPLANE_TUI_NODE) return process.env.CODEPLANE_TUI_NODE
  for (const candidate of bundledRuntimeCandidates()) {
    if (await exists(candidate)) return candidate
  }
  return which.sync("bun", { nothrow: true }) || which.sync("node", { nothrow: true }) || ""
}

function platformPackageNames() {
  const platformMap: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" }
  const archMap: Record<string, string> = { x64: "x64", arm64: "arm64", arm: "arm" }
  const platform = platformMap[process.platform] || process.platform
  const arch = archMap[process.arch] || process.arch
  const base = `codeplane-${platform}-${arch}`
  // Mirror the candidate order from the npm wrapper / postinstall so we walk
  // the same set of platform packages.
  const variants = [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
  return variants
}

async function searchUpForRuntime(start: string): Promise<string | undefined> {
  const names = platformPackageNames()
  let current = start
  for (;;) {
    const modules = path.join(current, "node_modules")
    if (await exists(modules)) {
      for (const name of names) {
        const candidate = path.join(modules, name, "bin", "runtime", "tui", "node-main.js")
        if (await exists(candidate)) return candidate
      }
    }
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

async function resolveBundledEntry() {
  if (process.env.CODEPLANE_TUI_BUNDLE) return process.env.CODEPLANE_TUI_BUNDLE

  const dirs = [process.env.CODEPLANE_BIN_DIR, path.dirname(process.execPath)].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )

  for (const dir of dirs) {
    const candidates = [
      path.join(dir, "runtime", "tui", "node-main.js"),
      path.join(dir, "tui", "node-main.js"),
      path.join(dir, "runtime", "tui", "index.mjs"),
      path.join(dir, "tui", "index.mjs"),
    ]
    for (const candidate of candidates) {
      if (await exists(candidate)) return candidate
    }
  }

  // Last resort: an upstream postinstall may have hardlinked the binary into
  // a different package's bin dir (e.g. codeplane-ai/bin/.codeplane), so the
  // bundle is not next to process.execPath. Walk node_modules ancestors to
  // find the matching platform package's runtime/tui/node-main.js.
  for (const dir of dirs) {
    const found = await searchUpForRuntime(dir)
    if (found) return found
  }
  return undefined
}

function isPackagedBinary() {
  // Bun standalone binaries embed sources under /$bunfs/. import.meta.url reflects that.
  return import.meta.url.startsWith("file:///$bunfs/") || import.meta.url.startsWith("file:///%24bunfs/")
}

async function buildDevEntry() {
  if (isPackagedBinary()) {
    throw new Error(
      "Codeplane TUI bundle missing from this install. Expected runtime/tui/node-main.js next to the executable. " +
        "Reinstall the codeplane package or set CODEPLANE_TUI_BUNDLE to a built node-main.js.",
    )
  }
  const outdir = path.join(codeplaneDir, ".cache", "tui")
  const outfile = path.join(outdir, "node-main.js")
  await fs.mkdir(outdir, { recursive: true })
  const cwd = process.cwd()
  process.chdir(codeplaneDir)
  // Dynamic import keeps the "bun" builtin out of the main CLI bundle.
  const { createSolidTransformPlugin } = await import("@opentui/solid/bun-plugin")
  const result = await Bun.build({
    entrypoints: ["./src/tui/node-main.tsx"],
    target: "bun",
    format: "esm",
    minify: false,
    splitting: false,
    outdir,
    // The new TUI is SolidJS + opentui. Babel-transform JSX into
    // Solid's `template`/`createComponent` calls during bundling.
    plugins: [createSolidTransformPlugin()],
    conditions: ["browser"],
  }).finally(() => process.chdir(cwd))
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join("\n"))
  }
  return result.outputs.find((item) => item.kind === "entry-point")?.path ?? outfile
}

async function resolveLaunchTarget() {
  const bundled = await resolveBundledEntry()
  const runtime = await resolveRuntimeCommand()
  if (!runtime)
    throw new Error(
      "Bun (preferred) or Node.js 22+ is required to run the Codeplane TUI. " +
        "Set CODEPLANE_TUI_RUNTIME to override.",
    )
  const isBun = runtime.endsWith("bun") || runtime.endsWith("bun.exe")
  if (bundled) {
    return {
      command: runtime,
      // The bundle was built with target=bun + plugins; Bun can run it
      // directly. Node can also run the bundle since it's plain ESM JS.
      args: [bundled],
    }
  }
  return {
    command: runtime,
    // Bun runs the .tsx entry directly with the @opentui/solid preload
    // (configured in packages/codeplane/bunfig.toml) so JSX transforms
    // are in place. We pass `--conditions=browser` so package `exports`
    // resolve to their browser variants (matches our tsconfig).
    args: isBun ? ["--conditions=browser", sourceEntry] : [await buildDevEntry()],
  }
}

export async function launchTUI(args: string[] = []) {
  const target = await resolveLaunchTarget()
  const child = spawn(target.command, [...target.args, ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      CODEPLANE_CLIENT: "tui",
    },
  })
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => {
      process.exitCode = code ?? 0
      resolve()
    })
  })
}
