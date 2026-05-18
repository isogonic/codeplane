import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  fetchNpmPackageManifest,
  fetchCodeplaneVersions,
  installCodeplaneLocalPackage,
  installManagedCodeplaneCli,
  localBinaryCandidates,
  managedCodeplaneCliPath,
  managedCodeplaneCliStatus,
  readPreferredLocalVersion,
  resolveLocalArch,
  resolveLocalOs,
  resolveCodeplaneLocalTarget,
  resolveLocalBinaryPath,
  resolveNpmFetchTimeout,
  writePreferredLocalVersion,
} from "../src/local-runtime"

const env = {
  CODEPLANE_BIN_DIR: process.env.CODEPLANE_BIN_DIR,
  CODEPLANE_GLOBAL_HOME_DIR: process.env.CODEPLANE_GLOBAL_HOME_DIR,
  CODEPLANE_HOME_DIR: process.env.CODEPLANE_HOME_DIR,
  CODEPLANE_NPM_REGISTRY: process.env.CODEPLANE_NPM_REGISTRY,
  npm_config_registry: process.env.npm_config_registry,
}

let home: string
let originalFetch: typeof globalThis.fetch

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-shared-"))
  process.env.CODEPLANE_HOME_DIR = home
  delete process.env.CODEPLANE_BIN_DIR
  delete process.env.CODEPLANE_GLOBAL_HOME_DIR
  delete process.env.CODEPLANE_NPM_REGISTRY
  delete process.env.npm_config_registry
  originalFetch = globalThis.fetch
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (env.CODEPLANE_BIN_DIR === undefined) delete process.env.CODEPLANE_BIN_DIR
  else process.env.CODEPLANE_BIN_DIR = env.CODEPLANE_BIN_DIR
  if (env.CODEPLANE_GLOBAL_HOME_DIR === undefined) delete process.env.CODEPLANE_GLOBAL_HOME_DIR
  else process.env.CODEPLANE_GLOBAL_HOME_DIR = env.CODEPLANE_GLOBAL_HOME_DIR
  if (env.CODEPLANE_HOME_DIR === undefined) delete process.env.CODEPLANE_HOME_DIR
  else process.env.CODEPLANE_HOME_DIR = env.CODEPLANE_HOME_DIR
  if (env.CODEPLANE_NPM_REGISTRY === undefined) delete process.env.CODEPLANE_NPM_REGISTRY
  else process.env.CODEPLANE_NPM_REGISTRY = env.CODEPLANE_NPM_REGISTRY
  if (env.npm_config_registry === undefined) delete process.env.npm_config_registry
  else process.env.npm_config_registry = env.npm_config_registry
  await fs.rm(home, { force: true, recursive: true })
})

