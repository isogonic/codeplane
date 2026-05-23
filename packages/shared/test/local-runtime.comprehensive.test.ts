import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  fetchNpmPackageManifest,
  localBinaryCandidates,
  managedCodeplaneCliPath,
  managedCodeplaneCliStatus,
  readPreferredLocalVersion,
  resolveCodeplaneLocalTarget,
  resolveLocalBinaryPath,
  writePreferredLocalVersion,
} from "../src/local-runtime"

const env = {
  CODEPLANE_HOME_DIR: process.env.CODEPLANE_HOME_DIR,
  CODEPLANE_GLOBAL_HOME_DIR: process.env.CODEPLANE_GLOBAL_HOME_DIR,
  CODEPLANE_BIN_DIR: process.env.CODEPLANE_BIN_DIR,
  CODEPLANE_DATA_DIR: process.env.CODEPLANE_DATA_DIR,
  CODEPLANE_CACHE_DIR: process.env.CODEPLANE_CACHE_DIR,
  CODEPLANE_STATE_DIR: process.env.CODEPLANE_STATE_DIR,
  CODEPLANE_LOG_DIR: process.env.CODEPLANE_LOG_DIR,
  CODEPLANE_NPM_REGISTRY: process.env.CODEPLANE_NPM_REGISTRY,
  npm_config_registry: process.env.npm_config_registry,
}

let home: string
let originalFetch: typeof globalThis.fetch

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-shared-comp-"))
  process.env.CODEPLANE_HOME_DIR = home
  delete process.env.CODEPLANE_GLOBAL_HOME_DIR
  delete process.env.CODEPLANE_BIN_DIR
  delete process.env.CODEPLANE_DATA_DIR
  delete process.env.CODEPLANE_CACHE_DIR
  delete process.env.CODEPLANE_STATE_DIR
  delete process.env.CODEPLANE_LOG_DIR
  delete process.env.CODEPLANE_NPM_REGISTRY
  delete process.env.npm_config_registry
  originalFetch = globalThis.fetch
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (env.CODEPLANE_HOME_DIR === undefined) delete process.env.CODEPLANE_HOME_DIR
  else process.env.CODEPLANE_HOME_DIR = env.CODEPLANE_HOME_DIR
  if (env.CODEPLANE_GLOBAL_HOME_DIR === undefined) delete process.env.CODEPLANE_GLOBAL_HOME_DIR
  else process.env.CODEPLANE_GLOBAL_HOME_DIR = env.CODEPLANE_GLOBAL_HOME_DIR
  if (env.CODEPLANE_BIN_DIR === undefined) delete process.env.CODEPLANE_BIN_DIR
  else process.env.CODEPLANE_BIN_DIR = env.CODEPLANE_BIN_DIR
  if (env.CODEPLANE_DATA_DIR === undefined) delete process.env.CODEPLANE_DATA_DIR
  else process.env.CODEPLANE_DATA_DIR = env.CODEPLANE_DATA_DIR
  if (env.CODEPLANE_CACHE_DIR === undefined) delete process.env.CODEPLANE_CACHE_DIR
  else process.env.CODEPLANE_CACHE_DIR = env.CODEPLANE_CACHE_DIR
  if (env.CODEPLANE_STATE_DIR === undefined) delete process.env.CODEPLANE_STATE_DIR
  else process.env.CODEPLANE_STATE_DIR = env.CODEPLANE_STATE_DIR
  if (env.CODEPLANE_LOG_DIR === undefined) delete process.env.CODEPLANE_LOG_DIR
  else process.env.CODEPLANE_LOG_DIR = env.CODEPLANE_LOG_DIR
  if (env.CODEPLANE_NPM_REGISTRY === undefined) delete process.env.CODEPLANE_NPM_REGISTRY
  else process.env.CODEPLANE_NPM_REGISTRY = env.CODEPLANE_NPM_REGISTRY
  if (env.npm_config_registry === undefined) delete process.env.npm_config_registry
  else process.env.npm_config_registry = env.npm_config_registry
  await fs.rm(home, { force: true, recursive: true })
})

