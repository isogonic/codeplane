#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@codeplane-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
const repo = process.env.GH_REPO ?? "devinoldenburg/codeplane"
const repoURL = `https://github.com/${repo}`
const npmOnly = process.env.CODEPLANE_PUBLISH_NPM_ONLY === "1"

async function removePackedTarballs(dir: string) {
  await Promise.all(
    Array.from(new Bun.Glob("*.tgz").scanSync({ cwd: dir })).map((file) => Bun.file(`${dir}/${file}`).delete()),
  )
}

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  // GitHub artifact downloads can drop the executable bit, and Docker uses the
  // unpacked dist binaries directly rather than the published tarball.
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return
  }
  await removePackedTarballs(dir)
  await $`bun pm pack --filename codeplane-publish.tgz`.cwd(dir)
  // Detect "already published" coming back from npm itself (race between
  // our `published()` check and the actual PUT, e.g. another retry of the
  // workflow ran in parallel) and treat it as success — the package IS
  // on the registry at the version we wanted, which is the only thing
  // the rest of this script cares about.
  const result = await $`npm publish codeplane-publish.tgz --access public --tag ${Script.channel}`.cwd(dir).nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString()
    if (/cannot publish over the previously published versions/i.test(stderr)) {
      console.log(`already published (race) ${name}@${version}`)
      return
    }
    throw new Error(`npm publish ${name}@${version} failed: ${stderr || "(no stderr)"}`)
  }
}

