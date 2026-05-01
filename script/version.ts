#!/usr/bin/env bun

import { Script } from "@codeplane-ai/script"
import { $ } from "bun"
import { codeplaneReleaseTag } from "../packages/shared/src/version"

const repo = process.env.GH_REPO ?? (await $`gh repo view --json nameWithOwner --jq .nameWithOwner`.text()).trim()
const output = [`version=${Script.version}`]
const sha = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.text()).trim()
const tag = codeplaneReleaseTag(Script.version)

if (!Script.preview) {
  await $`bun script/changelog.ts --to ${sha}`.cwd(process.cwd())
  const file = `${process.cwd()}/UPCOMING_CHANGELOG.md`
  const body = await Bun.file(file)
    .text()
    .catch(() => "No notable changes")
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const notesFile = `${dir}/codeplane-release-notes.txt`
  await Bun.write(notesFile, body)
  await $`gh release create ${tag} -d --target ${sha} --title "${tag}" --notes-file ${notesFile} --repo ${repo}`
  const release = await $`gh release view ${tag} --json tagName,databaseId --repo ${repo}`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
} else if (Script.channel === "beta") {
  await $`gh release create ${tag} -d --title "${tag}" --repo ${repo}`
  const release = await $`gh release view ${tag} --json tagName,databaseId --repo ${repo}`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

output.push(`repo=${repo}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
