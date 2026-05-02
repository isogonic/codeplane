import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  fetchNpmPackageManifest,
  installManagedCodeplaneCli,
  managedCodeplaneCliPath,
  managedCodeplaneCliStatus,
  readPreferredLocalVersion,
  writePreferredLocalVersion,
} from "../src/local-runtime"

const env = {
  CODEPLANE_HOME_DIR: process.env.CODEPLANE_HOME_DIR,
  CODEPLANE_NPM_REGISTRY: process.env.CODEPLANE_NPM_REGISTRY,
  npm_config_registry: process.env.npm_config_registry,
}

let home: string
let originalFetch: typeof globalThis.fetch

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-shared-"))
  process.env.CODEPLANE_HOME_DIR = home
  delete process.env.CODEPLANE_NPM_REGISTRY
  delete process.env.npm_config_registry
  originalFetch = globalThis.fetch
})

afterEach(async () => {
  globalThis.fetch = originalFetch
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
})

describe("preferred local runtime version", () => {
  test("persists and reloads the shared preferred version", async () => {
    expect(await readPreferredLocalVersion("27.0.0")).toBe("27.0.0")
    await writePreferredLocalVersion("v27.3.1")
    expect(await readPreferredLocalVersion("27.0.0")).toBe("27.3.1")
  })
})

describe("managed local cli", () => {
  test("copies the installed runtime binary into the shared cli path", async () => {
    const source = path.join(home, "local_server", "binaries", "27.3.1", process.platform === "win32" ? "codeplane.exe" : "codeplane")
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
})
