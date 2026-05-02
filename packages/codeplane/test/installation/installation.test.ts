import { describe, expect, test } from "bun:test"
import { CodeplaneVersion, codeplaneDesktopReleaseTag, codeplaneReleaseTag } from "@codeplane-ai/shared/version"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"
import { InstallationChannel } from "../../src/installation/version"

const encoder = new TextEncoder()

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

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

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(
  httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawnHandler?: (cmd: string, args: readonly string[]) => string,
) {
  return Installation.layer.pipe(Layer.provide(mockHttpClient(httpHandler)), Layer.provide(mockSpawner(spawnHandler)))
}

describe("installation", () => {
  describe("version ordering", () => {
    test("uses semantic release ordering after legacy calendar versions", () => {
      expect(Installation.hasUpdate("26.5.44", "27.0.0")).toBe(true)
      expect(Installation.getReleaseType("26.5.44", "27.0.0")).toBe("major")
    })

    test("normalizes v-prefixed targets without rejecting old versions", () => {
      expect(Installation.isSameVersion("v26.5.44", "26.5.44")).toBe(true)
      expect(Installation.cleanVersion("v27.0.0")).toBe("27.0.0")
    })
  })

  describe("latest", () => {
    test("detects npm installs published as codeplane-ai", async () => {
      const layer = testLayer(
        () => {
          throw new Error("unexpected http request")
        },
        (cmd, args) => {
          if (cmd === "npm" && args[0] === "list") return "└── codeplane-ai@1.5.0\n"
          return ""
        },
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.method()).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("npm")
    })

    test("reads release version from GitHub releases", async () => {
      const layer = testLayer(() => jsonResponse([{ tag_name: "v1.2.3" }]))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("unknown")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.2.3")
    })

    test("strips v prefix from GitHub release tag", async () => {
      const layer = testLayer(() => jsonResponse([{ tag_name: "v4.0.0-beta.1" }]))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("curl")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("4.0.0-beta.1")
    })

    test("ignores desktop sibling releases when selecting the latest GitHub tag", async () => {
      const layer = testLayer(() =>
        jsonResponse([
          { tag_name: codeplaneDesktopReleaseTag() },
          { tag_name: codeplaneReleaseTag() },
          { tag_name: "v27.0.11" },
        ]),
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("selfhosted")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe(CodeplaneVersion)
    })

    test("reads npm versions via npm view", async () => {
      const calls: string[][] = []
      const layer = testLayer(
        () => {
          throw new Error("unexpected http request")
        },
        (cmd, args) => {
          calls.push([cmd, ...args])
          if (cmd === "npm" && args[0] === "view") return '"1.5.0"\n'
          return ""
        },
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("npm")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.5.0")
      expect(calls).toContainEqual(["npm", "view", `codeplane-ai@${InstallationChannel}`, "version", "--json"])
    })

    test("reads npm versions via bun pm view", async () => {
      const calls: string[][] = []
      const layer = testLayer(
        () => {
          throw new Error("unexpected http request")
        },
        (cmd, args) => {
          calls.push([cmd, ...args])
          if (cmd === "bun" && args[0] === "pm") return '"1.6.0"\n'
          return ""
        },
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("bun")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.6.0")
      expect(calls).toContainEqual(["bun", "pm", "view", `codeplane-ai@${InstallationChannel}`, "version", "--json"])
    })

    test("reads npm versions via pnpm view", async () => {
      const calls: string[][] = []
      const layer = testLayer(
        () => {
          throw new Error("unexpected http request")
        },
        (cmd, args) => {
          calls.push([cmd, ...args])
          if (cmd === "pnpm" && args[0] === "view") return '"1.7.0"\n'
          return ""
        },
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("pnpm")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.7.0")
      expect(calls).toContainEqual(["pnpm", "view", `codeplane-ai@${InstallationChannel}`, "version", "--json"])
    })

    test("reads scoop manifest versions", async () => {
      const layer = testLayer(() => jsonResponse({ version: "2.3.4" }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("scoop")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("2.3.4")
    })

    test("reads chocolatey feed versions", async () => {
      const layer = testLayer(() => jsonResponse({ d: { results: [{ Version: "3.4.5" }] } }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("choco")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("3.4.5")
    })

    test("reads brew formulae API versions", async () => {
      const layer = testLayer(
        () => jsonResponse({ versions: { stable: "2.0.0" } }),
        (cmd, args) => {
          // getBrewFormula: return core formula (no tap)
          if (cmd === "brew" && args.includes("--formula") && args.includes("devinoldenburg/tap/codeplane")) return ""
          if (cmd === "brew" && args.includes("--formula") && args.includes("codeplane")) return "codeplane"
          return ""
        },
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("brew")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("2.0.0")
    })

    test("reads brew tap info JSON via CLI", async () => {
      const brewInfoJson = JSON.stringify({
        formulae: [{ versions: { stable: "2.1.0" } }],
      })
      const layer = testLayer(
        () => jsonResponse({}), // HTTP not used for tap formula
        (cmd, args) => {
          if (cmd === "brew" && args.includes("devinoldenburg/tap/codeplane") && args.includes("--formula"))
            return "codeplane"
          if (cmd === "brew" && args.includes("--json=v2")) return brewInfoJson
          return ""
        },
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("brew")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("2.1.0")
    })
  })

  describe("upgrade", () => {
    test("rejects desktop release targets", async () => {
      const layer = testLayer(() => {
        throw new Error("unexpected http request")
      })

      const error = await Effect.runPromise(
        Installation.Service.use((svc) => svc.upgrade("selfhosted", codeplaneDesktopReleaseTag())).pipe(
          Effect.provide(layer),
          Effect.flip,
        ),
      )

      expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
      expect(error.stderr).toContain("Desktop release targets")
    })
  })
})
