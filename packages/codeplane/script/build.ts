#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import which from "which"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

await import("./generate.ts")

import { Script } from "@codeplane-ai/script"
import pkg from "../package.json"

const repo = process.env.GH_REPO ?? "devinoldenburg/codeplane"
const repoURL = `https://github.com/${repo}`

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  await $`bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    `// Import all files as file_$i with type: "file"`,
    ...imports,
    `// Export with original mappings`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const buildTUIBundle = async (outdir: string) => {
  // The TUI is SolidJS + opentui. Without the Solid Babel transform the
  // bundler can't resolve @opentui/solid/jsx-runtime (it only ships .d.ts).
  // Mirrors tui/launcher.ts → buildDevEntry.
  const { createSolidTransformPlugin } = await import("@opentui/solid/bun-plugin")
  const result = await Bun.build({
    entrypoints: ["./src/tui/node-main.tsx"],
    // The TUI uses Bun-only APIs via @opentui/core (bun:ffi) and
    // @opentui/solid/{bun-plugin,runtime-plugin-support} (registerBunPlugin),
    // so the bundle must be Bun-targeted. The launcher prefers a bundled bun
    // runtime over node anyway (see tui/launcher.ts → bundledRuntimeCandidates).
    target: "bun",
    format: "esm",
    minify: true,
    splitting: false,
    outdir,
    plugins: [createSolidTransformPlugin()],
    conditions: ["browser"],
  })
  if (!result.success) {
    throw new AggregateError(
      result.logs.map((log) => new Error(log.message)),
      "Failed to build Codeplane TUI bundle",
    )
  }
}

const copyNodeRuntime = async (outfile: string) => {
  const source = process.env.CODEPLANE_TUI_NODE || which.sync("node", { nothrow: true })
  if (!source) {
    console.warn("Skipping bundled Node runtime: no node executable found on PATH")
    return
  }
  await fs.promises.mkdir(path.dirname(outfile), { recursive: true })
  await fs.promises.copyFile(source, outfile)
  if (process.platform !== "win32") {
    await fs.promises.chmod(outfile, 0o755).catch(() => undefined)
  }
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : allTargets

await $`rm -rf dist`

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --no-save --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
}
for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const mainResult = await Bun.build({
    // The bundler classifies the build by `target`. Without this, it defaults
    // to a browser-style classifier that rejects "bun" builtin imports — even
    // though `compile.target` below produces a Bun standalone executable.
    // The dev-only TUI rebuild (tui/launcher.ts → buildDevEntry) imports
    // @opentui/solid/bun-plugin, which uses `import { plugin } from "bun"`,
    // so the bundler must accept that.
    target: "bun",
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    // @opentui/solid/{bun-plugin,runtime-plugin-support} are TUI-only entries
    // that import the "bun" builtin at module top-level. The main CLI bundle
    // never executes them (TUI runs as a subprocess via the separate
    // buildTUIBundle output), so externalizing them prevents the bundler
    // from rejecting their bun-builtin imports.
    external: [
      "node-gyp",
      "@opentui/solid/runtime-plugin-support",
      "@opentui/solid/runtime-plugin-support/configure",
      "@opentui/solid/bun-plugin",
      "@opentui/core/runtime-plugin-support",
      "@opentui/core/runtime-plugin-support/configure",
    ],
    format: "esm",
    minify: true,
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/codeplane`,
      execArgv: [`--user-agent=codeplane/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: embeddedFileMap ? { "codeplane-web-ui.gen.ts": embeddedFileMap } : {},
    entrypoints: ["./src/index.ts", ...(embeddedFileMap ? ["codeplane-web-ui.gen.ts"] : [])],
    define: {
      CODEPLANE_VERSION: `'${Script.version}'`,
      CODEPLANE_MIGRATIONS: JSON.stringify(migrations),
      CODEPLANE_CHANNEL: `'${Script.channel}'`,
      CODEPLANE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
    },
  })
  if (!mainResult.success) {
    throw new AggregateError(
      mainResult.logs.map((log) => new Error(log.message)),
      `Failed to build Codeplane CLI bundle for ${name}`,
    )
  }

  await buildTUIBundle(`dist/${name}/bin/runtime/tui`)

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = `dist/${name}/bin/codeplane`
    const nodeRuntimePath = `dist/${name}/bin/runtime/node${process.platform === "win32" ? ".exe" : ""}`
    await copyNodeRuntime(nodeRuntimePath)
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  // The TUI bundle (runtime/tui/node-main.js) does
  //   require(`@opentui/core-${process.platform}-${process.arch}/index.ts`)
  // at runtime to load the native opentui binding. That platform package is
  // not bundled (it ships per-platform native code), so it must be installed
  // alongside this codeplane platform package as a real npm dependency —
  // otherwise the TUI fails on startup with:
  //   Cannot find module '@opentui/core-${platform}-${arch}/index.ts'
  const opentuiCorePackage = `@opentui/core-${item.os === "win32" ? "win32" : item.os}-${item.arch}`
  const opentuiCoreVersion = pkg.dependencies["@opentui/core"]
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        license: pkg.license,
        repository: {
          type: "git",
          url: repoURL,
        },
        bugs: {
          url: `${repoURL}/issues`,
        },
        homepage: repoURL,
        os: [item.os],
        cpu: [item.arch],
        dependencies: {
          [opentuiCorePackage]: opentuiCoreVersion,
        },
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (Script.release) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }
  await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${process.env.GH_REPO}`
}

export { binaries }