// Run an array of publish tasks via Promise.allSettled (NOT all) so a
// single failed package doesn't abort the rest. Was a real bug:
// v27.4.51 hit a 403 race on `codeplane-darwin-x64-baseline`,
// Promise.all rejected, the remaining platform binaries never got
// published AND the main `codeplane-ai` publish never ran. Result:
// 10/12 platform binaries published, the main wrapper missing, no
// install path for users.
async function publishAll(
  tasks: Array<{ name: string; run: () => Promise<void> }>,
): Promise<{ failures: Array<{ name: string; reason: string }> }> {
  const results = await Promise.allSettled(tasks.map((task) => task.run()))
  const failures: Array<{ name: string; reason: string }> = []
  results.forEach((result, idx) => {
    if (result.status === "rejected") {
      failures.push({
        name: tasks[idx].name,
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  })
  return { failures }
}

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  binaries[pkg.name] = pkg.version
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name + "-ai",
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      repository: {
        type: "git",
        url: repoURL,
      },
      bugs: {
        url: `${repoURL}/issues`,
      },
      homepage: repoURL,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

// Platform-binary publishes run in parallel via allSettled so one
// failure can't strand the rest. After the first pass, retry just the
// failures (mostly harmless 403 races between concurrent jobs and
// npm's rate-limit retries) by re-running publish() — its built-in
// `published()` check + 403 race detection will short-circuit
// anything that actually landed.
const platformTasks = Object.entries(binaries).map(([name]) => ({
  name,
  run: () => publish(`./dist/${name}`, name, binaries[name]),
}))
const firstPass = await publishAll(platformTasks)
if (firstPass.failures.length > 0) {
  console.log(`first pass had ${firstPass.failures.length} failure(s); retrying once`)
  for (const failure of firstPass.failures) console.log(`  ${failure.name}: ${failure.reason}`)
  const retryTasks = firstPass.failures.map((failure) => ({
    name: failure.name,
    run: () => publish(`./dist/${failure.name}`, failure.name, binaries[failure.name]),
  }))
  const secondPass = await publishAll(retryTasks)
  if (secondPass.failures.length > 0) {
    console.error(`platform-binary publish failed for ${secondPass.failures.length} package(s) after retry:`)
    for (const failure of secondPass.failures) console.error(`  ${failure.name}: ${failure.reason}`)
    process.exit(1)
  }
}

// Only publish the main `codeplane-ai` wrapper after every platform
// binary it depends on is confirmed live. Otherwise users would
// `npm i -g codeplane-ai` and immediately fail on the postinstall
// because their platform's optional dep doesn't resolve.
await publish(`./dist/${pkg.name}`, `${pkg.name}-ai`, version)

const image = `ghcr.io/${repo}`
const platforms = "linux/amd64,linux/arm64"
const tags = [`${image}:${version}`, `${image}:${Script.channel}`]
const tagFlags = tags.flatMap((t) => ["-t", t])

// registries
if (!Script.preview && !npmOnly) {
  await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`
  // Calculate SHA values
  const arm64Sha = await $`sha256sum ./dist/codeplane-linux-arm64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const x64Sha = await $`sha256sum ./dist/codeplane-linux-x64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const macX64Sha = await $`sha256sum ./dist/codeplane-darwin-x64.zip | cut -d' ' -f1`.text().then((x) => x.trim())
  const macArm64Sha = await $`sha256sum ./dist/codeplane-darwin-arm64.zip | cut -d' ' -f1`.text().then((x) => x.trim())

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  // arch
  const binaryPkgbuild = [
    "# Maintainer: dax",
    "# Maintainer: adam",
    "",
    "pkgname='codeplane-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    `url='${repoURL}'`,
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('codeplane')",
    "conflicts=('codeplane')",
    "depends=('ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::${repoURL}/releases/download/v\${pkgver}\${_subver}/codeplane-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,

    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::${repoURL}/releases/download/v\${pkgver}\${_subver}/codeplane-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./codeplane "${pkgdir}/usr/bin/codeplane"',
    "}",
    "",
  ].join("\n")

  for (const [pkg, pkgbuild] of [["codeplane-bin", binaryPkgbuild]]) {
    for (let i = 0; i < 30; i++) {
      try {
        await $`rm -rf ./dist/aur-${pkg}`
        await $`git clone ssh://aur@aur.archlinux.org/${pkg}.git ./dist/aur-${pkg}`
        await $`cd ./dist/aur-${pkg} && git checkout master`
        await Bun.file(`./dist/aur-${pkg}/PKGBUILD`).write(pkgbuild)
        await $`cd ./dist/aur-${pkg} && makepkg --printsrcinfo > .SRCINFO`
        await $`cd ./dist/aur-${pkg} && git add PKGBUILD .SRCINFO`
        if ((await $`cd ./dist/aur-${pkg} && git diff --cached --quiet`.nothrow()).exitCode === 0) break
        await $`cd ./dist/aur-${pkg} && git commit -m "Update to v${Script.version}"`
        await $`cd ./dist/aur-${pkg} && git push`
        break
      } catch {
        continue
      }
    }
  }

  // Homebrew formula
  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# This file was generated by GoReleaser. DO NOT EDIT.",
    "class Codeplane < Formula",
    `  desc "The AI coding agent built for the terminal."`,
    `  homepage "${repoURL}"`,
    `  version "${Script.version.split("-")[0]}"`,
    "",
    `  depends_on "ripgrep"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "${repoURL}/releases/download/v${Script.version}/codeplane-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "codeplane"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "${repoURL}/releases/download/v${Script.version}/codeplane-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "codeplane"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "${repoURL}/releases/download/v${Script.version}/codeplane-linux-x64.tar.gz"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "codeplane"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "${repoURL}/releases/download/v${Script.version}/codeplane-linux-arm64.tar.gz"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "codeplane"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error("GITHUB_TOKEN is required to update homebrew tap")
    process.exit(1)
  }
  const tap = `https://x-access-token:${token}@github.com/${repo.split("/")[0]}/homebrew-tap.git`
  await $`rm -rf ./dist/homebrew-tap`
  await $`git clone ${tap} ./dist/homebrew-tap`
  await Bun.file("./dist/homebrew-tap/codeplane.rb").write(homebrewFormula)
  await $`cd ./dist/homebrew-tap && git add codeplane.rb`
  if ((await $`cd ./dist/homebrew-tap && git diff --cached --quiet`.nothrow()).exitCode !== 0) {
    await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
    await $`cd ./dist/homebrew-tap && git push`
  }
}