describe("local runtime registry config", () => {
  test("reads registry and token from Codeplane config", async () => {
    await fs.writeFile(
      path.join(home, "codeplane.jsonc"),
      JSON.stringify({
        npm: {
          registry: "https://registry.example.com/custom",
          token: "secret-token",
          always_auth: true,
        },
      }),
    )

    let request: Request | undefined
    globalThis.fetch = (async (input, init) => {
      request =
        input instanceof Request
          ? input
          : new Request(input instanceof URL ? input.toString() : input, init)
      return new Response(
        JSON.stringify({
          version: "27.3.1",
          dist: { tarball: "https://registry.example.com/custom/codeplane.tgz" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )
    }) as typeof globalThis.fetch

    const manifest = await fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" })

    expect(manifest.version).toBe("27.3.1")
    expect(request?.url).toBe("https://registry.example.com/custom/codeplane-ai/latest")
    expect(request?.headers.get("authorization")).toBe("Bearer secret-token")
  })

  test("reads standard auth_token from Codeplane npm config", async () => {
    await fs.writeFile(
      path.join(home, "codeplane.jsonc"),
      JSON.stringify({
        npm: {
          registry: "https://registry.example.com/custom",
          auth_token: "standard-secret-token",
        },
      }),
    )

    let request: Request | undefined
    globalThis.fetch = (async (input, init) => {
      request = input instanceof Request ? input : new Request(input instanceof URL ? input.toString() : input, init)
      return new Response(JSON.stringify({ version: "27.3.1", dist: { tarball: "https://registry.example.com/custom/codeplane.tgz" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof globalThis.fetch

    const manifest = await fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" })

    expect(manifest.version).toBe("27.3.1")
    expect(request?.headers.get("authorization")).toBe("Bearer standard-secret-token")
  })

  test("includes resolved registry URL in manifest errors", async () => {
    process.env.CODEPLANE_NPM_REGISTRY = "https://registry.example.com/custom"
    globalThis.fetch = (async () => new Response("missing", { status: 404 })) as unknown as typeof globalThis.fetch

    await expect(fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" })).rejects.toThrow(
      "npm registry lookup failed for codeplane-ai@latest at https://registry.example.com/custom/codeplane-ai/latest with HTTP 404. Response: missing Check npm.registry in Codeplane config, CODEPLANE_NPM_REGISTRY, or npm_config_registry.",
    )
  })

  test("rejects invalid configured npm registry URLs", async () => {
    process.env.CODEPLANE_NPM_REGISTRY = "registry.example.com/no-scheme"

    await expect(fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" })).rejects.toThrow(/Invalid npm registry URL/)
  })

  test("resolves safe npm dist-tags", async () => {
    let request: Request | undefined
    globalThis.fetch = (async (input, init) => {
      request = input instanceof Request ? input : new Request(input instanceof URL ? input.toString() : input, init)
      return new Response(JSON.stringify({ version: "27.4.0", dist: { tarball: "https://registry.example.com/codeplane.tgz" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof globalThis.fetch

    const manifest = await fetchNpmPackageManifest({ name: "codeplane-ai", version: "next" })

    expect(manifest.version).toBe("27.4.0")
    expect(request?.url).toBe("https://registry.npmjs.org/codeplane-ai/next")
  })

  test("rejects unsafe npm dist-tags", async () => {
    await expect(fetchNpmPackageManifest({ name: "codeplane-ai", version: "../latest" })).rejects.toThrow(/Invalid version/)
  })

  test("rejects unsafe npm package names for manifest lookups", async () => {
    await expect(fetchNpmPackageManifest({ name: "../codeplane-ai", version: "latest" })).rejects.toThrow(/Invalid npm package name/)
    await expect(fetchNpmPackageManifest({ name: "@scope/../codeplane-ai", version: "latest" })).rejects.toThrow(/Invalid npm package name/)
  })
})

describe("local runtime version listing", () => {
  test("includes resolved registry URL in packument errors", async () => {
    process.env.CODEPLANE_NPM_REGISTRY = "https://registry.example.com/custom"
    globalThis.fetch = (async () => new Response("missing", { status: 404 })) as unknown as typeof globalThis.fetch

    await expect(fetchCodeplaneVersions()).rejects.toThrow(
      "npm registry packument lookup failed for codeplane-ai at https://registry.example.com/custom/codeplane-ai with HTTP 404. Response: missing Check npm.registry in Codeplane config, CODEPLANE_NPM_REGISTRY, or npm_config_registry.",
    )
  })

  test("rejects unsafe npm package names for version listings", async () => {
    await expect(fetchCodeplaneVersions({ name: "../codeplane-ai" })).rejects.toThrow(/Invalid npm package name/)
  })

  test("sorts versions with semver precedence", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          "dist-tags": { latest: "27.4.2" },
          versions: {
            "27.4.2-rc.10": {},
            "27.4.2-rc.2": {},
            "27.4.2": {},
            "27.4.1": {},
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof globalThis.fetch

    const result = await fetchCodeplaneVersions()

    expect(result.registry).toBe("https://registry.npmjs.org/codeplane-ai")
    expect(result.versions).toEqual(["27.4.2", "27.4.2-rc.10", "27.4.2-rc.2", "27.4.1"])
  })

  test("ignores semver-shaped invalid version keys", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          "dist-tags": { latest: "27.4.2" },
          versions: {
            "27.4.2": {},
            "27.4.2-..bad": {},
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof globalThis.fetch

    expect((await fetchCodeplaneVersions()).versions).toEqual(["27.4.2"])
  })

  test("ignores unsafe dist-tag names", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          "dist-tags": {
            latest: "27.4.2",
            "../latest": "99.0.0",
          },
          versions: {
            "27.4.2": {},
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof globalThis.fetch

    expect((await fetchCodeplaneVersions()).distTags).toEqual({ latest: "27.4.2" })
  })

  test("ignores dist-tags pointing at invalid semver values", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          "dist-tags": {
            latest: "27.4.2",
            bad: "27.4.2-..bad",
          },
          versions: {
            "27.4.2": {},
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof globalThis.fetch

    expect((await fetchCodeplaneVersions()).distTags).toEqual({ latest: "27.4.2" })
  })
})

describe("local runtime fetch timeout", () => {
  test("falls back for invalid or too-small values and caps huge values", () => {
    expect(resolveNpmFetchTimeout(undefined)).toBe(120_000)
    expect(resolveNpmFetchTimeout("0")).toBe(120_000)
    expect(resolveNpmFetchTimeout("999")).toBe(120_000)
    expect(resolveNpmFetchTimeout("5000")).toBe(5_000)
    expect(resolveNpmFetchTimeout("9999999")).toBe(600_000)
  })
})

describe("local runtime architecture", () => {
  test("accepts published architectures and rejects unsupported ones", () => {
    expect(resolveLocalArch("arm64")).toBe("arm64")
    expect(resolveLocalArch("x64")).toBe("x64")
    expect(() => resolveLocalArch("ia32")).toThrow(/Unsupported architecture/)
  })
})

describe("local runtime platform", () => {
  test("accepts published platforms and rejects unsupported ones", () => {
    expect(resolveLocalOs("darwin")).toBe("darwin")
    expect(resolveLocalOs("linux")).toBe("linux")
    expect(resolveLocalOs("win32")).toBe("windows")
    expect(() => resolveLocalOs("freebsd")).toThrow(/Unsupported platform/)
  })
})

describe("local runtime target", () => {
  test("reports the package and executable names for this machine", () => {
    const target = resolveCodeplaneLocalTarget()

    expect(target.packageName).toStartWith(`codeplane-${target.os}-${target.arch}`)
    expect(target.archiveName).toBe(`${target.packageName}.tgz`)
    expect(target.binaryName).toBe(target.os === "windows" ? "codeplane.exe" : "codeplane")
  })
})

describe("preferred local runtime version", () => {
  test("persists and reloads the shared preferred version", async () => {
    expect(await readPreferredLocalVersion("27.0.0")).toBe("27.0.0")
    await writePreferredLocalVersion("v27.3.1")
    expect(await readPreferredLocalVersion("27.0.0")).toBe("27.3.1")
  })

  test("accepts stable semver build metadata", async () => {
    await writePreferredLocalVersion("v27.3.1+build.5")
    expect(await readPreferredLocalVersion("27.0.0")).toBe("27.3.1+build.5")
  })

  test("rejects doubled version prefixes", async () => {
    await expect(writePreferredLocalVersion("vv27.3.1")).rejects.toThrow(/Invalid Codeplane version/)
  })

  test("rejects semver-shaped invalid prereleases", async () => {
    await expect(writePreferredLocalVersion("27.3.1-..bad")).rejects.toThrow(/Invalid Codeplane version/)
  })

  test("falls back for semver-shaped invalid preferred versions", async () => {
    await fs.mkdir(path.join(home, "local_server"), { recursive: true })
    await fs.writeFile(path.join(home, "local_server", "default-version"), "27.3.1-..bad\n")

    expect(await readPreferredLocalVersion("27.0.0")).toBe("27.0.0")
  })
})

describe("local binary resolver", () => {
  test("prefers bin/<name> layout produced by the npm tarball", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-binroot-"))
    try {
      const binary = process.platform === "win32" ? "codeplane.exe" : "codeplane"
      const inBin = path.join(root, "bin", binary)
      await fs.mkdir(path.dirname(inBin), { recursive: true })
      await fs.writeFile(inBin, "x")
      expect(await resolveLocalBinaryPath(root, binary)).toBe(inBin)
      expect(localBinaryCandidates(root, binary)).toEqual([inBin, path.join(root, binary)])
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })

  test("falls back to flat layout when bin/ is absent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-binroot-"))
    try {
      const binary = process.platform === "win32" ? "codeplane.exe" : "codeplane"
      const flat = path.join(root, binary)
      await fs.writeFile(flat, "x")
      expect(await resolveLocalBinaryPath(root, binary)).toBe(flat)
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })

  test("returns undefined when no binary exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-binroot-"))
    try {
      expect(await resolveLocalBinaryPath(root, "codeplane")).toBeUndefined()
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })
})

describe("install codeplane local package", () => {
  test("downloads, verifies SRI, and extracts a fixture tarball into bin/<name>", async () => {
    const target = resolveCodeplaneLocalTarget()
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-fixture-"))
    try {
      // Build a tarball that mirrors the real layout: package/bin/<name>.
      const packageDir = path.join(fixture, "package")
      await fs.mkdir(path.join(packageDir, "bin"), { recursive: true })
      const binaryContents = "#!/bin/sh\necho ok\n"
      await fs.writeFile(path.join(packageDir, "bin", target.binaryName), binaryContents)
      await fs.writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify({ name: target.packageName, version: "27.3.1" }),
      )
      const tgz = path.join(fixture, "fixture.tgz")
      const tar = spawnSync("tar", ["-czf", tgz, "-C", fixture, "package"])
      if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr?.toString()}`)
      const tarballBytes = await fs.readFile(tgz)
      const integrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`

      // Stub fetch: first call → manifest, second call → tarball bytes.
      let callIndex = 0
      globalThis.fetch = (async () => {
        callIndex += 1
        if (callIndex === 1) {
          return new Response(
            JSON.stringify({
              version: "27.3.1",
              dist: {
                tarball: `https://registry.example.com/${target.packageName}/-/${target.packageName}-27.3.1.tgz`,
                integrity,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        return new Response(tarballBytes, {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(tarballBytes.length),
          },
        })
      }) as unknown as typeof globalThis.fetch

      const dest = path.join(home, "local_server", "binaries", "27.3.1")
      const result = await installCodeplaneLocalPackage({ version: "27.3.1", directory: dest })

      expect(result.version).toBe("27.3.1")
      expect(result.binaryPath).toBe(path.join(dest, "bin", target.binaryName))
      expect(await fs.readFile(result.binaryPath, "utf8")).toBe(binaryContents)
      // Resolver finds the binary at the bin/ layout.
      expect(await resolveLocalBinaryPath(dest, target.binaryName)).toBe(result.binaryPath)
    } finally {
      await fs.rm(fixture, { force: true, recursive: true })
    }
  })

  test("rejects a tarball whose SRI does not match the manifest", async () => {
    const target = resolveCodeplaneLocalTarget()
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-fixture-"))
    try {
      const packageDir = path.join(fixture, "package")
      await fs.mkdir(path.join(packageDir, "bin"), { recursive: true })
      await fs.writeFile(path.join(packageDir, "bin", target.binaryName), "x")
      await fs.writeFile(path.join(packageDir, "package.json"), JSON.stringify({ name: target.packageName, version: "27.3.1" }))
      const tgz = path.join(fixture, "fixture.tgz")
      const tar = spawnSync("tar", ["-czf", tgz, "-C", fixture, "package"])
      if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr?.toString()}`)
      const tarballBytes = await fs.readFile(tgz)

      let callIndex = 0
      globalThis.fetch = (async () => {
        callIndex += 1
        if (callIndex === 1) {
          return new Response(
            JSON.stringify({
              version: "27.3.1",
              dist: {
                tarball: `https://registry.example.com/${target.packageName}/-/${target.packageName}-27.3.1.tgz`,
                integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        return new Response(tarballBytes, {
          status: 200,
          headers: { "content-length": String(tarballBytes.length) },
        })
      }) as unknown as typeof globalThis.fetch

      await expect(
        installCodeplaneLocalPackage({
          version: "27.3.1",
          directory: path.join(home, "local_server", "binaries", "27.3.1"),
        }),
      ).rejects.toThrow(/integrity mismatch/i)
    } finally {
      await fs.rm(fixture, { force: true, recursive: true })
    }
  })

  test("reports every extracted binary candidate when the payload is missing the binary", async () => {
    const target = resolveCodeplaneLocalTarget()
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-fixture-"))
    try {
      const packageDir = path.join(fixture, "package")
      await fs.mkdir(packageDir, { recursive: true })
      await fs.writeFile(path.join(packageDir, "package.json"), JSON.stringify({ name: target.packageName, version: "27.3.1" }))
      const tgz = path.join(fixture, "fixture.tgz")
      const tar = spawnSync("tar", ["-czf", tgz, "-C", fixture, "package"])
      if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr?.toString()}`)
      const tarballBytes = await fs.readFile(tgz)

      let callIndex = 0
      globalThis.fetch = (async () => {
        callIndex += 1
        if (callIndex === 1) {
          return new Response(
            JSON.stringify({
              version: "27.3.1",
              dist: {
                tarball: `https://registry.example.com/${target.packageName}/-/${target.packageName}-27.3.1.tgz`,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        return new Response(tarballBytes, {
          status: 200,
          headers: { "content-length": String(tarballBytes.length) },
        })
      }) as unknown as typeof globalThis.fetch

      await expect(
        installCodeplaneLocalPackage({
          version: "27.3.1",
          directory: path.join(home, "local_server", "binaries", "27.3.1"),
        }),
      ).rejects.toThrow(new RegExp(`Tried:\\n- .+bin/${target.binaryName}\\n- .+${target.binaryName}`))
    } finally {
      await fs.rm(fixture, { force: true, recursive: true })
    }
  })

  test("cleans temporary package roots after failed downloads", async () => {
    const target = resolveCodeplaneLocalTarget()
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = input instanceof URL ? input.toString() : input instanceof Request ? input.url : String(input)
      if (url.endsWith(`/${target.packageName}/27.3.1`)) {
        return new Response(
          JSON.stringify({
            version: "27.3.1",
            dist: {
              tarball: `https://registry.example.com/${target.packageName}/-/${target.packageName}-27.3.1.tgz`,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      return new Response("nope", { status: 500 })
    }) as unknown as typeof globalThis.fetch

    const dest = path.join(home, "local_server", "binaries", "27.3.1")
    await expect(installCodeplaneLocalPackage({ version: "27.3.1", directory: dest })).rejects.toThrow(
      new RegExp(
        `tarball download failed.*https://registry\\.example\\.com/${target.packageName}/-/${target.packageName}-27\\.3\\.1\\.tgz.*CODEPLANE_NPM_REGISTRY`,
      ),
    )

    const parent = path.dirname(dest)
    const entries = await fs.readdir(parent).catch(() => [])
    expect(entries.filter((entry) => entry.startsWith("27.3.1.tmp-"))).toEqual([])
  })
})

describe("managed local cli", () => {
  test("copies the installed runtime binary into the shared cli path", async () => {
    const source = path.join(home, "local_server", "binaries", "27.3.1", "bin", process.platform === "win32" ? "codeplane.exe" : "codeplane")
    await fs.mkdir(path.dirname(source), { recursive: true })
    await fs.writeFile(source, "#!/usr/bin/env sh\nexit 0\n")
    if (process.platform !== "win32") {
      await fs.chmod(source, 0o755)
    }

    expect((await managedCodeplaneCliStatus()).cliInstalled).toBe(false)

    const installed = await installManagedCodeplaneCli({
      version: "27.3.1",
      binaryPath: source,
    })

    expect(installed.cliInstalled).toBe(true)
    expect(installed.cliPath).toBe(managedCodeplaneCliPath())
    expect(await fs.readFile(installed.cliPath, "utf8")).toContain("exit 0")
    expect(await managedCodeplaneCliStatus()).toEqual({
      cliInstalled: true,
      cliPath: managedCodeplaneCliPath(),
      cliVersion: "27.3.1",
    })
  })

  test("skips re-copy when the cli is already at the requested version", async () => {
    const source = path.join(home, "local_server", "binaries", "27.3.1", "bin", process.platform === "win32" ? "codeplane.exe" : "codeplane")
    await fs.mkdir(path.dirname(source), { recursive: true })
    await fs.writeFile(source, "first\n")
    if (process.platform !== "win32") await fs.chmod(source, 0o755)

    await installManagedCodeplaneCli({ version: "27.3.1", binaryPath: source })
    const cliPath = managedCodeplaneCliPath()
    const firstStat = await fs.stat(cliPath)

    // Mutate source — second install must NOT propagate this change because
    // the version file already matches.
    await fs.writeFile(source, "second-ignored\n")
    await installManagedCodeplaneCli({ version: "27.3.1", binaryPath: source })
    const secondContents = await fs.readFile(cliPath, "utf8")
    const secondStat = await fs.stat(cliPath)

    expect(secondContents).toBe("first\n")
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs)
  })

  test("does not report cli directories as installed binaries", async () => {
    await fs.mkdir(managedCodeplaneCliPath(), { recursive: true })
    await fs.writeFile(path.join(home, "bin", ".codeplane-version"), "27.3.1\n")

    expect(await managedCodeplaneCliStatus()).toEqual({
      cliInstalled: false,
      cliPath: managedCodeplaneCliPath(),
      cliVersion: "27.3.1",
    })
  })

  test("reports every missing binary candidate", async () => {
    await expect(installManagedCodeplaneCli({ version: "27.3.1" })).rejects.toThrow(/Tried:\n- .+bin.+codeplane/)
  })

  test("cleans temporary cli binaries after failed installs", async () => {
    const source = path.join(home, "local_server", "binaries", "27.3.1", "bin", process.platform === "win32" ? "codeplane.exe" : "codeplane")
    await fs.mkdir(path.dirname(source), { recursive: true })
    await fs.writeFile(source, "binary\n")
    await fs.mkdir(managedCodeplaneCliPath(), { recursive: true })

    await expect(installManagedCodeplaneCli({ version: "27.3.1", binaryPath: source })).rejects.toThrow()

    const entries = await fs.readdir(path.dirname(managedCodeplaneCliPath()))
    expect(entries.filter((entry) => entry.includes(".tmp-"))).toEqual([])
  })
})
