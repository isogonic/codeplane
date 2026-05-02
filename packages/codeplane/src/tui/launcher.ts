import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import which from "which"
import { spawn } from "node:child_process"
import { Global } from "@/global"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sourceEntry = path.join(__dirname, "node-main.tsx")

function exists(file: string) {
  return fs.access(file).then(() => true).catch(() => false)
}

function bundledNodeCandidates() {
  const execDir = path.dirname(process.execPath)
  return [
    path.join(execDir, "node"),
    path.join(execDir, "runtime", "node"),
    path.join(execDir, "runtime", "node.exe"),
  ]
}

async function resolveNodeCommand() {
  if (process.env.CODEPLANE_TUI_NODE) return process.env.CODEPLANE_TUI_NODE
  for (const candidate of bundledNodeCandidates()) {
    if (await exists(candidate)) return candidate
  }
  return which.sync("node", { nothrow: true }) || ""
}

async function resolveBundledEntry() {
  if (process.env.CODEPLANE_TUI_BUNDLE) return process.env.CODEPLANE_TUI_BUNDLE
  const execDir = path.dirname(process.execPath)
  const candidates = [path.join(execDir, "tui", "index.mjs"), path.join(execDir, "runtime", "tui", "index.mjs")]
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
}

async function buildDevEntry() {
  const outdir = path.join(Global.Path.cache, "tui")
  const outfile = path.join(outdir, "node-main.js")
  await fs.mkdir(outdir, { recursive: true })
  const result = await Bun.build({
    entrypoints: [sourceEntry],
    target: "node",
    format: "esm",
    minify: false,
    splitting: false,
    outdir,
  })
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join("\n"))
  }
  return result.outputs.find((item) => item.kind === "entry-point")?.path ?? outfile
}

async function resolveEntry() {
  return (await resolveBundledEntry()) ?? buildDevEntry()
}

export async function launchTUI(args: string[] = []) {
  const node = await resolveNodeCommand()
  if (!node) throw new Error("Node.js 22+ is required to run the Codeplane TUI")
  const entry = await resolveEntry()
  const child = spawn(node, [entry, ...args], {
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