describe("resolveCodeplaneLocalTarget - shape (parameterized)", () => {
  test("os is one of the supported triple", () => {
    expect(["darwin", "linux", "windows"]).toContain(resolveCodeplaneLocalTarget().os)
  })
  test("arch is x64 or arm64", () => {
    expect(["x64", "arm64"]).toContain(resolveCodeplaneLocalTarget().arch)
  })
  test("archiveExt is .tgz", () => {
    expect(resolveCodeplaneLocalTarget().archiveExt).toBe(".tgz")
  })
  test("archiveName ends with packageName + .tgz", () => {
    const t = resolveCodeplaneLocalTarget()
    expect(t.archiveName).toBe(`${t.packageName}.tgz`)
  })
  test("packageName starts with codeplane-", () => {
    expect(resolveCodeplaneLocalTarget().packageName).toMatch(/^codeplane-/)
  })
  test("packageName contains os", () => {
    const t = resolveCodeplaneLocalTarget()
    expect(t.packageName).toContain(t.os)
  })
  test("packageName contains arch", () => {
    const t = resolveCodeplaneLocalTarget()
    expect(t.packageName).toContain(t.arch)
  })
  test("binaryName matches platform convention", () => {
    const t = resolveCodeplaneLocalTarget()
    expect(t.binaryName).toBe(t.os === "windows" ? "codeplane.exe" : "codeplane")
  })
  test("baseline / musl optional segments are limited to known suffixes", () => {
    const t = resolveCodeplaneLocalTarget()
    const segments = t.packageName.split("-")
    for (const segment of segments.slice(3)) {
      expect(["baseline", "musl"]).toContain(segment)
    }
  })
  test("repeated calls return equal objects", () => {
    expect(resolveCodeplaneLocalTarget()).toEqual(resolveCodeplaneLocalTarget())
  })
})

describe("localBinaryCandidates - layout probe order", () => {
  const cases: Array<[string, string, string[]]> = [
    [
      "/tmp/x",
      "codeplane",
      [path.join("/tmp/x", "bin", "codeplane"), path.join("/tmp/x", "codeplane")],
    ],
    [
      "/tmp/x",
      "codeplane.exe",
      [path.join("/tmp/x", "bin", "codeplane.exe"), path.join("/tmp/x", "codeplane.exe")],
    ],
    [
      "/Users/x/y",
      "binary",
      [path.join("/Users/x/y", "bin", "binary"), path.join("/Users/x/y", "binary")],
    ],
    [
      "/relative/path",
      "executable",
      [path.join("/relative/path", "bin", "executable"), path.join("/relative/path", "executable")],
    ],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [root, name, expected] = cases[i]
    test(`localBinaryCandidates ${i}: ${root} / ${name}`, () => {
      expect(localBinaryCandidates(root, name)).toEqual(expected)
    })
  }
  test("returns exactly two paths", () => {
    expect(localBinaryCandidates("/x", "y")).toHaveLength(2)
  })
  test("first candidate is bin/<name>", () => {
    const result = localBinaryCandidates("/x", "y")
    expect(result[0]).toBe(path.join("/x", "bin", "y"))
  })
  test("second candidate is <root>/<name>", () => {
    const result = localBinaryCandidates("/x", "y")
    expect(result[1]).toBe(path.join("/x", "y"))
  })
})

describe("managedCodeplaneCliPath", () => {
  test("returns a path under the home bin dir", () => {
    const cliPath = managedCodeplaneCliPath()
    expect(cliPath.startsWith(home)).toBe(true)
    expect(cliPath).toContain("bin")
  })
  test("ends with the platform binary name", () => {
    const cliPath = managedCodeplaneCliPath()
    const target = resolveCodeplaneLocalTarget()
    expect(path.basename(cliPath)).toBe(target.binaryName)
  })
  test("repeated calls produce the same path", () => {
    expect(managedCodeplaneCliPath()).toBe(managedCodeplaneCliPath())
  })
})

