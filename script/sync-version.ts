#!/usr/bin/env bun

import { CodeplaneVersion, codeplaneDesktopReleaseTag } from "../packages/shared/src/version"
import { fileURLToPath } from "url"

const root = fileURLToPath(new URL("..", import.meta.url))

async function packageJsonFiles() {
  return Array.fromAsync(
    new Bun.Glob("**/package.json").scan({
      cwd: root,
      absolute: true,
      onlyFiles: true,
    }),
  ).then((files) =>
    files.filter((file) => !file.includes("/node_modules/") && !file.includes("/dist/") && !file.includes("/release/")),
  )
}

async function syncPackageJson(file: string, version: string) {
  const pkg = await Bun.file(file).json().catch(() => undefined)
  if (!pkg || typeof pkg !== "object" || !("version" in pkg) || typeof pkg.version !== "string") return false
  if (pkg.version === version) return false
  pkg.version = version
  await Bun.write(file, `${JSON.stringify(pkg, null, 2)}\n`)
  return true
}

async function syncZedExtension(version: string) {
  const file = fileURLToPath(new URL("../packages/extensions/zed/extension.toml", import.meta.url))
  const current = await Bun.file(file).text()
  const next = current
    .replace(/^version = "[^"]+"/m, `version = "${version}"`)
    .replaceAll(/releases\/download\/v[^/]+\//g, `releases/download/v${version}/`)
  if (next === current) return false
  await Bun.write(file, next)
  return true
}

async function syncReadme(version: string) {
  const file = fileURLToPath(new URL("../README.md", import.meta.url))
  const current = await Bun.file(file).text()
  const desktopTag = codeplaneDesktopReleaseTag(version)
  const next = current
    .replaceAll(/releases\/download\/v[^/]+-desktop\//g, `releases/download/${desktopTag}/`)
    .replaceAll(/releases\/tag\/v[^\s"]+-desktop/g, `releases/tag/${desktopTag}`)
    .replaceAll(/Current%20Desktop%20Release-v[^-]+(?:\.[^-]+)*(?:-[^-]+)?--desktop/g, `Current%20Desktop%20Release-${version}--desktop`)
  if (next === current) return false
  await Bun.write(file, next)
  return true
}

export async function syncVersionFiles(version = CodeplaneVersion) {
  const files = await packageJsonFiles()
  const updated = await Promise.all(files.map((file) => syncPackageJson(file, version)))
  const zed = await syncZedExtension(version)
  const readme = await syncReadme(version)
  return {
    version,
    packageJsons: updated.filter(Boolean).length,
    zed,
    readme,
  }
}

if (import.meta.main) {
  const result = await syncVersionFiles()
  console.log(JSON.stringify(result, null, 2))
}
