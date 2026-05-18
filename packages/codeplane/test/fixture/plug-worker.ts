import { setTimeout } from "node:timers/promises"

import { Filesystem } from "../../src/util"
import { patchPluginConfig, readPluginManifest, type PatchDeps } from "../../src/plugin/install"
import * as ConfigPaths from "../../src/config/paths"

const raw = process.argv[2]
if (!raw) throw new Error("Missing worker payload")

const value = JSON.parse(raw) as unknown
if (!value || typeof value !== "object") throw new Error("Invalid worker payload")

const msg = value as Record<string, unknown>
if (typeof msg.dir !== "string") throw new Error("Invalid worker payload")
if (typeof msg.target !== "string") throw new Error("Invalid worker payload")
if (typeof msg.mod !== "string") throw new Error("Invalid worker payload")
if (msg.holdMs !== undefined && typeof msg.holdMs !== "number") throw new Error("Invalid worker payload")

const dir = msg.dir
const target = msg.target
const mod = msg.mod
const holdMs = msg.holdMs

const manifest = await readPluginManifest(target)
if (!manifest.ok) {
  console.error(JSON.stringify(manifest))
  process.exit(1)
}

const deps: PatchDeps = {
  readText: (file) => Filesystem.readText(file),
  exists: (file) => Filesystem.exists(file),
  files: (dir, name) => ConfigPaths.fileInDirectory(dir, name),
  write: async (file, text) => {
    if (holdMs) await setTimeout(holdMs)
    await Filesystem.write(file, text)
  },
}

const result = await patchPluginConfig(
  {
    spec: mod,
    targets: manifest.targets,
    directory: dir,
    worktree: dir,
  },
  deps,
)

if (!result.ok) {
  console.error(JSON.stringify(result))
  process.exit(1)
}
