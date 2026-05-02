#!/usr/bin/env bun

import { Script } from "@codeplane-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"
import { codeplaneReleaseTag } from "../packages/shared/src/version"
import { syncVersionFiles } from "./sync-version"

console.log("=== publishing ===\n")

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
const tag = codeplaneReleaseTag(Script.version)

async function prepareReleaseFiles() {
  const synced = await syncVersionFiles(Script.version)
  console.log("synced versions:", synced)
  await $`bun install`
  await $`bun run --cwd packages/codeplane build`
  await $`./packages/sdk/js/script/build.ts`
}

if (Script.release && !Script.preview) {
  await $`git fetch origin --tags`
  await $`git switch --detach`
}

await prepareReleaseFiles()

console.log("\n=== cli ===\n")
await $`bun ./packages/codeplane/script/publish.ts`

console.log("\n=== sdk ===\n")
await $`bun ./packages/sdk/js/script/publish.ts`

console.log("\n=== plugin ===\n")
await $`bun ./packages/plugin/script/publish.ts`

if (Script.release && !Script.preview) {
  await $`git commit -am "release: ${tag}"`
  await $`git tag -d ${tag}`.nothrow()
  await $`git tag ${tag}`
  await $`git push origin refs/tags/${tag} --force-with-lease --no-verify`
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  await $`git fetch origin`
  await $`git checkout -B dev origin/dev`
  await prepareReleaseFiles()
  await $`git commit -am "sync release versions for ${tag}"`
  await $`git push origin HEAD:dev --no-verify`
}

if (Script.release) {
  await $`gh release edit ${tag} --draft=false --latest=false --repo ${process.env.GH_REPO}`
}
