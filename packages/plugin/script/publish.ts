#!/usr/bin/env bun
import { Script } from "@codeplane-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

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
  await $`bun pm pack --destination . --quiet`
  const tarballs = Array.from(new Bun.Glob("*.tgz").scanSync())
  if (tarballs.length !== 1) throw new Error(`Expected one tarball for @codeplane-ai/plugin, found ${tarballs.length}`)
  return tarballs[0]
}

await $`bun tsc`
const originalText = await Bun.file("package.json").text()
const pkg = JSON.parse(originalText) as {
  name: string
  version: string
  exports: Record<string, string>
}
if (await published(pkg.name, pkg.version)) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
} else {
  for (const [key, value] of Object.entries(pkg.exports)) {
    const file = value.replace("./src/", "./dist/").replace(".ts", "")
    // @ts-ignore
    pkg.exports[key] = {
      import: file + ".js",
      types: file + ".d.ts",
    }
  }
  await Bun.write("package.json", JSON.stringify(pkg, null, 2))
  try {
    const tarball = await packForPublish()
    await $`npm publish ${tarball} --tag ${Script.channel} --access public`
  } finally {
    await Bun.write("package.json", originalText)
  }
}
