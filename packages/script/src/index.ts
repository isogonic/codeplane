import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]
const releasePkg = (await Bun.file(
  path.resolve(import.meta.dir, "../../../packages/codeplane/package.json"),
).json()) as {
  version?: string
}

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  CODEPLANE_CHANNEL: process.env["CODEPLANE_CHANNEL"],
  CODEPLANE_BUMP: process.env["CODEPLANE_BUMP"],
  CODEPLANE_VERSION: process.env["CODEPLANE_VERSION"],
  CODEPLANE_RELEASE: process.env["CODEPLANE_RELEASE"],
}

const BASE_VERSION = semver.valid(releasePkg.version?.replace(/^v/, ""))
if (!BASE_VERSION) {
  throw new Error(`packages/codeplane/package.json has an invalid version: ${releasePkg.version}`)
}

const cleanVersion = (input: string) => {
  const version = semver.valid(input.replace(/^v/, ""))
  if (!version) throw new Error(`Invalid release version: ${input}`)
  return version
}

const safePrerelease = (input: string) =>
  input
    .toLowerCase()
    .replace(/[^0-9a-z-]+/g, "-")
    .replace(/^-+|-+$/g, "")

const gitSuffix = () =>
  $`git rev-parse --short=12 HEAD`
    .text()
    .then((output) => output.trim())
    .catch(() => "local")

const bumpVersion = (input: string) => {
  const exact = semver.valid(input.replace(/^v/, ""))
  if (exact) return exact
  const version = semver.inc(BASE_VERSION, input as semver.ReleaseType)
  if (!version) throw new Error(`Invalid release bump: ${input}`)
  return version
}

const CHANNEL = await (async () => {
  if (env.CODEPLANE_CHANNEL) return env.CODEPLANE_CHANNEL
  if (env.CODEPLANE_VERSION) return "latest"
  if (env.CODEPLANE_BUMP) return "latest"
  const branch = await $`git branch --show-current`.text().then((x) => x.trim())
  if (branch === "main" || branch === "dev") return "latest"
  return branch
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.CODEPLANE_VERSION) return cleanVersion(env.CODEPLANE_VERSION)
  if (env.CODEPLANE_BUMP) return bumpVersion(env.CODEPLANE_BUMP)
  if (IS_PREVIEW) return `${BASE_VERSION}-${safePrerelease(CHANNEL) || "preview"}.${await gitSuffix()}`
  return BASE_VERSION
})()

const bot = ["actions-user", "codeplane", "codeplane-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.CODEPLANE_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`codeplane script`, JSON.stringify(Script, null, 2))