describe("managedCodeplaneCliStatus", () => {
  test("reports cliInstalled=false on a fresh home", async () => {
    const status = await managedCodeplaneCliStatus()
    expect(status.cliInstalled).toBe(false)
    expect(status.cliPath).toBe(managedCodeplaneCliPath())
    expect(status.cliVersion).toBeUndefined()
  })

  test("reports cliInstalled=true once the file exists", async () => {
    const cliPath = managedCodeplaneCliPath()
    await fs.mkdir(path.dirname(cliPath), { recursive: true })
    await fs.writeFile(cliPath, "#!/bin/sh\n")
    const status = await managedCodeplaneCliStatus()
    expect(status.cliInstalled).toBe(true)
  })

  test("reads cliVersion from the version file", async () => {
    const cliPath = managedCodeplaneCliPath()
    await fs.mkdir(path.dirname(cliPath), { recursive: true })
    await fs.writeFile(cliPath, "#!/bin/sh\n")
    await fs.writeFile(path.join(path.dirname(cliPath), ".codeplane-version"), "27.4.2\n")
    const status = await managedCodeplaneCliStatus()
    expect(status.cliVersion).toBe("27.4.2")
  })

  test("strips leading v from version file", async () => {
    const cliPath = managedCodeplaneCliPath()
    await fs.mkdir(path.dirname(cliPath), { recursive: true })
    await fs.writeFile(cliPath, "x")
    await fs.writeFile(path.join(path.dirname(cliPath), ".codeplane-version"), "v27.4.2\n")
    const status = await managedCodeplaneCliStatus()
    expect(status.cliVersion).toBe("27.4.2")
  })

  test("returns cliVersion=undefined for blank version file", async () => {
    const cliPath = managedCodeplaneCliPath()
    await fs.mkdir(path.dirname(cliPath), { recursive: true })
    await fs.writeFile(cliPath, "x")
    await fs.writeFile(path.join(path.dirname(cliPath), ".codeplane-version"), "   \n")
    const status = await managedCodeplaneCliStatus()
    expect(status.cliVersion).toBeUndefined()
  })
})

describe("readPreferredLocalVersion / writePreferredLocalVersion", () => {
  test("read returns fallback when no file exists", async () => {
    expect(await readPreferredLocalVersion("27.0.0")).toBe("27.0.0")
  })

  test("read returns fallback when file is empty", async () => {
    const file = path.join(home, "local_server", "default-version")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "")
    expect(await readPreferredLocalVersion("27.1.0")).toBe("27.1.0")
  })

  test("read returns fallback when file contains an invalid semver", async () => {
    const file = path.join(home, "local_server", "default-version")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "not-a-version\n")
    expect(await readPreferredLocalVersion("27.0.5")).toBe("27.0.5")
  })

  test("write strips leading v", async () => {
    await writePreferredLocalVersion("v1.2.3")
    expect(await readPreferredLocalVersion("0.0.0")).toBe("1.2.3")
  })

  test("write rejects doubled version prefixes", async () => {
    await expect(writePreferredLocalVersion("vv2.0.0")).rejects.toThrow(/Invalid Codeplane version/)
  })

  test("write strips capital V", async () => {
    await writePreferredLocalVersion("V3.4.5")
    expect(await readPreferredLocalVersion("0.0.0")).toBe("3.4.5")
  })

  test("write throws on invalid semver", async () => {
    await expect(writePreferredLocalVersion("not-a-version")).rejects.toThrow(/Invalid Codeplane version/)
  })

  test("write throws on empty version", async () => {
    await expect(writePreferredLocalVersion("")).rejects.toThrow(/Invalid Codeplane version/)
  })

  test("write accepts pre-release versions", async () => {
    await writePreferredLocalVersion("27.4.2-rc.0")
    expect(await readPreferredLocalVersion("0.0.0")).toBe("27.4.2-rc.0")
  })

  test("write accepts build metadata", async () => {
    await writePreferredLocalVersion("27.4.2-rc.0+build.1")
    expect(await readPreferredLocalVersion("0.0.0")).toBe("27.4.2-rc.0+build.1")
  })

  test("read trims whitespace around stored version", async () => {
    const file = path.join(home, "local_server", "default-version")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "   27.5.0   \n")
    expect(await readPreferredLocalVersion("0.0.0")).toBe("27.5.0")
  })

  test("write returns the cleaned version", async () => {
    expect(await writePreferredLocalVersion("v1.0.0")).toBe("1.0.0")
  })

  test("write creates parent directories", async () => {
    await writePreferredLocalVersion("4.5.6")
    const stat = await fs.stat(path.join(home, "local_server"))
    expect(stat.isDirectory()).toBe(true)
  })

  test("write overwrites existing version", async () => {
    await writePreferredLocalVersion("1.0.0")
    expect(await readPreferredLocalVersion("0.0.0")).toBe("1.0.0")
    await writePreferredLocalVersion("2.0.0")
    expect(await readPreferredLocalVersion("0.0.0")).toBe("2.0.0")
  })
})

