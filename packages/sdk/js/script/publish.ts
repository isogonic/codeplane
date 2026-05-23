#!/usr/bin/env bun

import { Script } from "@codeplane-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
const publishTarball = "codeplane-publish.tgz"

async function removePackedTarballs() {
  await Promise.all(Array.from(new Bun.Glob("*.tgz").scanSync()).map((file) => Bun.file(file).delete()))
}

async function published(name: string, version: string) {
  return (
    (await Bun.spawn(["npm", "view", `${name}@${version}`, "version"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited) === 0
  )
}

async function packForPublish() {
  await removePackedTarballs()
  await $`bun pm pack --filename ${publishTarball}`
  if (!(await Bun.file(publishTarball).exists())) throw new Error("No tarball created for @codeplane-ai/sdk")
  return publishTarball
}

const originalText = await Bun.file("package.json").text()
const pkg = JSON.parse(originalText) as {
  name: string
  version: string
  exports: Record<string, unknown>
}
function transformExports(exports: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(exports).map(([key, value]) => {
      if (typeof value === "string") {
        const file = value.replace("./src/", "./dist/").replace(".ts", "")
        return [key, { import: file + ".js", types: file + ".d.ts" }]
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return [key, transformExports(value)]
      }
      return [key, value]
    }),
  )
}
if (await published(pkg.name, pkg.version)) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
} else {
  pkg.exports = transformExports(pkg.exports)
  await Bun.write("package.json", JSON.stringify(pkg, null, 2))
  try {
    const tarball = await packForPublish()
    await $`npm publish ${tarball} --tag ${Script.channel} --access public`
  } finally {
    await Bun.write("package.json", originalText)
  }
}
