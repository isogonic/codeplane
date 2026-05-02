import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option, Stream } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { Global } from "@codeplane-ai/shared/global"
import { EffectFlock } from "@codeplane-ai/shared/util/effect-flock"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Npm } from "../src/npm"
import { tmpdir } from "./fixture/fixture"

const win = process.platform === "win32"
const encoder = new TextEncoder()
function mockSpawner(handler: (cmd: string, args: readonly string[]) => string = () => "") {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const output = handler(std?.command ?? "", std?.args ?? [])
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output ? Stream.make(encoder.encode(output)) : Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function testLayer(spawnHandler?: (cmd: string, args: readonly string[]) => string) {
  return Npm.layer.pipe(
    Layer.provide(mockSpawner(spawnHandler)),
    Layer.provide(EffectFlock.layer),
    Layer.provide(AppFileSystem.layer),
    Layer.provide(Global.layer),
    Layer.provide(NodeFileSystem.layer),
  )
}

const writePackage = (dir: string, pkg: Record<string, unknown>) =>
  Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({
      version: "1.0.0",
      ...pkg,
    }),
  )

describe("Npm.sanitize", () => {
  test("keeps normal scoped package specs unchanged", () => {
    expect(Npm.sanitize("@codeplane/acme")).toBe("@codeplane/acme")
    expect(Npm.sanitize("@codeplane/acme@1.0.0")).toBe("@codeplane/acme@1.0.0")
    expect(Npm.sanitize("prettier")).toBe("prettier")
  })

  test("handles git https specs", () => {
    const spec = "acme@git+https://github.com/codeplane/acme.git"
    const expected = win ? "acme@git+https_//github.com/codeplane/acme.git" : spec
    expect(Npm.sanitize(spec)).toBe(expected)
  })
})

describe("Npm.install", () => {
  test("respects omit from project .npmrc", async () => {
    await using tmp = await tmpdir()

    await writePackage(tmp.path, {
      name: "fixture",
      dependencies: {
        "prod-pkg": "file:./prod-pkg",
      },
      devDependencies: {
        "dev-pkg": "file:./dev-pkg",
      },
    })
    await Bun.write(path.join(tmp.path, ".npmrc"), "omit=dev\n")
    await fs.mkdir(path.join(tmp.path, "prod-pkg"))
    await fs.mkdir(path.join(tmp.path, "dev-pkg"))
    await writePackage(path.join(tmp.path, "prod-pkg"), { name: "prod-pkg" })
    await writePackage(path.join(tmp.path, "dev-pkg"), { name: "dev-pkg" })

    await Npm.install(tmp.path)

    await expect(fs.stat(path.join(tmp.path, "node_modules", "prod-pkg"))).resolves.toBeDefined()
    await expect(fs.stat(path.join(tmp.path, "node_modules", "dev-pkg"))).rejects.toThrow()
  })
})

describe("Npm.outdated", () => {
  test("checks latest via npm view", async () => {
    const calls: string[][] = []
    const layer = testLayer((cmd, args) => {
      calls.push([cmd, ...args])
      if (cmd === "npm" && args[0] === "view") return '"2.0.0"\n'
      return ""
    })

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.outdated("example", "1.0.0")).pipe(Effect.provide(layer)),
    )

    expect(result).toBe(true)
    expect(calls).toContainEqual(["npm", "view", "example", "dist-tags.latest", "--json"])
  })

  test("keeps range comparison behavior", async () => {
    const layer = testLayer((cmd, args) => {
      if (cmd === "npm" && args[0] === "view") return '"2.3.0"\n'
      return ""
    })

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.outdated("example", "^2.0.0")).pipe(Effect.provide(layer)),
    )

    expect(result).toBe(false)
  })

  test("falls back when npm view is unavailable", async () => {
    const calls: string[][] = []
    const layer = testLayer((cmd, args) => {
      calls.push([cmd, ...args])
      if (cmd === "pnpm" && args[0] === "view") return '"2.0.0"\n'
      return ""
    })

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.outdated("example", "1.0.0")).pipe(Effect.provide(layer)),
    )

    expect(result).toBe(true)
    expect(calls).toContainEqual(["npm", "view", "example", "dist-tags.latest", "--json"])
    expect(calls).toContainEqual(["pnpm", "view", "example", "dist-tags.latest", "--json"])
  })
})

describe("Npm.manager", () => {
  test("detects packageManager from nearest package.json", async () => {
    await using tmp = await tmpdir()
    await writePackage(tmp.path, {
      name: "fixture",
      packageManager: "pnpm@9.0.0",
    })

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.manager(tmp.path)).pipe(Effect.provide(testLayer())),
    )

    expect(result).toBe("pnpm")
  })

  test("falls back to lockfiles when packageManager is absent", async () => {
    await using tmp = await tmpdir()
    await writePackage(tmp.path, {
      name: "fixture",
    })
    await Bun.write(path.join(tmp.path, "bun.lock"), "")

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.manager(tmp.path)).pipe(Effect.provide(testLayer())),
    )

    expect(result).toBe("bun")
  })
})

describe("Npm.view", () => {
  test("uses Codeplane npm config for client preference and registry metadata", async () => {
    await using tmp = await tmpdir()
    await Bun.write(
      path.join(tmp.path, "codeplane.jsonc"),
      JSON.stringify({
        npm: {
          client: "pnpm",
          registry: "https://registry.example.com/custom",
        },
      }),
    )

    const calls: string[][] = []
    const layer = testLayer((cmd, args) => {
      calls.push([cmd, ...args])
      if (cmd === "pnpm" && args[0] === "view") return '"3.1.4"\n'
      return ""
    })

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.view("example", tmp.path)).pipe(Effect.provide(layer)),
    )

    expect(result.client).toBe("pnpm")
    expect(Option.getOrUndefined(result.latest)).toBe("3.1.4")
    expect(Option.getOrUndefined(result.registry)).toBe("https://registry.example.com/custom/")
    expect(calls[0]).toEqual(["pnpm", "view", "example", "dist-tags.latest", "--json"])
  })
})
