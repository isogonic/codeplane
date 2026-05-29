#!/usr/bin/env bun
// Code dev mode: build the working-copy server and register it as a throwaway
// local instance alongside the user's existing ones.
//
// It compiles the current source with script/build.ts --single (a standalone
// binary for THIS platform), drops it into the shared local-runtime binary
// cache under a unique <base>-dev-<id> version, and saves a local:// instance
// with a random UUID id into instances.json. The Desktop and TUI then start,
// stop, and show it exactly like any other local instance — no release needed.

import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { CodeplaneHome } from "@codeplane-ai/shared/home"
import { localInstanceUrl, type SavedInstance } from "@codeplane-ai/shared/instance"
import { createInstanceStore } from "@codeplane-ai/shared/instance-store"
import { resolveCodeplaneLocalTarget } from "@codeplane-ai/shared/local-runtime"
import { CodeplaneVersion } from "@codeplane-ai/shared/version"

const pkgDir = path.resolve(import.meta.dir, "..")

type Args = { label?: string; id?: string; setDefault: boolean; skipBuild: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { setDefault: false, skipBuild: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--set-default") args.setDefault = true
    else if (arg === "--skip-build") args.skipBuild = true
    else if (arg === "--label") args.label = argv[++index]
    else if (arg.startsWith("--label=")) args.label = arg.slice("--label=".length)
    else if (arg === "--id") args.id = argv[++index]
    else if (arg.startsWith("--id=")) args.id = arg.slice("--id=".length)
    else throw new Error(`Unknown argument: ${arg}. Use --label, --id, --set-default, or --skip-build.`)
  }
  return args
}

async function build(devVersion: string) {
  console.log(`\n▸ Building working-copy server as ${devVersion} (single native target)…\n`)
  const proc = Bun.spawn(["bun", "run", "script/build.ts", "--single", "--skip-install"], {
    cwd: pkgDir,
    // build.ts reads CODEPLANE_VERSION (via @codeplane-ai/script) and bakes it
    // into the binary, so the dev build self-reports the same version we register.
    env: { ...process.env, CODEPLANE_VERSION: devVersion },
    stdio: ["inherit", "inherit", "inherit"],
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`build.ts exited with code ${code}`)
}

// build.ts names its output dir after the package target (e.g.
// codeplane-darwin-arm64). Scan dist for whatever single target it produced
// rather than guessing, so an x64-baseline build is picked up too.
async function findBuiltDir() {
  const distRoot = path.join(pkgDir, "dist")
  const entries = await fs.readdir(distRoot).catch(() => {
    throw new Error(`No build output in ${distRoot}. Run without --skip-build first.`)
  })
  const candidates: string[] = []
  for (const name of entries) {
    const dir = path.join(distRoot, name)
    const binary = path.join(dir, "bin", "codeplane")
    if (await fs.stat(binary).then((stat) => stat.isFile()).catch(() => false)) candidates.push(dir)
  }
  if (candidates.length === 0) throw new Error(`No built binary found under ${distRoot}/*/bin/codeplane.`)
  const target = resolveCodeplaneLocalTarget()
  return candidates.find((dir) => path.basename(dir) === target.packageName) ?? candidates[0]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const id = args.id ?? randomUUID()
  const shortId = id.replace(/-/g, "").slice(0, 8)
  // "dev-<hex>" is one alphanumeric semver prerelease identifier, so it stays
  // valid even when the hex slice is all digits (a numeric identifier with a
  // leading zero would be rejected by semver and the runtime version guards).
  const devVersion = `${CodeplaneVersion}-dev-${shortId}`

  if (!args.skipBuild) await build(devVersion)

  const builtDir = await findBuiltDir()
  const home = CodeplaneHome.paths()
  const versionRoot = path.join(home.local_server_binaries, devVersion)

  console.log(`\n▸ Installing binary into ${versionRoot}`)
  await fs.rm(versionRoot, { recursive: true, force: true })
  await fs.mkdir(path.dirname(versionRoot), { recursive: true })
  await fs.cp(builtDir, versionRoot, { recursive: true })
  const binary = path.join(versionRoot, "bin", resolveCodeplaneLocalTarget().binaryName)
  if (process.platform !== "win32") await fs.chmod(binary, 0o755).catch(() => undefined)

  const label = args.label ?? `dev ${shortId}`
  const instance: SavedInstance = {
    id,
    label,
    url: localInstanceUrl(id),
    local: { binaryVersion: devVersion },
  }
  const store = createInstanceStore(home.instances)
  await store.save(instance)
  if (args.setDefault) await store.setLast(id)

  console.log(`\n✓ Dev instance registered`)
  console.log(`  id:       ${id}`)
  console.log(`  label:    ${label}`)
  console.log(`  version:  ${devVersion}`)
  console.log(`  url:      ${instance.url}`)
  console.log(`  binary:   ${binary}`)
  console.log(`  registry: ${home.instances}`)
  console.log(``)
  console.log(`Open it from the Codeplane desktop server picker (reopen the picker to refresh).`)
  if (!args.setDefault) console.log(`Make it the default with:  codeplane instance use ${id}`)
  console.log(`Remove it later with:      codeplane instance remove ${id}`)
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