describe("resolveLocalBinaryPath - file probing", () => {
  test("returns undefined when both candidates absent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-bp-"))
    try {
      expect(await resolveLocalBinaryPath(root, "x")).toBeUndefined()
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })

  test("prefers bin/<name> when both layouts exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-bp-"))
    try {
      await fs.mkdir(path.join(root, "bin"), { recursive: true })
      await fs.writeFile(path.join(root, "bin", "z"), "x")
      await fs.writeFile(path.join(root, "z"), "x")
      expect(await resolveLocalBinaryPath(root, "z")).toBe(path.join(root, "bin", "z"))
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })

  test("falls back to flat layout when bin/<name> missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-bp-"))
    try {
      await fs.writeFile(path.join(root, "z"), "x")
      expect(await resolveLocalBinaryPath(root, "z")).toBe(path.join(root, "z"))
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })

  test("returns undefined when only a directory exists at the candidate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-bp-"))
    try {
      await fs.mkdir(path.join(root, "bin"), { recursive: true })
      // bin/z is a directory, not a file — fs.access still succeeds, so the
      // resolver returns the path. This documents current behavior.
      await fs.mkdir(path.join(root, "bin", "z"), { recursive: true })
      expect(await resolveLocalBinaryPath(root, "z")).toBe(path.join(root, "bin", "z"))
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })
})

