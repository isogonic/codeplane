#!/usr/bin/env bun

import semver from "semver"
import { CodeplaneVersion } from "../packages/shared/src/version"
import { syncVersionFiles } from "./sync-version"
import { fileURLToPath } from "url"

const versionSource = fileURLToPath(new URL("../packages/shared/src/version.ts", import.meta.url))
const input = Bun.argv[2] ?? "patch"
const allowedBumps = new Set(["patch", "minor", "major"])
const current = semver.valid(CodeplaneVersion)

if (!current) {
  throw new Error(`packages/shared/src/version.ts has an invalid version: ${CodeplaneVersion}`)
}

if (Bun.argv.length > 3 || input === "--help" || input === "-h") {
  console.log(`Usage: bun run version:bump [patch|minor|major|X.Y.Z|vX.Y.Z]

Defaults to patch when no argument is passed.
Examples:
  bun run version:bump
  bun run version:bump minor
  bun run version:bump v28.22.0`)
  process.exit(input === "--help" || input === "-h" ? 0 : 1)
}

const explicit = semver.valid(input.replace(/^v/, ""))
const next = explicit ?? (allowedBumps.has(input) ? semver.inc(current, input as semver.ReleaseType) : null)

if (!next) {
  throw new Error(`Invalid version bump: ${input}. Use patch, minor, major, or an exact X.Y.Z version.`)
}

if (next === current) {
  throw new Error(`Version is already ${next}. Use bun run version:sync if files need to be resynced.`)
}

const source = await Bun.file(versionSource).text()
const updated = source.replace(/export const CodeplaneVersion = "[^"]+"/, `export const CodeplaneVersion = "${next}"`)

if (updated === source) {
  throw new Error(`Could not find CodeplaneVersion in ${versionSource}`)
}

await Bun.write(versionSource, updated)

console.log(`Bumped Codeplane version ${current} -> ${next}`)
console.log(JSON.stringify(await syncVersionFiles(next), null, 2))