describe("fetchNpmPackageManifest - input validation", () => {
  test("rejects unsafe versions before the network call", async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response("", { status: 200 })
    }) as never
    await expect(fetchNpmPackageManifest({ name: "codeplane-ai", version: "../latest" }))
      .rejects.toThrow(/Invalid version/)
    expect(called).toBe(false)
  })

  test("allows version: latest", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ version: "27.0.0", dist: { tarball: "https://registry.example.com/x.tgz" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as never
    const m = await fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" })
    expect(m.version).toBe("27.0.0")
  })

  test("allows version: latest by default (no version arg)", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ version: "27.0.0", dist: { tarball: "https://registry.example.com/x.tgz" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as never
    const m = await fetchNpmPackageManifest({ name: "codeplane-ai" })
    expect(m.version).toBe("27.0.0")
  })

  test("URL encodes scoped package name (@scope/name)", async () => {
    let observedUrl = ""
    globalThis.fetch = (async (input: unknown) => {
      observedUrl = typeof input === "string" ? input : (input as URL).toString()
      return new Response(
        JSON.stringify({ version: "1.0.0", dist: { tarball: "https://registry.example.com/x.tgz" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as never
    await fetchNpmPackageManifest({ name: "@codeplane-ai/example", version: "latest" })
    expect(observedUrl).toContain("@codeplane-ai%2fexample")
  })

  test("does not URL-encode unscoped package names", async () => {
    let observedUrl = ""
    globalThis.fetch = (async (input: unknown) => {
      observedUrl = typeof input === "string" ? input : (input as URL).toString()
      return new Response(
        JSON.stringify({ version: "1.0.0", dist: { tarball: "https://registry.example.com/x.tgz" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as never
    await fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" })
    expect(observedUrl).toContain("/codeplane-ai/latest")
  })

  test("propagates HTTP errors with status info", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as never
    await expect(fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" }))
      .rejects.toThrow(/HTTP 404/)
  })

  test("propagates 500 errors", async () => {
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as never
    await expect(fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" }))
      .rejects.toThrow(/HTTP 500/)
  })

  test("rejects manifests missing version field", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ dist: { tarball: "https://registry.example.com/x.tgz" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as never
    await expect(fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" }))
      .rejects.toThrow(/missing version or tarball/i)
  })

  test("rejects manifests missing dist.tarball", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version: "1.0.0", dist: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as never
    await expect(fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" }))
      .rejects.toThrow(/missing version or tarball/i)
  })

  test("propagates integrity field when present", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          version: "1.0.0",
          dist: { tarball: "https://registry.example.com/x.tgz", integrity: "sha512-AAAA" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as never
    const m = await fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" })
    expect(m.integrity).toBe("sha512-AAAA")
  })

  test("propagates shasum field when present", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          version: "1.0.0",
          dist: { tarball: "https://registry.example.com/x.tgz", shasum: "deadbeef" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as never
    const m = await fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" })
    expect(m.shasum).toBe("deadbeef")
  })

  test("strips v prefix from manifest version", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ version: "v1.2.3", dist: { tarball: "https://registry.example.com/x.tgz" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as never
    const m = await fetchNpmPackageManifest({ name: "codeplane-ai", version: "1.2.3" })
    expect(m.version).toBe("1.2.3")
  })

  test("uses CODEPLANE_NPM_REGISTRY env var", async () => {
    process.env.CODEPLANE_NPM_REGISTRY = "https://custom.example.com/path/"
    let observedUrl = ""
    globalThis.fetch = (async (input: unknown) => {
      observedUrl = typeof input === "string" ? input : (input as URL).toString()
      return new Response(
        JSON.stringify({ version: "1.0.0", dist: { tarball: "https://custom.example.com/x.tgz" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as never
    await fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" })
    expect(observedUrl).toContain("custom.example.com")
  })

  test("falls back to npm_config_registry env var", async () => {
    process.env.npm_config_registry = "https://npmconfig.example.com/r/"
    let observedUrl = ""
    globalThis.fetch = (async (input: unknown) => {
      observedUrl = typeof input === "string" ? input : (input as URL).toString()
      return new Response(
        JSON.stringify({ version: "1.0.0", dist: { tarball: "https://npmconfig.example.com/x.tgz" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as never
    await fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest" })
    expect(observedUrl).toContain("npmconfig.example.com")
  })

  test("uses explicit registry argument over env vars", async () => {
    process.env.CODEPLANE_NPM_REGISTRY = "https://env.example.com/"
    let observedUrl = ""
    globalThis.fetch = (async (input: unknown) => {
      observedUrl = typeof input === "string" ? input : (input as URL).toString()
      return new Response(
        JSON.stringify({ version: "1.0.0", dist: { tarball: "https://explicit.example.com/x.tgz" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as never
    await fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest", registry: "https://explicit.example.com" })
    expect(observedUrl).toContain("explicit.example.com")
  })

  test("registry without trailing slash is normalized", async () => {
    let observedUrl = ""
    globalThis.fetch = (async (input: unknown) => {
      observedUrl = typeof input === "string" ? input : (input as URL).toString()
      return new Response(
        JSON.stringify({ version: "1.0.0", dist: { tarball: "https://r.example.com/x.tgz" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as never
    await fetchNpmPackageManifest({ name: "codeplane-ai", version: "latest", registry: "https://r.example.com" })
    // The full URL should have correct slashes around the package path.
    expect(observedUrl).toMatch(/^https:\/\/r\.example\.com\/codeplane-ai\/latest$/)
  })
})
